# Knowledge

Sua base de conhecimento com uma interface visual: biblioteca com leitor, busca, grafo de conexões, kanban e inventário de agentes. Roda no seu computador e pode ser usado sozinho ou ao lado do seu Megabrain.

**Gratuito e de código aberto, sob a licença MIT.** A demonstração inclui apenas documentos e capas originais deste projeto. Não inclui livros comerciais, cursos, dados de alunos, contas, chaves ou a engine Megabrain.

## De onde vêm os dados

| Peça | Onde está | Papel |
|---|---|---|
| Repositório Megabrain Free (open source) | <https://github.com/thiagofinch/mega-brain> | A base de conhecimento. É dela que o `npm run populate` lê o conteúdo que aparece nas telas |
| App Knowledge (open source) | <https://github.com/romulohenricco/outlierhub-knowledge> | Este app: o código das telas (estante, busca, grafo, kanban, agente…) |
| Pasta onde o Knowledge fica | `[mega-brain]\apps\knowledge` (no macOS e no Linux, `[mega-brain]/apps/knowledge`) | Clone deste repositório dentro do seu Megabrain. `[mega-brain]` é a pasta onde você clonou o Megabrain Free |

Como os dados chegam às telas:

1. Você clona o Megabrain Free e, dentro dele, clona este app em `apps/knowledge`.
2. O `npm run populate` lê o Megabrain em que o app está (a pasta `[mega-brain]`, dois níveis acima do app), inclusive o que você ingeriu nele, e grava o resultado só em `data/`, dentro do app.
3. `data/` e `.env.local` ficam no seu computador: o git os ignora, nada é enviado ao GitHub e o app só abre em `127.0.0.1`.

