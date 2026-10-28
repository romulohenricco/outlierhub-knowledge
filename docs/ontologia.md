# Ontologia

A página `/ontologia` desenha, em tela cheia, um mapa de "como as suas coisas se organizam". **Quem usa define o esquema**: você escolhe quantas camadas existem, como se chamam, o que mora em cada uma e como os itens se relacionam. O template não traz nenhuma camada, nome, cor ou regra pronta.

Ela tem dois modos de canvas (árvore e grafo de força), um painel por nó com um **Raio-X** (resumo, mini-grafo, dados, relações e fonte) e, abaixo do canvas, um card por camada, as suas regras e uma tabela de itens por camada. Tudo é só leitura e roda sem rede.

## Configuração

| Variável | Para que serve | Padrão |
| --- | --- | --- |
| `BILHON_ONTOLOGIA_MANIFEST` | Arquivo YAML ou JSON com a ontologia, **dentro de `BILHON_ROOT`** | ausente (estado vazio) |

Sem a variável, ou com o arquivo ausente, fora da raiz, ilegível ou sem a lista `camadas`, a página abre um estado vazio que diz qual desses casos é e mostra um exemplo mínimo. Reinicie o app depois de definir a variável; o conteúdo do arquivo é lido a cada visita, então editá-lo não exige reiniciar. A contenção por `BILHON_ROOT` e o teto de 8 MB por arquivo são os mesmos do inventário de agentes (veja [`agente-registro.md`](agente-registro.md#contenção)).

## Formato do arquivo

Só `camadas` é obrigatória (com ao menos uma camada que tenha `id`). Um arquivo sem `camadas`, inclusive um escrito para outro esquema, é tratado como vazio, sem erro.

```yaml
titulo: Minha ontologia            # nome do nó raiz (padrão: "Ontologia")

camadas:                           # 1..50, na ordem de exibição (a posição vira o código 01, 02…)
  - id: planos                     # obrigatório e único
    rotulo: Planos                 # padrão: o id
    descricao: Onde as coisas ficam
    cor: "#5b8cff"                 # opcional: #RGB ou #RRGGBB; sem ela, cor estável a partir do id
    itens:
      - id: casa                   # obrigatório e único dentro da camada
        nome: Casa                 # padrão: o id
        descricao: Onde moro
        status: ativo              # texto livre; vira um selo
        fonte: notas/casa.md       # só exibido
        dados:                     # pares livres, listados na aba "dados" do Raio-X
          responsavel: eu
        ligacoes:                  # relações com itens de qualquer camada
          - { camada: temas, item: financas, rotulo: usa }
      - id: quarto
        nome: Quarto
        pai: casa                  # hierarquia: outro item da MESMA camada

  - id: temas
    rotulo: Temas
    itens:
      - { id: financas, nome: Finanças, status: rascunho }

status_cores:                      # opcional: cor do selo de cada status (sem entrada, cor estável)
  ativo: "#4ade80"

regras:                            # opcional: lista livre mostrada no bloco de referência
  - { id: r1, titulo: Um item só mora em uma camada, descricao: Se ele serve a duas, crie uma ligação. }
```

### Como vira grafo

- Raiz → camadas → itens. A aresta de hierarquia vem de `pai`; as relações (tracejadas, com o `rotulo` da ligação, ou "liga a") vêm de `ligacoes`.
- A cor de um item é a da sua camada. A do selo de status vem de `status_cores` ou, sem entrada, de uma paleta escolhida pelo próprio texto do status.
- O card de referência de cada camada mostra a descrição, a contagem de itens e os itens de primeiro nível.

### O que é descartado, sem derrubar a página

| Caso | O que acontece |
| --- | --- |
| camada ou item sem `id`, ou com `id` repetido (vale o primeiro) | ignorado; itens ignorados são contados |
| `ligacoes` para item ou camada que não existe, ou para o próprio item | ignorada e contada; a página avisa quantas |
| `pai` que não existe, é de outra camada ou é o próprio item | ignorado |
| `pai` circular (A → B → A) | quem está no ciclo volta para a camada |
| `cor` fora de `#RGB`/`#RRGGBB` | ignorada (cor estável) |
| texto acima do limite | cortado: id e rótulos 120 caracteres, descrição 2000, status 40, fonte 300, chave de `dados` 80, valor 1000 |
| quantidade acima do limite | o excedente é ignorado: 50 camadas, 2000 itens no arquivo, 50 ligações e 50 `dados` por item, 100 `status_cores`, 200 regras |

## Gerada pelo `npm run populate`

Com o app dentro do Megabrain, o módulo `ontologia` do [`npm run populate`](../README.md#popular-com-o-megabrain-npm-run-populate) (`scripts/populate/ontologia.mjs`) gera `data/ontologia/ontologia.yaml` com o DNA dos especialistas, e o módulo `ambiente` aponta `BILHON_ONTOLOGIA_MANIFEST` para ele. Nada é escrito sem fonte:

- **Fonte**: `knowledge/external/dna/persons/<slug>/*.yaml` e `knowledge/business/…`, só lidos. `knowledge/personal` nunca entra, nem com `--include-personal`.
- **Camadas**: `especialistas` (uma pessoa por pasta) e, na ordem L1…L10, filosofias, modelos mentais, heurísticas, frameworks, metodologias, padrões de comportamento, hierarquia de valores, DNA de voz, obsessões e paradoxos; camada sem nenhum item não aparece. A descrição de cada camada vem da tabela "DNA Schema (10 Layers)" do `.claude/CLAUDE.md` do Megabrain e a única regra (FILOSOFIA → … → METODOLOGIA), de `engine/intelligence/rag/ontology_layer.py`, ambas com arquivo e linha. Sem esses arquivos, a camada fica sem descrição e não há regra.
- **Itens**: id `<especialista>/<id do YAML>` (sem id ou com id repetido, `<especialista>/<lista>-<posição>`, contado e avisado); `fonte` = arquivo do Megabrain + `#<id>`; `nome`, `descricao`, `status` e `dados` são campos do próprio YAML, com o nome original. Todo item de DNA liga ao seu especialista (`de`); entre itens de DNA, só quando um campo `*_id`/`*_ids` aponta para outro item que existe (ex.: `behavioral_pattern_id`). `insight_ids`, `chunk_ids` e `source_ids` ficam nos dados.
- **Tetos**: o arquivo já sai dentro dos limites da tabela acima, então a página não descarta nada. O excedente é cortado de forma determinística e contado nos avisos do comando e em `npm run populate:status`; nome longo termina em "…" e o texto inteiro fica na descrição.
- **Arquivo seu**: o gerado leva `gerado_por: populate:ontologia` e só é regravado quando muda. Um `data/ontologia/ontologia.{yaml,yml,json}` sem essa marca é seu e manda: o comando não grava por cima e avisa. Para editar o gerado, copie-o para outro nome e aponte `BILHON_ONTOLOGIA_MANIFEST` para a cópia numa linha sua do `.env.local`.
