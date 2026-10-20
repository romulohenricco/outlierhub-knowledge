# Segurança

O que o app protege, o que **não** protege e como expô-lo fora da sua máquina sem abrir mão disso. O app é local-first: `npm run dev` e `npm start` o fazem escutar só em `127.0.0.1:3300`.

## O que protege

### Local x acesso externo

Um pedido é **local** (abre sem login) só quando as duas condições valem:

1. o cabeçalho `Host` é `localhost`, `127.0.0.1` ou `[::1]`, com ou sem porta. `0.0.0.0` e qualquer outro nome não contam;
2. o pedido não traz sinal de intermediário (proxy, túnel, CDN):
   - qualquer um destes cabeçalhos, só por existir: `Forwarded`, `X-Real-IP`, `True-Client-IP`, `CF-Connecting-IP`, `CF-Ray`, `CDN-Loop`, `Via`;
   - `X-Forwarded-For` com origem fora do loopback (ou em lista, ou vazio), `X-Forwarded-Host` diferente do `Host` ou `X-Forwarded-Proto` diferente de `http`. O servidor do Next preenche esses três em *todo* pedido, com o endereço do socket, o `Host` recebido e `http`; por isso só um valor que ele não teria escrito conta como sinal.

Todo o resto é **externo** e responde `403` até apresentar um JWT válido do [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/): emissor `https://<time>.cloudflareaccess.com`, *audience* da aplicação e e-mail autorizado (`BILHON_ACCESS_TEAM`, `BILHON_ACCESS_AUD`, `BILHON_ACCESS_EMAIL`). Com qualquer um dos três em branco, nenhum pedido externo é aceito. O motivo da recusa vem no cabeçalho de resposta `x-knowledge-access`: `nao-configurado`, `sem-jwt`, `jwt-invalido`, `email-nao-autorizado` ou `origem-cruzada`.

O `Host` sozinho não basta porque ele é escolhido por quem alcança a porta, e proxies e túneis o reescrevem para o endereço do servidor (`127.0.0.1`). Sem a segunda condição, todo o tráfego externo pareceria local. `BILHON_ACCESS_HOSTS` continua reservada e sem efeito.

### Escrita vinda de outra origem (CSRF)

Qualquer página aberta no mesmo navegador consegue enviar um `POST` "simples" para `http://127.0.0.1:3300`. Para métodos diferentes de `GET`, `HEAD` e `OPTIONS`, o app responde `403` (`origem-cruzada`) quando:

- `Sec-Fetch-Site` está presente e não é `same-origin` nem `none` (`same-site` e `cross-site` são recusados); ou
- `Origin` está presente e o seu host, com porta, não é o `Host` do pedido (inclui `Origin: null`).

Clientes sem esses cabeçalhos (curl, scripts) passam: o alvo da checagem é o navegador do usuário sendo usado por terceiros. Ela vale para pedidos locais e externos, e roda antes da verificação do JWT.

### Contenção de caminhos

Os arquivos que o app lê ou grava ficam sob raízes definidas por você:

