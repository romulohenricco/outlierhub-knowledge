# Páginas e branches

Cada página do Knowledge tem **uma branch própria e um worktree próprio**. Assim dá para
trabalhar numa página sem esbarrar nas outras, sempre na mesma branch.

> **Regra: a branch de uma página nunca é apagada.** Nem depois de um merge, nem por
> limpeza de branches antigas. A página continua sendo trabalhada na mesma branch.

## As páginas

| Página | Branch | Rota | Porta do `dev` |
|---|---|---|---|
| agente | `pagina/agente` | `/agente` | 3311 |
| kanban | `pagina/kanban` | `/kanban` | 3312 |
| backlog | `pagina/backlog` | `/kanban/backlog` | 3313 |
| estante | `pagina/estante` | `/estante` (a raiz `/` encaminha para ela) | 3314 |
| grafo | `pagina/grafo` | `/grafo` | 3315 |
| referências | `pagina/referencias` | `/referencias` | 3316 |
| ontologia | `pagina/ontologia` | `/ontologia` | 3317 |
| ingestões | `pagina/ingestoes` | `/ingestoes` | 3318 |
| integrações | `pagina/integracoes` | `/integracoes` | 3319 |
| social | `pagina/social` | `/mysocialmedia` | 3320 |

As rotas `/ontologia` (veja [`ontologia.md`](ontologia.md)), `/integracoes` e `/mysocialmedia` (com
`/mysocialmedia/instagram`, `/mysocialmedia/youtube` e `/mysocialmedia/<username>`; veja
[`redes-sociais.md`](redes-sociais.md)) existem. O registro (nome, rota, porta) fica em `scripts/paginas.json`.

O servidor principal (`npm run dev`, porta 3300) roda a branch `main`, com todas as páginas
juntas. Cada worktree sobe o próprio servidor na porta da tabela, sem colidir com ele.

## Trabalhar numa página

```bash
node scripts/paginas.mjs listar          # páginas, branches, rotas, portas e pastas
node scripts/paginas.mjs dev estante     # sobe a página no worktree dela (http://127.0.0.1:3314/estante)
```

**Primeira vez num clone novo:** `npm ci` e, só depois, `node scripts/paginas.mjs criar` (sem
`node_modules` na pasta principal as ligações dos worktrees não são criadas). O `criar` faz
cada `pagina/<nome>` local acompanhar a `origin/pagina/<nome>`, com o trabalho que os colegas
já publicaram. Confira com `node scripts/paginas.mjs status`: deve terminar em `tudo em ordem.`

Os worktrees ficam numa pasta irmã do repositório, `<repositório>-worktrees/<página>`. Entre
na pasta, edite, rode os testes e faça commit **ali**; a branch já está selecionada.

Dentro de um Megabrain (`<megabrain>/apps/knowledge`) os worktrees ficam em
`<megabrain>/apps/knowledge-worktrees/`. Lá o app **não** reconhece o Megabrain (a pasta de cada
worktree não está diretamente dentro de `apps`) e `data/` e `.env.local` não existem: o servidor
da página sobe em modo demo. Para ver os seus dados reais, use o servidor principal (porta 3300).

Para levar o trabalho à `main`: `git push`, abra um pull request da `pagina/<nome>` para a
`main` e faça **merge commit** (não squash nem rebase, que reescrevem o histórico de uma
branch que continua viva). **Não marque "apagar branch" ao concluir.** Depois traga a `main`
de volta: na pasta principal, `git checkout main` e depois `git pull`; dentro do worktree,
`git fetch origin` e depois `git merge origin/main`. Não use `git merge main` sozinho: a `main`
local só é atualizada pelo `git pull` da pasta principal. Nunca use `git push --force`.

O `node_modules` dos worktrees é uma ligação (junction no Windows, symlink nos outros sistemas)
para o do repositório principal, para não instalar dez vezes. Se uma página mudar dependências,
troque a ligação por um `npm ci` próprio naquele worktree, **nesta ordem**: primeiro remova só a
ligação (`rm node_modules` no Git Bash, macOS e Linux; `cmd /c rmdir node_modules` no PowerShell;
sem apagar o conteúdo) e só então rode `npm ci` no worktree. **Rodar `npm ci` ou `npm install` com
a ligação no lugar esvazia o `node_modules` da pasta principal** (testado no Windows) e quebra todas
as páginas; se isso acontecer, rode `npm ci` na pasta principal. O `status` não detecta o problema.

## Como a regra é cumprida

1. **GitHub:** o ruleset `paginas-nao-apagar` (em Settings → Rules) vale para `refs/heads/pagina/*`
   e bloqueia apagar a branch e fazer force-push. Não há exceção de bypass.
2. **Ganchos do git** (`.githooks/`): `reference-transaction` cancela apagar ou renomear
   `pagina/*` no repositório local, e `pre-push` cancela apagar `pagina/*` no remoto.
   Eles passam a valer com `node scripts/paginas.mjs criar`, que configura `core.hooksPath`.
3. **Worktrees travados** (`git worktree lock`): `git worktree remove` e `git worktree prune`
   não levam a pasta de uma página.

```bash
node scripts/paginas.mjs status   # confere tudo (sai com erro se algo faltar)
node scripts/paginas.mjs criar    # cria o que faltar; nunca apaga nada
```

## Se uma pasta sumir ou for movida

Os commits ficam na branch, não na pasta, então nada se perde. Mas o Git guarda o caminho completo
de cada worktree, e o `criar` sozinho não conserta isso (ele acusa erro). Faça na pasta principal:

- **A pasta de um worktree foi apagada:** `git worktree unlock <pasta-do-worktree>`, depois
  `git worktree prune` e, por fim, `node scripts/paginas.mjs criar`.
- **Você moveu ou renomeou a pasta do app (ou a do Megabrain):** evite. Se foi inevitável, rode
  `git worktree repair <pasta-de-cada-worktree>`, apague só as ligações `node_modules` quebradas de
  cada worktree (`rm node_modules` no Git Bash, macOS e Linux; `cmd /c rmdir node_modules` no
  PowerShell) e rode `node scripts/paginas.mjs criar`. Os ganchos (`core.hooksPath`, um caminho
  absoluto) são refeitos pelo `criar`.

## Aposentar uma página

Só o dono decide. Aposentar não é um comando: remova a página de `scripts/paginas.json` e,
no GitHub, desative o ruleset ou ajuste o padrão dele; só então a branch pode ser apagada.
