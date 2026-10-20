# Agente · registro e estado local

A página `/agente` é um inventário **somente leitura** de squads, agents, skills,
workflows, clones, shadows, workers, engines e repositórios. Ela mostra apenas o que
você configurar: sem configuração o inventário fica vazio e a tela diz o que falta.
O inventário não faz chamadas de rede e nada é gravado fora da raiz permitida (abaixo).

A página tem três visões, escolhidas pelas abas da barra superior (ou por `?visao=`):
**Cards** (o catálogo), **Radial** e **Neural** (o grafo do ecossistema, com a faixa de
saúde abaixo). Os grafos desenham o inventário, a sua organização em pilares e uma pasta
de notas; as duas últimas fontes estão em [Grafo](#grafo-radial-e-neural).

## Variáveis de ambiente

Todas são opcionais. Variável em branco vale como ausente.

| Variável | Para que serve | Padrão |
| --- | --- | --- |
| `BILHON_ROOT` | Raiz que contém tudo o que o inventário, os add-ons e a topologia leem e gravam (substitui o padrão; veja "Contenção") | diretório onde o app é iniciado (a raiz do projeto) |
| `BILHON_REGISTRO_ENTIDADES` | Registro de entidades (YAML ou JSON) | desligado (lista vazia) |
| `BILHON_AGENTE_DIR` | Estado local: repos, espelhos, uso, favoritos, ocultos | `data/agente` |
| `BILHON_REPOS_JSON` | Lista de repositórios | `<BILHON_AGENTE_DIR>/repos.json` |
| `BILHON_AGENTES_JSON` | Lista de itens espelhados | `<BILHON_AGENTE_DIR>/espelhos.json` |
| `BILHON_OWNERS_PROPRIOS` | Owners próprios, separados por vírgula | vazio |
| `BILHON_ADDONS_DIR` | Catálogo de add-ons (`manifest.json` + `artifacts/`) | `data/addons` |
| `BILHON_TOPOLOGY_DIR` | Extrato da topologia (`nodes.json` + `edges.json`) | `data/topology` |
| `BILHON_BRAIN_ORG_JSON` | Organização do grafo: pilares, agentes, pessoas, tarefas e ferramentas (JSON) | `<BILHON_AGENTE_DIR>/organizacao.json` |
| `BILHON_BRAIN_STORE` | Pasta de notas `.md` do núcleo de memória do grafo | `<BILHON_AGENTE_DIR>/memoria` |

## Contenção

Todo caminho lido ou gravado precisa estar dentro de `BILHON_ROOT`. São recusados:
caminhos fora da raiz, caminhos UNC (`\\servidor\pasta`, `//servidor/pasta`) e
qualquer symlink ou junction cujo destino real saia da raiz, mesmo para um arquivo
que ainda não existe. Para ler arquivos de outra pasta, aponte `BILHON_ROOT` para
uma pasta que contenha todos eles.

`BILHON_ROOT` **substitui** a pasta do projeto como raiz, não a soma a ela. As pastas
de estado (`data/agente`, `data/addons` e `data/topology`, ou as variáveis
`BILHON_AGENTE_DIR`, `BILHON_ADDONS_DIR` e `BILHON_TOPOLOGY_DIR` que as substituem)
também precisam ficar **dentro** da raiz escolhida. Se você mudar `BILHON_ROOT`,
confira esses caminhos. Quando uma delas fica fora, o app não cai: o recurso
correspondente é recusado e a tela abre sem ele.

- **Agente:** a página abre sem favoritos nem ocultos. Se não houver nenhuma entidade
  carregada, a lista de fontes mostra o estado "fora de BILHON_ROOT (recusada)" ao lado
  de cada fonte que está fora. Marcar estrela ou lixeira não grava (a chamada falha com
  500).
- **Add-ons:** `/addons` abre com o catálogo vazio.
- **Topologia:** a camada do grafo fica indisponível. O aviso na tela fala em "extrato
  não encontrado"; o motivo real (`Caminho fora da raiz permitida (BILHON_ROOT).`) está no
  balão que aparece ao passar o mouse sobre o aviso.

## Registro de entidades

YAML ou JSON, com a lista em `entities` (a lista pode vir também direto na raiz do
arquivo). Cada linha:

| Campo | Obrigatório | Significado |
| --- | --- | --- |
| `api_name` | sim | Nome da entidade |
| `tipo` | sim | `squad`, `agent`, `skill`, `workflow`, `clone`, `shadow`, `worker`, `engine` ou `repo` |
| `observed` | sim | Lista de caminhos (absolutos ou relativos a `BILHON_ROOT`, com `#fragmento` opcional). Vale o primeiro que estiver dentro da raiz; sem nenhum, a linha é descartada |
| `rid` | não | Identidade da entidade, usada como veio. Sem `rid`, a identidade é `tipo:registro:api_name` |
| `role` | não | Descrição (até 400 caracteres) |
| `status` | não | Vira uma tag |
| `squad` | não | `api_name` de um squad do mesmo registro; liga o item ao squad |
| `procedencia` | não | `propria`, `adotada` ou `terceiro` |
| `owner` | não | Dono do item; ver "Procedência" |

```yaml
entities:
  - api_name: equipe
    tipo: squad
    rid: exemplo.squad.equipe
    role: Time de exemplo
    observed: [agentes/equipe]
  - api_name: revisor
    tipo: agent
    squad: equipe
    observed: [agentes/revisor/AGENT.md#perfil]
```

Linhas com `tipo` desconhecido, sem `api_name` ou com `rid` repetido são ignoradas
(vale a primeira).

## Estado local

Em `BILHON_AGENTE_DIR` (padrão `data/agente`):

- `repos.json` — lista de objetos `{ slug, path, owner?, repo?, source?, tier?, category?, procedencia?, github? }`.
  `path` é relativo a `BILHON_ROOT`. `github` aceita `description`, `html_url`, `stars`,
  `forks`, `language`, `topics`, `license`, `archived`, `fork`, `last_push`.
- `espelhos.json` — lista de objetos `{ id, type, name, source_path, label?, description?, category?, source_label?, owner_squad?, status?, version?, user_invocable?, procedencia? }`.
  `type` pode ser `skill`, `reference`, `squad`, `clone` ou `agent` (agent com `owner_squad` vira worker); outros valores são ignorados.
  `reference` é sempre de terceiro.
- `uso.json` — `{ "uso": { "<id da entidade>": { "status": "...", ... } } }`: a evidência de
  uso de cada entidade, **medida pelo seu processo** (o app não calcula nada, só lê e mostra).
  A chave é o `id` da entidade (veja "Ids das entidades" abaixo; a linha expandida de cada
  item da página mostra o `id`). Quando o arquivo existe, a tela mostra o filtro e o selo de
  evidência de uso. Só `status` é obrigatório: sem um `status` válido, ou com uma chave que
  não casa com nenhum `id`, a linha é ignorada. Os demais campos são opcionais; ausentes (ou
  de tipo errado) valem `0`, `false`, `null`, `"atribuida"` ou `[]`, conforme o campo.

  | Campo | O que o app faz com ele |
  | --- | --- |
  | `status` | `frequente`, `ocasional`, `raro` ou `sem-sinal`. Vira o selo do item e o filtro "evidência de uso". A legenda da tela segue esta convenção: frequente = 20 ou mais na fonte mais forte; ocasional = 5 a 19; raro = 1 a 4; sem-sinal = nenhum sinal (leia como "uso desconhecido", não como "sem uso") |
  | `sinais` | número de 0 a 3: quantas das fontes de medição trouxeram algum sinal. Quando maior que 0, o selo mostra `N/3 fontes` |
  | `fontes` | lista de textos livres que dizem de onde veio cada número; aparece no balão do selo e na linha expandida do item |
  | `proveniencia` | `"incerta"` mostra um aviso no item (parte do volume pode vir de teste automatizado, não de uso); qualquer outro valor vale `"atribuida"` |
  | `eventos`, `logsession`, `invocacao`, `leitura_fraca` | contagens por fonte: entradas de um log de execução com esse id; registros de sessão que citam o componente; invocações observadas; leituras do arquivo da skill (evidência fraca). São lidas e guardadas, mas esta versão da tela não as exibe |
  | `dias`, `ultimo` | dias distintos com atividade e o último dia com atividade (`AAAA-MM-DD`). Lidos e guardados, sem exibição |
  | `ambiguo`, `tocada_por_teste` | `true` ou `false`: o nome do componente colide com uma palavra comum (menções não contadas); o componente é exercitado por teste automatizado. Lidos e guardados, sem exibição |

  ```json
  {
    "uso": {
      "agent:registro:revisor": { "status": "ocasional", "sinais": 2, "fontes": ["log de execução: 7 eventos em 3 dias"] },
      "repo:repos:meu-repo": { "status": "sem-sinal" }
    }
  }
  ```
- `favoritos.json` e `ocultos.json` — gravados pela própria tela (estrela e lixeira).
  A gravação é atômica e serializada; um arquivo corrompido nunca é sobrescrito.

Itens que apontam para fora da raiz são descartados. Itens de `repos.json` e
`espelhos.json` que repetem o tipo e o caminho de uma entidade do registro não
aparecem duas vezes: vale o registro.

## Grafo (Radial e Neural)

As visões **Radial** e **Neural** desenham até três fontes, todas opcionais e somente leitura.
Sem nenhuma delas o grafo abre vazio, com a explicação de como popular.

1. **Inventário** (o mesmo dos Cards): vira *pilares por fonte*. Cada pasta de primeiro nível
   dos caminhos das entidades (relativos a `BILHON_ROOT`) é um pilar, até oito: havendo mais pastas,
   as sete maiores aparecem e o resto se junta em "outras (N)". Entidade sem pasta cai em "raiz". Dentro do pilar, as
   fileiras são squads, workers/agents e skills, ligados pelo `squad` do registro.
2. **Organização** (`BILHON_BRAIN_ORG_JSON`): os seus pilares, com agentes, pessoas, tarefas e
   ferramentas. Aparece na frente do anel, na ordem do campo `ordem`.
3. **Notas** (`BILHON_BRAIN_STORE`): o núcleo de memória no centro do radial.

### Organização

Um JSON com cinco listas. Todas são opcionais, e o que estiver malformado é ignorado em vez de
derrubar a página. Os `id` são livres (texto ou número) e só precisam ser únicos **dentro da
própria lista**: o app os prefixa por categoria na leitura.

| Lista | Campos (obrigatórios em negrito) |
| --- | --- |
| `pilares` | **`id`**, **`nome`**, `tagline`, `ordem` (número; padrão: posição no arquivo), `cor` (`#rrggbb`; padrão: paleta), `icone` (um de `alvo`, `carteira`, `pessoas`, `crescimento`, `chip`, `mensagem`, `camadas`, `paleta`, `rota`, `grade`, `codigo`; padrão `camadas`) |
| `ferramentas` | **`id`**, **`nome`**, `categoria` (alimenta a lente "Ação"), `status`, `descricao` |
| `agentes` | **`id`**, **`nome`**, **`pilarId`**, `papel`, `status`, `funcao` (lente "Função"), `descricao`, `modelo`, `ambiente`, `ferramentas` (lista de `id` de `ferramentas`), `paiId` (outro agente: vira "sub-agente") |
| `pessoas` | **`id`**, **`nome`**, **`pilarId`**, `papel`, `ferramentas` |
| `tarefas` | **`id`**, **`titulo`**, **`pilarId`**, `resumo`, `passos` (lista de textos), `executorTipo` (`agent` ou `person`), `executorId` |
| `execucoes` | **`agenteId`**, **`iniciadoEm`** (texto ordenável, como `2026-01-31T10:00:00Z`), `terminadoEm`, `ok` (booleano), `resumo`, `status`. Vale a de `iniciadoEm` mais recente por agente |

```json
{
  "pilares": [
    { "id": "ops", "nome": "Operação", "icone": "camadas", "cor": "#22c55e" },
    { "id": "vendas", "nome": "Vendas", "icone": "alvo", "ordem": 2 }
  ],
  "ferramentas": [{ "id": "planilha", "nome": "Planilha", "categoria": "dados" }],
  "agentes": [{ "id": "triagem", "nome": "Triagem", "pilarId": "ops", "funcao": "worker", "ferramentas": ["planilha"] }],
  "pessoas": [{ "id": "ana", "nome": "Ana", "pilarId": "ops" }],
  "tarefas": [{ "id": "t1", "titulo": "Triar pedidos", "pilarId": "ops", "executorTipo": "agent", "executorId": "triagem", "passos": ["abrir a fila", "classificar"] }]
}
```

Regras: agente, pessoa ou tarefa cujo `pilarId` não existe em `pilares` é descartado (o grafo
avisa quantos); referência a ferramenta ou pai inexistente é omitida; `id` repetido na lista
vale a primeira linha; `cor` ou `icone` inválidos voltam ao padrão; até 2000 linhas por lista e
4 MB por arquivo. Os nomes de pessoas só existem na renderização local da página.

### Notas

Uma pasta de arquivos `.md`. As pastas de primeiro nível viram os *hubs* do núcleo. As ligações
vêm só de `[[wikilinks]]` e de links `.md` relativos que realmente resolvem; só entram no
desenho as notas com pelo menos um link (até 300, as de maior grau), e a tela mostra "N de M".
O título sai do campo `name`, `title` ou `titulo` do front matter, senão do primeiro `# `, senão
do nome do arquivo. Ficam de fora: pastas e arquivos ocultos (começam com `.`), `node_modules`,
links simbólicos, arquivos acima de 512 KB, profundidade acima de 8 níveis e o que passar de
5000 arquivos. O resultado é guardado em cache por 60 segundos.

### Estados

| Situação | O que acontece |
| --- | --- |
| Nada configurado | grafo vazio e a página de Agente mostra o estado de cada fonte |
| Arquivo de organização ausente | normal: nenhum aviso |
| Arquivo fora de `BILHON_ROOT`, JSON inválido ou grande demais | aviso "Organização indisponível" no grafo; o resto segue |
| Pasta de notas ausente, vazia ou fora de `BILHON_ROOT` | núcleo de memória não aparece |

## Ids das entidades

O `id` identifica a entidade em `uso.json`, em `favoritos.json` e em `ocultos.json`, e é
o campo `id` que a página e `GET /api/agente` devolvem. Ele é formado assim:

| Origem | `id` | Exemplo |
| --- | --- | --- |
| Registro de entidades | o `rid`, quando informado (usado como veio); senão `<tipo>:registro:<api_name>` | `exemplo.squad.equipe`, `agent:registro:revisor` |
| `repos.json` | `repo:repos:<slug>` | `repo:repos:meu-repo` |
| `espelhos.json` | `<tipo>:espelho:<rótulo>:<id do item>` | `skill:espelho:minha-colecao:minha-skill` |

No caso dos espelhos, `<tipo>` é o tipo da entidade resultante: `skill` para `type: skill`
e para `type: reference`; `squad`, `clone` e `agent` para os de mesmo nome; `worker` quando
um `agent` traz `owner_squad`. O `<rótulo>` é o `source_label` do item; sem ele, a
`category`; sem ela, `desconhecido`. Se o `id` mudar (por exemplo, ao renomear um
`api_name` sem `rid`), as marcações e a evidência de uso gravadas com o `id` antigo deixam
de casar. Por isso, num registro que você vai manter, vale fixar um `rid` em cada linha.

## Procedência

Cada item recebe um eixo de admissão: `propria`, `adotada` ou `terceiro`. A primeira
regra que casar decide:

1. a fonte marca o item como de terceiro (`type: reference` em `espelhos.json`) → `terceiro`;
2. a fonte traz `procedencia` com um dos três valores → esse valor;
3. `BILHON_OWNERS_PROPRIOS` não está vazio e o `owner` do item não consta nele → `terceiro`;
4. caso contrário → `propria`.

## Add-ons e topologia

Usam a mesma raiz e a mesma contenção. Ambos nascem vazios; o template não traz gerador
de nenhum dos arquivos abaixo.

### Add-ons

Um catálogo local de padrões reaproveitáveis (design systems, checklists, funções,
recriações de app). Pasta `BILHON_ADDONS_DIR` (padrão `data/addons`):

```
data/addons/
  manifest.json                 o catálogo
  artifacts/<slug>/<arquivo>    o texto de cada artefato; <slug> é o id do add-on sem o prefixo "<categoria>:"
```

`manifest.json` é `{ "entries": [...] }`. Exemplo completo (o `checksum` abaixo é um valor
de fábrica: troque-o pelo SHA-256 do arquivo, veja o comando mais adiante):

`data/addons/manifest.json`:

```json
{
  "entries": [
    {
      "id": "function-utility:exemplo-notas",
      "type": "addon",
      "category": "function-utility",
      "title": "Notas de exemplo",
      "summary": "Um texto curto de exemplo.",
      "areaBos": "modulos",
      "source": { "repository": null, "revision": null, "license": "mit", "bucket": "synthetic" },
      "artifacts": [
        {
          "id": "notas.md",
          "media_type": "text/markdown",
          "size": 39,
          "checksum": "0000000000000000000000000000000000000000000000000000000000000000"
        }
      ],
      "preview_kind": "none",
      "approval": "aprovado",
      "distribution": "interno"
    }
  ]
}
```

`data/addons/artifacts/exemplo-notas/notas.md`:

```markdown
# Notas de exemplo

Texto do artefato.
```

| Campo | Obrigatório | Valores e efeito |
| --- | --- | --- |
| `id` | sim | `<categoria>:<slug>`, único. O `<slug>` (letras, números, `.`, `_`, `-`) é o nome da pasta em `artifacts/` |
| `type` | sim | sempre `"addon"` |
| `category` | sim | `design-system`, `framework-checklist`, `function-utility` ou `app-recreation` |
| `title`, `summary` | sim | texto exibido (`summary` pode ser vazio) |
| `areaBos` | não | faceta de interface: `dashboards`, `login`, `modulos`, `rules`, `skills` ou `antipattern` |
| `source` | sim | `{ repository, revision, license, bucket }`. `license`: `mit`, `apache-2.0`, `bsd`, `unlicensed`, `proprietary` ou `unknown`. `bucket`: `confirmed_prod`, `synthetic` ou `quarantined`. `repository` e `revision` podem ser `null` |
| `artifacts[]` | sim (pode ser `[]`) | `{ id, media_type, size, checksum }`. `id` é o nome do arquivo (sem barras), `size` em bytes (até 262144), `checksum` é o SHA-256 em hexadecimal minúsculo (64 caracteres). Um artefato malformado invalida o add-on inteiro |
| `preview_kind` | não | `react`, `html-sandbox` ou `none` (padrão). O app nunca executa o artefato como HTML ou JS; só três ids de exemplo embutidos em `components/Addons.tsx` (`function-utility:exemplo-debounce`, `framework-checklist:exemplo-checklist-lancamento` e `design-system:exemplo-empty-state`) têm preview, e esses add-ons não vêm no template: para os seus esse campo não produz preview |
| `approval` | não | `aprovado`, `pendente` ou `quarentena` (padrão `quarentena`). **Só `aprovado` aparece na lista e serve o artefato** |
| `distribution` | não | `interno` (padrão), `nao-redistribuir` ou `publico` |

Regras de segurança, todas "fecham por padrão":

- um add-on com `license` `unknown` (ou ausente, ou fora da lista), `bucket` `quarantined` (ou ausente, ou fora da lista), ou com algo parecido com e-mail ou chave no `title` ou `summary` vai para a **quarentena**, mesmo que diga `approval: "aprovado"`. A página mostra a quarentena à parte, com origem, cópia e preview desabilitados;
- registro que não passa no esquema é descartado e só entra numa contagem de inválidos;
- `id` repetido: o primeiro vale e o repetido vai para a quarentena;
- o artefato só é servido se o add-on está aprovado, a extensão é `.ts`, `.tsx`, `.md`, `.txt`, `.css`, `.json`, `.yaml` ou `.yml`, o arquivo tem até 256 KiB, não é link simbólico e o SHA-256 do conteúdo **bate** com o `checksum` do manifesto. Se qualquer condição falhar, a resposta é 404. É sempre entregue como texto puro.

Para obter o `checksum` de um arquivo (funciona em qualquer sistema com Node):

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync(process.argv[1],'utf8'),'utf8').digest('hex'))" data/addons/artifacts/exemplo-notas/notas.md
```

A lista é guardada em cache por 60 segundos. O inventário do Agente (registro, repositórios, espelhos e uso) tem o mesmo cache: depois de editar esses arquivos, a página pode levar até 1 minuto para refletir.

### Topologia

Uma camada opcional do grafo que desenha o próprio disco: pastas, scripts, repositórios e as
relações entre eles, para responder "se eu mover X, o que quebra". Pasta `BILHON_TOPOLOGY_DIR`
(padrão `data/topology`), com dois arquivos que você produz com o seu processo. Sem eles o
grafo continua funcionando e a camada informa que o extrato não foi encontrado.

`data/topology/nodes.json`:

```json
{
  "versao": "1",
  "gerado_em": "2026-01-15T12:00:00.000Z",
  "nodes": [
    { "id": "pasta-a", "type": "pasta-relevante", "label": "Pasta A", "path": "/caminho/absoluto/pasta-a" },
    { "id": "script-b", "type": "script", "label": "script-b.sh", "path": "/caminho/absoluto/pasta-a/script-b.sh" },
    { "id": "plano:estudos", "type": "plano", "label": "Estudos" }
  ]
}
```

`data/topology/edges.json`:

```json
{
  "versao": "1",
  "gerado_em": "2026-01-15T12:00:00.000Z",
  "edges": [
    { "src": "script-b", "dst": "pasta-a", "type": "referencia", "n": 3, "escopo": "ativo" },
    { "src": "pasta-a", "dst": "plano:estudos", "type": "pertence_a", "n": 1 }
  ]
}
```

- **Nó:** `id` (único), `type`, `label` e, opcionalmente, `path`, que deve ser **absoluto e no
  formato do seu sistema** (no Windows, `"C:\\pasta\\arquivo"`: no JSON cada barra invertida é
  escrita duas vezes; os exemplos acima usam o formato Unix): é por ele que "o que quebra se eu mover"
  encontra os nós dentro de uma pasta. Tipos conhecidos:
  `pasta-relevante`, `arquivo`, `skill`, `script`, `engine`, `remote`, `hook`, `launchagent`,
  `repo`, `plano`, `dominio`, `app`, `bridge`. O plano de um nó é deduzido das arestas
  `pertence_a` que apontam para um nó de id `plano:<nome>`.
- **Aresta:** `src` e `dst` (ids de nós existentes; aresta com ponta desconhecida é ignorada),
  `type` e `n` (quantas vezes a relação aparece; ordena as arestas quando o limite é atingido).
  Tipos: `contem`, `pertence_a`, `referencia`, `symlink`, `git_remote`, `ponte`, `executa`.
  Por padrão o canvas mostra só os de influência (`referencia`, `symlink`, `git_remote`,
  `ponte`, `executa`); `contem` e `pertence_a` são hierarquia e só entram quando escolhidos.
- **Campos opcionais da aresta:** `alvo_morto` ou `quebrado` (a referência aponta para um
  caminho que não existe), `escopo` (`ativo` = código, documento ou configuração que quebra de
  verdade; qualquer outro valor conta como mera menção em log ou dump), `formas` (contagem por
  forma de citação, `{ "caminho-absoluto": 2 }`), `papel`, `remote`, `url` e `push_desabilitado`.
- O extrato é lido inteiro e guardado em memória; é relido quando o `mtime` de um dos dois
  arquivos muda.

## Grafo: camada de ecossistema e filtro por data

A página `/grafo` pode desenhar o **mesmo inventário** do Agente (squads, agents, skills, workers,
workflows, clones, shadows, engines e repos): uma raiz, um hub por tipo e as entidades; quem tem
`squadId` liga ao squad em vez do hub. Nada é lido a mais: os números batem com `/agente`.

- **Ligar:** botão "ecossistema" na barra do grafo (desligado por padrão, como a topologia).
  Os chips filtram por tipo e por procedência; o botão "conhecimento" tira os conceitos dos
  livros da frente, para ver só o ecossistema. Na API: `/api/graph?ecossistema=1&kinds=skill,squad&procedencias=propria`
  (e `conhecimento=0`).
- **Sem inventário configurado** a camada fica vazia e a tela diz "inventário não configurado". Falha nessa
  camada não derruba o grafo de conhecimento.
- **Com a topologia ligada**, a entidade cujo `path` é igual ao de um nó da topologia ganha a
  aresta `mora em` até a pasta dela.
- **Filtro por data** (últimos 7/30/90 dias, último ano ou intervalo): a data de um nó é
  a última modificação (`mtime`) do `path` dele. Para entidade do ecossistema vale o sinal mais
  recente entre o `mtime`, o último dia de uso (`uso.ultimo`) e o último push (`meta.ultimo_push`).
  Livro e post de referência usam o `mtime` do arquivo ou pasta; o conceito herda a obra mais
  antiga que o sustenta. O `path` só é lido se estiver **dentro de `BILHON_ROOT`** (livros e
  referências: dentro das respectivas pastas); fora dela, ou inexistente, o nó fica sem data.
  Nós sem data são ocultados e contados ("N ocultos"), com um botão para mantê-los. Raiz e hubs
  são estruturais e passam sempre, desde que sustentem algum nó que passou.
