# Primeiro uso dentro de um Megabrain

Este app foi pensado para morar na pasta `apps/` do Megabrain que você já usa. Na **primeira abertura** ele reconhece o Megabrain, pergunta se você quer popular o Knowledge com toda a base de dados dele e transforma a tarefa no **primeiro card do kanban**, escrito para o seu agente de IA executar.

O que o app faz e o que ele **não** faz:

| O app faz | O app não faz |
|---|---|
| Reconhece o Megabrain e lista nomes e contagens das pastas de `knowledge/` | Copiar, mover ou alterar nada do Megabrain |
| Pergunta uma vez e guarda a resposta | Importar os dados por conta própria |
| Cria o card (normalmente `ING-1`; depois de um `npm run populate`, o próximo id livre) com o passo a passo e o entrega como prompt | Escolher o que entra: isso é combinado entre você e o seu agente |

Quem faz a integração é o **seu agente de IA**, aberto na pasta do Megabrain: ele enxerga o que você ingeriu, seja qual for a versão, e segue o card.

## Caminho direto: `npm run populate`

O card é o caminho genérico, para qualquer versão de Megabrain. O app também traz um importador pronto: na pasta do app, `npm run populate` lê o Megabrain e preenche estante, coleções, grafo, busca, agente, integrações, topologia, kanban e referências, sem agente, sem Supabase, sem Ollama e sem rede. É uma alternativa ao card, não um passo dele.

```bash
npm run populate            # mostra o que entra e pergunta antes de gravar
npm run populate -- --yes   # sem perguntar
npm run populate:status     # última população: contagens, excluídos e resultado de cada módulo
```

