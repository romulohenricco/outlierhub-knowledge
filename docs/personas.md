# Personas (aba de `/ingestoes`)

A página **Ingestões** tem uma aba **Personas**: um carrossel de perfis de operador, cada um
com organograma (núcleo, pilares e agentes), conectores, métricas e uma "jogada-assinatura".
`?aba=personas` abre direto nela; as setas do teclado trocam de persona e o painel lateral
filtra por nome, origem, arquétipo, conector e pilar.

O app **não traz nenhuma persona**. Você descreve as suas num JSON e aponta para ele:

| Variável | O que é | Padrão |
|---|---|---|
| `BILHON_PERSONAS_JSON` | Arquivo JSON com a lista de personas. Precisa ficar **dentro de `BILHON_ROOT`** (a raiz do app, se não definida). | em branco: aba vazia |

Sem a variável, com arquivo ausente, fora da raiz, maior que 1 MB ou com JSON inválido, a aba
abre vazia e diz o motivo; nada quebra. Depois de editar o arquivo, recarregue a página.

## Formato

O arquivo é uma lista de personas ou um objeto `{ "personas": [ ... ] }`. Obrigatórios: `id`,
`nome` e `resumo`. Tudo o mais é opcional.

| Campo | Tipo | Observações |
|---|---|---|
| `id` | texto | único; letras, números, `-` e `_` (até 64). Repetido ou inválido: a persona é ignorada |
| `nome` | texto | até 80 caracteres |
| `resumo` | texto | até 600 caracteres |
| `arquetipo` | texto | rótulo curto (até 40); padrão `Persona`. Aparece no núcleo do organograma e vira filtro |
| `slogan` | texto | frase de uma linha (até 160) |
| `cor` | texto | cor de destaque em hexadecimal (`#5b8cff` ou `#59f`); outro valor usa a cor padrão |
| `estrelaGuia` | texto | o objetivo que guia a persona (até 160) |
| `pilares` | lista | até 12 de `{ "nome", "foco", "agentes": ["..."] }` (até 12 agentes por pilar). Pilar sem `nome` é ignorado |
| `conectores` | lista de textos | até 30; sem repetição. Vira filtro |
| `metricas` | lista de textos | até 20 |
| `memoria` | texto | como a persona usa a base de conhecimento (até 400) |
| `jogadaAssinatura` | texto | a jogada que a distingue (até 400) |
| `origem` | texto | rótulo livre de procedência; padrão `personalizada`. Vira filtro |
| `evidencias` | lista de textos | de onde saiu cada bloco, para conferir (até 20) |

Máximo de 60 personas. Item que não é objeto, sem `id`/`nome`/`resumo` válidos ou repetido é
ignorado, e a aba mostra quantos foram.

## Exemplo

Dados inventados só para mostrar a forma:

```json
{
  "personas": [
    {
      "id": "estudio-solo",
      "nome": "Estúdio solo",
      "arquetipo": "Criador",
      "slogan": "Uma pessoa, um fluxo de produção enxuto",
      "resumo": "Quem produz conteúdo sozinho e precisa de ajuda para planejar, gravar e publicar.",
      "cor": "#5b8cff",
      "estrelaGuia": "Publicar toda semana sem se esgotar",
      "pilares": [
        { "nome": "Planejamento", "foco": "Pauta e calendário", "agentes": ["pauteiro", "calendarista"] },
        { "nome": "Produção", "foco": "Roteiro e edição", "agentes": ["roteirista"] },
        { "nome": "Publicação", "foco": "Distribuição", "agentes": ["agendador", "revisor"] }
      ],
      "conectores": ["Agenda", "Armazenamento", "Chat"],
      "metricas": ["Publicações por semana", "Tempo de produção por peça"],
      "memoria": "Consulta as ingestões para reaproveitar referências e evitar repetir pautas.",
      "jogadaAssinatura": "Transforma cada gravação longa em uma semana de peças curtas.",
      "origem": "exemplo",
      "evidencias": ["Descrição escrita à mão para este exemplo"]
    }
  ]
}
```

Salve como `data/personas.json` (por exemplo), ponha `BILHON_PERSONAS_JSON=data/personas.json`
no `.env.local` e reinicie o app.
