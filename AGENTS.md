# Knowledge: instruções para agentes

Leia README.md e docs/seguranca.md antes de alterar o projeto. Este app pode ser
usado sozinho em modo demo ou em apps/knowledge de uma instalação Megabrain.
Não requer uma engine ou caminho de disco particular para desenvolver.

- Preserve dados de usuário, alterações locais e branches pagina/*.
- O Megabrain e outros acervos externos são somente leitura. Importe apenas
  material que a pessoa autorizou; grave dados em data/ e importadores em
  scripts/importar/ deste app.
- Nunca leia, solicite, imprima ou versione chaves privadas, tokens ou .env.local.
  A própria pessoa configura os segredos. Use valores artificiais nos testes.
- Não inclua obras de terceiros na demonstração sem licença de redistribuição
  documentada. Os exemplos originais desta distribuição seguem a licença MIT.
- Código do app pode ser alterado para a tarefa autorizada. Confira a baseline
  com npm run type-check, npm run lint e npm test antes de editar; ao concluir,
  rode os checks pertinentes e npm run build.
- Confirme publicação, push ou PR com a pessoa depois de apresentar o resultado
  e os checks. Nunca use git push --force nem apague/renomeie branches pagina/*.
- Instale dependências apenas no clone principal, nunca em um worktree de página
  com node_modules ligado ao clone principal (veja docs/paginas.md).
- Use npm run dev/npm start: eles escutam em 127.0.0.1. Não exponha diretamente
  a porta; acesso externo exige a configuração descrita em docs/seguranca.md.