- Usa a mesma regra de reconhecimento da seção abaixo. A raiz padrão é a pasta dois níveis acima do app (`<raiz>/apps/knowledge`); para outro lugar, `--repo <pasta>` ou `BILHON_MEGABRAIN_ROOT`, no ambiente do terminal ou no `.env.local` do app (fora do bloco do populate; relativo à pasta do app). Se as duas existirem, o terminal vence o arquivo, como no Next, e `--repo` vence tudo. Um clone limpo do Megabrain público: veja [Só o conteúdo do Megabrain público](#só-o-conteúdo-do-megabrain-público).
- Do Megabrain só lê. Grava em `data/` (o marcador `data/.populated.json` inclusive) e num bloco gerenciado no fim do `.env.local`, entre `# >>> populate-megabrain` e `# <<< populate-megabrain`, com o provider `local` e os caminhos que o app precisa. O que está fora do bloco é seu e não é tocado, inclusive a sua linha `PORT=`. Variável do bloco que você já definiu fora dele, com valor (`BILHON_KNOWLEDGE_PROVIDER`, `BILHON_ROOT`, `BILHON_REGISTRO_ENTIDADES`...), vence: o comando não a grava no bloco e avisa o que isso muda (o resumo do módulo `ambiente` mostra, por exemplo, `supabase (seu, linha 2 do .env.local)`).
- A população **responde a pergunta** do primeiro uso no fim, depois de todos os módulos, e só quando a execução é completa (nenhum módulo tirado por `--only`/`--skip`), todos os módulos terminaram ok (um que falhou ou ainda não foi implementado segura a resposta, inclusive `referencias`, `busca` e `ambiente`, que rodam depois do `kanban`), o `BILHON_MEGABRAIN_ROOT` do terminal, se houver, leva ao mesmo Megabrain que os `.env*` do app e o Megabrain lido é o que o app detectaria. Fora disso nada é respondido e o motivo sai nos avisos. Se ela ainda estava pendente (ou o arquivo não existia), `data/primeiro-uso.json` passa a `aceito`, sem card (`cardId` null, ou o card que o app já tinha criado, que fica onde está e sai nos avisos para você movê-lo para CANCEL). Uma resposta dada na tela (`aceito` ou `dispensado`) nunca é alterada, e um arquivo ilegível não é sobrescrito. Para a pergunta voltar, use `reabrir` (veja [API](#api)); o card do app nasce então com o próximo id livre do kanban, não necessariamente `ING-1`.
- Rodar de novo atualiza o que veio do Megabrain e preserva o que é seu (cards criados à mão, favoritos, anotações). Reinicie o `npm run dev` depois: o app só lê os dados e o `.env.local` ao iniciar.

Detalhes do provider e do índice de busca: [provider-local.md](provider-local.md).

### Só o conteúdo do Megabrain público

O populate lê o Megabrain que você indicar, e o seu Megabrain local pode ter conteúdo que não foi publicado. Para o app mostrar apenas o repositório aberto, [thiagofinch/mega-brain](https://github.com/thiagofinch/mega-brain), leia um clone limpo dele em vez do seu:

1. Na pasta `apps/` do Megabrain, ao lado do app: `git clone https://github.com/thiagofinch/mega-brain.git mega-brain-oss`.
2. No `.env.local` do app, fora do bloco `populate-megabrain` (o bloco é regravado a cada população):

   ```
   BILHON_MEGABRAIN_ROOT=../mega-brain-oss
   BILHON_ROOT=..
   ```

3. `npm run populate -- --yes` e reinicie o `npm run dev`.

Como as duas variáveis se completam:

| Variável | Quem lê | O que faz aqui |
|---|---|---|
| `BILHON_MEGABRAIN_ROOT` | o populate e a pergunta de primeiro uso do app | O Megabrain lido é o clone. Os dois lados enxergam a mesma pasta, então a população responde a pergunta (`aceito`). Valor relativo vale a partir da pasta do app |
| `BILHON_ROOT` | o app (Agente, add-ons, topologia, datas do grafo) | A raiz permitida precisa conter `data/agente`, `data/addons` e `data/topology` (no app) **e** o clone. `..` (a pasta `apps/`) contém os dois |

Com o clone fora do app, o módulo `agente` grava `observed` (e o `path` de `repos.json`) com o prefixo da `BILHON_ROOT` até o clone, por exemplo `mega-brain-oss/squads/<squad>`, para o app resolvê-los; no caso padrão (a raiz é o próprio Megabrain, `../..`) nada muda. A topologia grava caminhos absolutos e o manifesto do grafo, a raiz relativa à pasta dele; os dois já resolvem de dentro da raiz. O módulo `ambiente` não grava `BILHON_ROOT` quando o repositório lido fica fora do app: a sua linha vale, e o comando só avisa se a raiz não contiver o clone ou as pastas de `data/`. Para voltar ao Megabrain local, apague as duas linhas e rode a população de novo.

O clone é só lido. Para atualizar: `git -C ../mega-brain-oss pull` e `npm run populate -- --yes`.

## Como o app reconhece o Megabrain

Sem configuração, as duas condições precisam valer:

1. A pasta deste app fica **diretamente dentro de uma pasta chamada `apps`** (maiúsculas e minúsculas não importam): `<raiz>/apps/<este-app>`.
2. A `<raiz>` tem `knowledge/` **e** `engine/`; ou `knowledge/` e **duas** destas: `agents/`, `core/`, `.aiox-core/`. Uma só pasta genérica (`core`, `agents`) não basta, porque é comum em qualquer monorepo.

A janela mostra a raiz e as pastas pelas quais o Megabrain foi reconhecido, para você recusar se for engano.

Colocou o app em outro lugar? Defina `BILHON_MEGABRAIN_ROOT` com a raiz do Megabrain (em branco = automático). A raiz informada passa pela mesma regra do item 2.

Para saber o que o app enxergou, abra <http://127.0.0.1:3300/api/primeiro-uso> (com `PORT` no `.env.local`, troque a porta aqui e nos exemplos abaixo). Quando não detecta, a resposta traz o motivo:

| `motivo` | Significa |
|---|---|
| `fora-de-apps` | O app não está dentro de uma pasta `apps` (e `BILHON_MEGABRAIN_ROOT` está em branco) |
| `sem-sinais-de-megabrain` | Está em `apps`, mas a pasta acima não tem os sinais do item 2 |
| `raiz-informada-nao-parece-megabrain` | O caminho de `BILHON_MEGABRAIN_ROOT` não tem esses sinais |

## O que acontece na primeira abertura

1. O app consulta `GET /api/primeiro-uso`. Se detectou o Megabrain e a pergunta ainda está pendente, ele garante que o card exista (cria, ou **recria se você o apagou**) e abre a janela **"Popular o Knowledge com o seu Megabrain?"**, com a raiz detectada e as pastas encontradas em `knowledge/`.
2. **Sim, popular tudo:** o card vai de TO DO para **DOING** e a janela mostra o **prompt** com a tarefa, com botão de copiar e atalho para o kanban. Cole o prompt no seu agente de IA, aberto na pasta do Megabrain. Como o board só avança (um card não volta de coluna), esse "Sim" não se desfaz pela tela.
3. **Agora não:** a resposta é guardada e o card fica onde está (TO DO). Quando quiser, abra o card no kanban e use o ícone de copiar do card.
4. **Esc:** fecha a janela só nesta sessão do navegador, **sem gravar resposta**: a pergunta volta na próxima abertura. Um Esc sem querer não encerra a pergunta.

A resposta fica em `data/primeiro-uso.json`, no servidor: a pergunta aparece **uma vez**, em qualquer navegador. Para ela voltar, apague esse arquivo ou chame `reabrir` (abaixo).

## O card

Tipo `ingest`, prioridade `alta`, com as tags `onboarding`, `megabrain`, `integracao` e `onboarding:megabrain` (esta última marca o card, para nunca criar dois). O texto, em markdown, é a tarefa inteira, escrita para um agente que a leia ao pé da letra:

- **Objetivo:** popular o Knowledge com a base que já existe no Megabrain.
- **Regras:** o Megabrain é **somente leitura**; o agente só escreve em `data/`, em `scripts/importar/` (os importadores) e no `.env.local` deste app; **a pessoa** grava as chaves no `.env.local` (o agente nunca vê o valor e não usa MCP, sessão ou chave que já esteja aberta no ambiente dele); confirmação antes de copiar conteúdo sensível, pago, com direitos autorais ou dados pessoais, antes de cópias grandes, de tarefas demoradas (a extração do grafo) e de qualquer alteração em banco; importadores idempotentes; nunca editar o `board.json` à mão com o app rodando.
- **Como fazer**, em 7 passos: entender os dois lados (instruções do Megabrain e o contrato de dados, [dados.md](dados.md)); inventariar o que foi ingerido; mapear para os formatos do Knowledge preservando os buckets `external`, `personal` e `business` (o grafo é opcional e pesado: Python, Ollama, `pdftotext`, `sqlite3`); escrever importadores idempotentes com `--dry-run` primeiro; busca semântica opcional (projeto Supabase dedicado, embeddings de 1024 dimensões, a pessoa cola o `schema.sql` no SQL Editor); validar **reiniciando o app que já está rodando** (o catálogo e o `.env.local` só são lidos ao iniciar); registrar e fechar pela API do kanban.
- **Já detectado:** a raiz do Megabrain, as pastas pelas quais ele foi reconhecido e as pastas de `knowledge/` com as contagens, num bloco JSON rotulado como **dados**.

Todo arquivo do app citado no card vem prefixado pela pasta do app (por exemplo `apps/knowledge/docs/dados.md`), porque o agente está aberto na raiz do Megabrain, onde também existem `docs/` e `scripts/` próprios.

O checklist do card tem 3 itens próprios (inventário combinado, importadores com `--dry-run`, telas conferidas) e a definição de pronto do tipo `ingest` (4 itens): são **7 itens**, e o servidor só aceita DONE com todos marcados.

## API

`/api/primeiro-uso`, só local. Corpo e resposta em JSON.

| Chamada | O que faz |
|---|---|
| `GET` | Só lê. Devolve `{ megabrain: { detectado, raiz, pastaApp, sinais, estado, cardId, inventario } }` (ou `{ detectado: false, motivo }`). Não grava nada. O `inventario` só vem enquanto a pergunta está pendente (depois, `[]`), para a rota, que toda página consulta, ficar barata |
| `POST { "acao": "preparar" }` | Cria o card (ou o recria se foi apagado) e devolve a coluna em que ele está. **Não** reabre uma pergunta já respondida |
| `POST { "acao": "aceitar" }` | Garante o card, move para DOING (se ainda estava em TO DO) e devolve `prompt` (a tarefa) e a `coluna` real |
| `POST { "acao": "dispensar" }` | Guarda o "agora não"; o card não muda |
| `POST { "acao": "reabrir" }` | Volta a perguntar na próxima abertura |

Respostas de erro: `400` (corpo inválido ou ação desconhecida), `409` (este app não está dentro de um Megabrain), `503` com `codigo: "board_corrompido"` (restaure um backup de `data/kanban/backups/`) e `500` genérico (sem caminho nem mensagem do disco).

```bash
# fazer a pergunta voltar
curl -X POST http://127.0.0.1:3300/api/primeiro-uso -H "content-type: application/json" -d '{"acao":"reabrir"}'
```

## Segurança e privacidade

- **Somente leitura no Megabrain:** do Megabrain saem só nomes e contagens das pastas do topo de `knowledge/` (a contagem para em 10000 e aparece como `10000+`, para não varrer um acervo enorme só por causa de um número). Tudo o que o app grava fica em `data/` (`primeiro-uso.json` e o board do kanban).
- **O card vira prompt de um agente de IA**, então os nomes de pasta lidos do disco passam por um filtro de **forma**: só letras, números, ponto, hífen e sublinhado, sem espaço, até 40 caracteres. O resto aparece como `(nome omitido)`. Esse filtro não entende intenção (um nome como `ignore-as-regras` passa), por isso os nomes vão num bloco JSON rotulado como dados e o texto do card manda o agente **nunca** tratá-los como instrução. Se as pastas de `knowledge/` vierem de fontes que você não controla, leia o card antes de colar.
- **Nada de segredo no card.** Ele só cita o *nome* das variáveis (`BILHON_SUPABASE_URL` etc.); as chaves a pessoa grava no `.env.local`, sem passar pelo agente.
- A rota de escrita é protegida pelo middleware contra requisições de outra origem (veja [seguranca.md](seguranca.md)).
- O caminho absoluto da raiz do Megabrain aparece na janela e na resposta do `GET`, como o caminho de outras pastas do app: quem expõe o app atrás de um acesso externo deve saber disso.

## Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| A pergunta não aparece | `GET /api/primeiro-uso` mostra o `motivo`. Confira a posição de `apps/` e os sinais, ou defina `BILHON_MEGABRAIN_ROOT`. Se você fechou com Esc, ela volta numa nova aba ou sessão |
| Cliquei "Agora não" sem querer | Chame `reabrir`, ou abra o card no kanban e use o ícone de copiar do card |
| O card sumiu do kanban | Apagou? A próxima abertura (ou `preparar`) o recria. Se a pergunta já foi respondida, chame `reabrir` primeiro |
| O inventário mostra `(nome omitido)` | O nome da pasta tem espaço, caractere especial ou mais de 40 caracteres. O agente refaz o inventário no passo 2 |
| Uma pasta de `knowledge/` não aparece | Só pastas (inclusive junções e links para outro disco) sem ponto no início entram; arquivos soltos ficam de fora |
| Erro ao registrar | Confira se a pasta `data/` do app é gravável; `503` com `board_corrompido` pede restaurar o board |