Sem o Megabrain, o app abre no modo demo, com os exemplos deste repositório (veja [Experimentar sem Megabrain](#experimentar-sem-megabrain)).

## Antes de começar

- Node.js **22.13 ou superior**; prefira uma versão LTS suportada (22 ou 24).
- Git **2.31 ou superior**, caso vá clonar ou contribuir.
- Cerca de 2 GB livres para dependências, build e arquivos de trabalho.

Confira no terminal:

```sh
node -v
git --version
```

No Windows, use PowerShell ou Git Bash. Se a política de execução bloquear `npm`, use `npm.cmd` nos comandos abaixo. Não é necessário alterar a política global do computador.

## Experimentar sem Megabrain

1. Na página deste repositório, use **Code → Download ZIP** e extraia o pacote, ou copie a URL HTTPS em **Code** e use `git clone https://github.com/romulohenricco/outlierhub-knowledge.git knowledge`.
2. Abra o terminal na pasta que contém este README e o `package.json`.
3. Instale as dependências:

```sh
npm ci
```

4. Inicie o app:

```sh
npm run dev
```

5. Quando aparecer `Ready`, abra **http://127.0.0.1:3300**.

Deixe esse terminal aberto; para outros comandos, use um segundo terminal. Para desligar, pressione `Ctrl+C`.

Nenhuma chave ou banco é necessário. A Estante, o Grafo e a Busca usam os exemplos originais; Kanban e as integrações pessoais começam vazios. Você pode criar seus próprios cards no kanban. Os primeiros acessos em modo de desenvolvimento compilam as telas e podem demorar mais.

## Parte 1: Instalar dentro do seu Megabrain

O Megabrain é opcional e tem instalação/licença próprias. Este repositório não o distribui.

Instale o aplicativo em **`apps/knowledge`**, nunca na pasta `knowledge/` do acervo:

```text
seu-megabrain/
├── engine/
├── knowledge/          base de conhecimento existente
└── apps/
    └── knowledge/      este aplicativo
```

Na pasta do seu Megabrain, clone com a URL HTTPS copiada do GitHub:

```sh
git clone https://github.com/romulohenricco/outlierhub-knowledge.git apps/knowledge
cd apps/knowledge
npm ci
npm run dev
```

Substitua `https://github.com/romulohenricco/outlierhub-knowledge.git` pela URL mostrada em **Code** neste repositório. Quem baixou ZIP pode extrair o aplicativo diretamente em `apps/knowledge`.

Se o Megabrain também for versionado com Git, adicione `/apps/` ao `.git/info/exclude` **dele** para não misturar os repositórios. É uma configuração local; não use `git add .` na raiz do Megabrain para registrar este app.

## Parte 2: O primeiro card: popular o Knowledge com o seu Megabrain

Ao reconhecer `engine/` e `knowledge/`, o app oferece criar a tarefa **Popular o Knowledge com a base do Megabrain** (normalmente `ING-1`). Você escolhe se quer começar ou deixar para depois.

O app não importa sua base automaticamente. O card fornece instruções para seu agente de IA inventariar o acervo, combinar o escopo com você, criar importadores idempotentes e validar os resultados. Abra o agente em um segundo terminal e siga o texto do card.

- O acervo do Megabrain é **somente leitura**.
- Importe apenas o que você tem autorização para usar.
- Você mesmo preenche os segredos em `.env.local`; não cole chaves na conversa com o agente.
- Antes de cópias grandes, material sensível ou tarefas demoradas, combine o escopo e o volume.
- Sem importação, a biblioteca continua mostrando os exemplos originais.

Se a pergunta não aparecer, consulte [docs/megabrain.md](docs/megabrain.md). A variável opcional `BILHON_MEGABRAIN_ROOT` permite indicar uma instalação em outro lugar.

Prefere sem agente? O `npm run populate`, descrito abaixo, importa o Megabrain direto e responde essa pergunta por você.

## Popular com o Megabrain (`npm run populate`)

Com o app em `apps/knowledge`, um comando preenche as telas com o conteúdo do **seu** Megabrain, sem agente, sem Supabase, sem Ollama e sem rede. Num segundo terminal, na pasta do app:

```sh
npm run populate            # mostra quantos arquivos entram e pergunta antes de gravar
npm run populate -- --yes   # sem perguntar
npm run populate:status     # resultado da última população
```

Depois, reinicie o `npm run dev` (`Ctrl+C` e de novo): o app só lê os dados e o `.env.local` ao iniciar.

- O Megabrain é **somente lido**. O comando grava só em `data/` e num bloco gerenciado no fim do `.env.local` (`# >>> populate-megabrain`). O que estiver fora do bloco é seu e não é tocado. Variável que você já definiu fora do bloco, com valor (como `BILHON_KNOWLEDGE_PROVIDER=supabase`, `BILHON_ROOT` ou `BILHON_REGISTRO_ENTIDADES`), vence: o bloco não a grava e o comando avisa o que isso muda (para usar o valor do populate, apague a sua linha).
- Liga o provider `local` (busca por palavras e grafo a partir de `data/`) quando o índice de busca fica utilizável; senão o app continua no modo demo e o comando diz por quê. Detalhes em [docs/provider-local.md](docs/provider-local.md).
- Monta a `/ontologia` com as camadas de DNA dos especialistas (`knowledge/{external,business}/dna/persons/`), cada item com a fonte no Megabrain, em `data/ontologia/ontologia.yaml`; um manifesto seu nessa pasta não é sobrescrito. Veja [docs/ontologia.md](docs/ontologia.md#gerada-pelo-npm-run-populate).
- Precisa de Node.js 22.13+ e da CLI `sqlite3` (3.35 ou superior) no `PATH`. No Windows ela não vem instalada: veja [docs/dados.md](docs/dados.md#caminhos-e-variáveis).
- Fica de fora: `knowledge/personal` e `agents/personal` (a não ser com `--include-personal`), todo arquivo com cara de segredo (`.env`, chaves, tokens) e link simbólico ou junction (o comando não sai da pasta do Megabrain por eles; os de primeiro nível aparecem com o motivo `link-ou-junction`). Exemplo de documentação (`your-api-key-here`, `xxxx…`, `<sua-chave>`, `user:pass@host`) não tira o arquivo do corpus. `populate:status` lista o que foi excluído, sem mostrar valores.
- Rodar de novo atualiza o que veio do Megabrain e preserva o que é seu: cards criados à mão, favoritos, anotações e livros que você acrescentou.
- Para barrar arquivos específicos do Megabrain lido (por exemplo, cópias de um repositório privado), defina `BILHON_POPULATE_EXCLUIR` no terminal ou no `.env.local` (fora do bloco `populate-megabrain`; o terminal vence o arquivo): caminhos relativos à raiz do Megabrain, separados por vírgula ou ponto e vírgula, com `/` ou `\`, aceitando glob simples (`*` não passa de uma pasta, `**` passa; o caminho de uma pasta exclui tudo dentro dela). Exemplo: `BILHON_POPULATE_EXCLUIR=docs/privado.md;squads/secreto/**;engine/**/modulo_privado.py`. O arquivo excluído não é lido nem gravado em lugar nenhum de `data/` (estante, coleções, busca, grafo, topologia, agente, add-ons, kanban, referências, especialistas, ontologia); na topologia, no máximo o nó do caminho aparece, como referência citada por outro documento, sem conteúdo. Ele entra na lista de excluídos com o motivo `excluido-pela-configuracao`, e o log do comando e o `populate:status` (campos `corpus.excluidosPelaConfiguracao` e `exclusaoConfigurada`) mostram quantos e quais. Entrada que não casa nenhum arquivo (erro de digitação) ou que sai da raiz (`..`) gera aviso. O que já tinha sido gravado antes da exclusão sai na próxima população.

Opções, depois de `--`: `--only livros,busca`, `--skip kanban`, `--dry-run` (só mostra o que entraria) e `--repo <pasta>` para um Megabrain em outro lugar (ou `BILHON_MEGABRAIN_ROOT`, no terminal ou no `.env.local`).

### Só o conteúdo do Megabrain público (clone limpo)

Para mostrar apenas o que está no repositório aberto ([thiagofinch/mega-brain](https://github.com/thiagofinch/mega-brain)), e não o seu Megabrain local (que pode ter conteúdo privado), faça um clone limpo ao lado do app e aponte o populate para ele. Na pasta `apps/` do Megabrain:

```sh
git clone https://github.com/thiagofinch/mega-brain.git mega-brain-oss
```

Depois, na área sua do `.env.local`, **fora** do bloco `populate-megabrain`:

```
BILHON_MEGABRAIN_ROOT=../mega-brain-oss
BILHON_ROOT=..
```

- `BILHON_MEGABRAIN_ROOT` (relativo à pasta do app) diz qual Megabrain o `npm run populate` lê, e o app a usa na pergunta de primeiro uso. O `.env.local` vale para qualquer `npm run populate`, sem nada no terminal; o terminal, se definir a variável, vence o arquivo, e `--repo` vence os dois.
- `BILHON_ROOT` é a raiz que contém o app **e** o clone (aqui, a pasta `apps/`). O populate grava então os caminhos do registro do Agente com o prefixo da raiz até o clone (`mega-brain-oss/squads/...`) e eles resolvem. Sem ela, o clone fica fora da raiz do app e o comando avisa.
- Para atualizar o conteúdo: `git -C ../mega-brain-oss pull` e `npm run populate -- --yes`. O clone é só lido; o populate nunca grava nele.

## Parte 3: Conheça as páginas

| Página | Endereço | Uso |
| --- | --- | --- |
| Estante | `/estante` | Biblioteca e leitor de PDF, texto e Markdown |
| Busca | `/buscar` | Busca por termos no demo; integração semântica opcional |
| Grafo | `/grafo` | Conceitos, fontes e conexões |
| Ingestões | `/ingestoes` | Coleções de documentos e personas configuradas por você |
| Referências | `/referencias` | Referências visuais e anotações |
| Kanban | `/kanban` | Tarefas, checklist, anexos e histórico |
| Backlog | `/kanban/backlog` | Histórico completo de tarefas |
| Agente | `/agente` | Inventário e grafo dos agentes que você cadastrar |
| Integrações | `/integracoes` | Padrões e componentes cadastrados localmente |
| Ontologia | `/ontologia` | Camadas e relações definidas em um manifesto seu, ou as camadas de DNA dos especialistas montadas pelo `npm run populate` |
| Minhas redes | `/mysocialmedia` | Inventários pessoais de Instagram e YouTube |

A raiz `/` abre a Estante. Telas de integrações pessoais começam vazias: o app não entra nas suas contas nem lê dados de outra pessoa.

Formatos dos arquivos: [dados](docs/dados.md), [agentes](docs/agente-registro.md), [ontologia](docs/ontologia.md), [personas](docs/personas.md) e [redes sociais](docs/redes-sociais.md).

## Atualizar o Knowledge

1. Pare o servidor com `Ctrl+C`.
2. Se instalou por Git, execute `git pull --ff-only` na pasta do app.
3. Se o lockfile mudou, execute `npm ci`.
4. Inicie novamente com `npm run dev`.

Se o Git indicar conflito com alterações suas, preserve o trabalho e resolva o conflito antes de continuar. Seus dados locais ficam em `data/` e a configuração em `.env.local`, ambos ignorados pelo Git. Mantenha backups próprios. Instalações por ZIP devem extrair a versão nova em outra pasta e transferir apenas os dados/configurações pessoais necessários, sem publicar esses arquivos.

## Parte 4: Trabalho em grupo para contribuintes

Leia [CONTRIBUTING.md](CONTRIBUTING.md) e [AGENTS.md](AGENTS.md). Para trabalhar nas páginas com branches e portas separadas, consulte [docs/paginas.md](docs/paginas.md).

Checks:

```sh
npm run type-check
npm run lint
npm test
npm run build
```

Não instale dependências em um worktree de página enquanto o `node_modules` dele for uma ligação ao clone principal. Não apague branches `pagina/*`, não use push forçado e não inclua bases importadas ou segredos em commits.

## Parte 5: Ir além do modo demo

O `.env.example` lista as configurações opcionais. Copie-o para `.env.local` **somente se precisar configurar integrações** e preencha apenas o necessário. Nunca versione `.env.local` nem coloque segredo em `NEXT_PUBLIC_*`.

- Biblioteca e grafo próprios: [docs/dados.md](docs/dados.md).
- Busca híbrida no **seu** Supabase e embeddings no **seu** Ollama: [docs/provider-supabase.md](docs/provider-supabase.md).
- Executor externo de tarefas: configuração opcional no `.env.example`.
- Acesso externo: [docs/seguranca.md](docs/seguranca.md).

Use um projeto Supabase dedicado. A chave `service_role`, quando configurada, fica apenas no servidor e tem poderes amplos nesse projeto. O template não fornece conta nem chave.

Para uso local com build de produção:

```sh
npm run build
npm start
```

O app continua em `127.0.0.1:3300`. Para usar outra porta local, defina `PORT=3301` no `.env.local` (fora do bloco do populate) ou no terminal; `npm run dev` e `npm start` passam a usá-la. `PORT` do terminal vence a do `.env.local`; no arquivo vale a última linha `PORT=`, como no Next (em branco = 3300), e uma porta inválida interrompe o início com uma mensagem que diz de onde ela veio. Para uma vez só, `npm run dev -- --port 3301`. Ajuste o endereço no navegador.

## Rede e privacidade

Em modo demo, o app não envia sua base a Supabase, Ollama ou executor algum. A instalação baixa pacotes do npm e o build pode baixar fontes do Google. A telemetria do Next é desativada pelos scripts npm.

Integrações configuradas por você se comunicam com os serviços escolhidos. Downloads de referências usam os provedores registrados nos seus arquivos. Miniaturas externas do YouTube são opcionais. **Tornar o código público não publica automaticamente sua base local.**

Este é um app local/pessoal, com um único usuário autorizado quando configurado atrás de Cloudflare Access. Não é uma plataforma multiusuário. Use sempre `npm run dev` ou `npm start`, que escutam em loopback; não exponha a porta diretamente nem rode `next` com `--hostname 0.0.0.0`. Veja [SECURITY.md](SECURITY.md) e os limites completos em [docs/seguranca.md](docs/seguranca.md).

## Problemas comuns

| Sintoma | Confira |
| --- | --- |
| Node incompatível | Use Node LTS 22.13+ ou 24 |
| `npm` bloqueado no PowerShell | Use `npm.cmd ci` / `npm.cmd run dev` |
| Porta 3300 ocupada | Defina `PORT=3301` no `.env.local` (ou use `npm run dev -- --port 3301`) e abra 3301; `PORT` no terminal vence o `.env.local` |
| Telas continuam no demo depois do populate | Reinicie o `npm run dev`; confira `npm run populate:status` e os avisos do comando (por exemplo, `sqlite3` ausente) |
| Primeira tela demora | Aguarde a compilação; mantenha o terminal aberto |
| Nenhum dado pessoal aparece | É esperado no demo; importe/configure sua própria base |
| `sqlite3`, `pdftotext` ou `yt-dlp` ausente | Ferramentas opcionais das integrações, não necessárias para navegar no demo e ler os PDFs |
| Acesso externo retorna 403 | Configure Cloudflare Access e o proxy conforme a documentação |
| Busca semântica indisponível | Confira as variáveis do provider; o demo funciona sem elas |

## Dicionário

**Clone:** cópia do repositório. **Branch:** linha de desenvolvimento. **Worktree:** outra pasta ligada ao mesmo Git. **Provider:** fonte de busca/grafo escolhida. **Demo:** conteúdo original de demonstração. **Importação:** cópia autorizada do seu material para os formatos que o app lê.

## Planos e licença

O aplicativo e os exemplos originais desta edição seguem [MIT](LICENSE): você pode usar, modificar e redistribuir, preservando o aviso de licença. Dependências e serviços externos mantêm suas próprias licenças. O Megabrain é um projeto separado; instalar este app ao lado dele não altera seus termos.

Não distribua livros, cursos, imagens, dados pessoais ou outros materiais de terceiros sem autorização apropriada. O conteúdo que você importar permanece sob sua responsabilidade e os direitos dos respectivos titulares.

Criado por Romulo Henricco (Homer), com contribuições da comunidade Outlier e Bilhon.
