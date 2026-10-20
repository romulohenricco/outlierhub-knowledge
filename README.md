# Knowledge

Sua base de conhecimento com uma interface visual: biblioteca com leitor, busca, grafo de conexões, kanban e inventário de agentes. Roda no seu computador e pode ser usado sozinho ou ao lado do seu Megabrain.

**Gratuito e de código aberto, sob a licença MIT.** A demonstração inclui apenas documentos e capas originais deste projeto. Não inclui livros comerciais, cursos, dados de alunos, contas, chaves ou a engine Megabrain.

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
| Ontologia | `/ontologia` | Camadas e relações definidas em um manifesto seu |
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

O app continua em `127.0.0.1:3300`. `npm run dev -- --port 3301` permite usar outra porta local; ajuste o endereço no navegador.

## Rede e privacidade

Em modo demo, o app não envia sua base a Supabase, Ollama ou executor algum. A instalação baixa pacotes do npm e o build pode baixar fontes do Google. A telemetria do Next é desativada pelos scripts npm.

Integrações configuradas por você se comunicam com os serviços escolhidos. Downloads de referências usam os provedores registrados nos seus arquivos. Miniaturas externas do YouTube são opcionais. **Tornar o código público não publica automaticamente sua base local.**

Este é um app local/pessoal, com um único usuário autorizado quando configurado atrás de Cloudflare Access. Não é uma plataforma multiusuário. Use sempre `npm run dev` ou `npm start`, que escutam em loopback; não exponha a porta diretamente nem rode `next` com `--hostname 0.0.0.0`. Veja [SECURITY.md](SECURITY.md) e os limites completos em [docs/seguranca.md](docs/seguranca.md).

## Problemas comuns

| Sintoma | Confira |
| --- | --- |
| Node incompatível | Use Node LTS 22.13+ ou 24 |
| `npm` bloqueado no PowerShell | Use `npm.cmd ci` / `npm.cmd run dev` |
| Porta 3300 ocupada | Use `npm run dev -- --port 3301` e abra 3301 |
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