- livros: `BILHON_LIVROS_DIR`; cards e anexos do kanban: `BILHON_KANBAN_DIR`. O caminho resolvido precisa começar pela raiz, e o id do card só aceita o formato do próprio kanban;
- add-ons, ecossistema, registro e grafo do agente (organização e pasta de notas): `BILHON_ROOT` (padrão: a pasta do app). Aqui o caminho real também é conferido, então link simbólico ou junção que aponte para fora é recusado, assim como caminho de rede (UNC). Definir `BILHON_ROOT` substitui essa raiz (não a soma à pasta do app) e a contenção continua valendo dentro dela.
- Minhas redes (`/mysocialmedia`): `BILHON_SOCIAL_DIR` (padrão `data/social`), independente de `BILHON_ROOT`. Leitura (inventários, capas, dossiês) e a gravação das decisões conferem o caminho real, como acima: link simbólico que aponte para fora da raiz é recusado. Nome de usuário, arquivo e `code` vindos da URL só valem como **um** segmento de caminho (sem `/`, `\`, `..`, NUL), e as rotas de escrita (`POST /api/mysocialmedia/*/decisao`) passam pela checagem de origem cruzada acima. Os links dos arquivos de dados só viram `href` se forem `http(s)`.

### Downloads de referências

URLs de vídeo importadas só são baixadas por HTTPS público na porta padrão, sem credenciais embutidas. Cada destino e redirect tem o DNS validado e o IP aprovado é fixado na conexão. Redes privadas, loopback, link-local e endereços especiais são recusados. O corpo real tem teto de 100 MB e o conjunto da transferência/redirects tem prazo de 30 segundos. São permitidos no máximo três redirects.

YouTube usa `yt-dlp` com configuração pessoal ignorada, uma única URL de vídeo, prazo de 90 segundos e limite solicitado de 100 MB. O arquivo final também é conferido antes de ser registrado. O limite do utilitário durante downloads de tamanho desconhecido é orientativo: arquivos temporários podem ocupar mais espaço; não há uma cota global de disco. O acervo configurado e o executável local continuam sendo fontes de confiança do usuário.

### Cabeçalhos de resposta

Em todas as rotas: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` e `Permissions-Policy` sem câmera, geolocalização, pagamento e USB (o microfone fica liberado só para o próprio app, por causa da gravação de áudio do kanban). Contra incorporação em moldura de outro site: `X-Frame-Options: SAMEORIGIN` e `Content-Security-Policy: frame-ancestors 'self'`, em todas as rotas **exceto** `/api/file/`, que o leitor embute em um iframe do próprio app e que só entrega o arquivo.

## O que NÃO protege

- **Não há login no modo local.** Qualquer processo ou usuário da máquina que alcance `127.0.0.1:3300` usa o app com os mesmos poderes: ler e escrever o kanban, subir arquivos, disparar as integrações que você configurou.
- **Os uploads do kanban têm teto de tamanho por arquivo, mas não há limite de taxa nem de quantidade.** Imagem: até 10 MB; áudio: até 25 MB (acima disso a resposta é `413`). Nada impede enviar muitos arquivos, um atrás do outro: disco cheio é problema seu.
- **Referências e livros usam caminhos relativos ao projeto.** A raiz absoluta configurada não é enviada como `baseDir`. Quando a pasta de referências está fora do projeto, a cópia de pasta física fica indisponível e os botões de mídia copiam sua URL interna. Campos de conteúdo importado, como caminhos de código anotados pelo usuário, não são anonimizados automaticamente.
- **O primeiro uso revela a raiz do Megabrain quando ele é detectado:** o `GET /api/primeiro-uso` mostra a raiz e os nomes das pastas para o próprio usuário configurar a integração. Quem expõe o app atrás de Access deve tratar esses dados como visíveis a quem for autorizado.
- **Só HTTP.** O TLS é responsabilidade do túnel ou do proxy.
- **Um único e-mail autorizado e nenhum papel dentro do app.** O Access identifica uma pessoa; quem entra faz tudo.
- **Segredos em texto puro.** O `.env.local` guarda chaves sem criptografia. A chave `service role` do Supabase, se você a configurar, dá acesso total ao banco: ela é lida só no servidor, e não pode ir para o navegador, para o Git ou para um log.
- **Symlinks nas pastas de livros e de cards.** Nelas a contenção compara o texto do caminho e não resolve links; não coloque ali links que apontem para fora.
- **Conteúdo dos arquivos.** PDF, texto e Markdown são servidos como estão, sem sanitização.
- **O executor externo.** O que você aponta em `BILHON_EXECUTION_URL` recebe os tickets escalados; trate-o como serviço de confiança.
- **Proxy que não deixa rastro.** Um proxy que reescreve o `Host` para `127.0.0.1` e não envia nenhum cabeçalho de encaminhamento (o `proxy_pass` do nginx sem `proxy_set_header`, por exemplo) é indistinguível de um cliente local: o app não vê o socket do cliente final. Configure o proxy como no passo 4 abaixo.
- **Quem alcança a porta direto.** Se o servidor for iniciado com `--hostname 0.0.0.0` (ou a porta for publicada por contêiner, VPN ou regra de firewall), outra máquina forja `Host: localhost` e `X-Forwarded-For: 127.0.0.1` e passa como local. A detecção por cabeçalho é uma segunda barreira, não substitui escutar só em `127.0.0.1`.
- **Chamar o `next` direto.** Os scripts `npm run dev` e `npm run start` (`scripts/next-local.mjs`) passam `--hostname 127.0.0.1 --port 3300` e desligam a telemetria. Quem roda `next dev` ou `next start` sem `--hostname 127.0.0.1` faz o servidor escutar em **todas as interfaces** (o padrão do Next é `0.0.0.0`) e cai no caso acima: a proteção "local" deixa de valer. Use sempre os scripts npm.

## Expor atrás de proxy ou túnel

1. **Mantenha o app em `127.0.0.1`** (o padrão de `npm run dev` e `npm start`). O proxy ou o túnel roda na mesma máquina e conecta em `127.0.0.1:3300`. Nunca use `--hostname 0.0.0.0`.
2. **Crie a aplicação no Cloudflare Access** para o hostname público, com uma política que permita só o seu e-mail. Anote o nome do time e o *audience* (AUD) da aplicação.
3. **Preencha no `.env.local`** `BILHON_ACCESS_TEAM`, `BILHON_ACCESS_AUD` e `BILHON_ACCESS_EMAIL` e reinicie o app. Em branco, o acesso externo fica fechado.
4. **Faça o proxy se identificar e preservar o `Host`.** O Cloudflare Tunnel já envia `CF-Ray` e `CF-Connecting-IP` e mantém o `Host` público. No nginx use `proxy_set_header Host $host;`, `proxy_set_header X-Forwarded-For $remote_addr;` e `proxy_set_header X-Forwarded-Proto $scheme;`. As escritas feitas pelo navegador comparam `Origin` com `Host`: se o proxy reescrever o `Host` (por exemplo, `httpHostHeader` apontando para `127.0.0.1`), a leitura funciona, mas toda escrita volta `403` com `origem-cruzada`.
5. **Não remova** `Cf-Access-Jwt-Assertion` nem o cookie `CF_Authorization`: são o que o app valida.

Confira, sem login, que o fechamento está de pé (todos devem responder `403`):

```bash
curl -i https://seu-hostname-publico/
curl -i -H "Host: localhost" -H "X-Forwarded-For: 203.0.113.7" http://127.0.0.1:3300/
curl -i -H "Host: 0.0.0.0" http://127.0.0.1:3300/
```
