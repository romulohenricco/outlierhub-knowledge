# Contribuir com o Knowledge

Abra uma issue descrevendo o problema e envie alterações pequenas, com reprodução e validação. Não coloque dados pessoais reais em exemplos, testes, prints ou logs. Use conteúdo original/licenciado e mantenha a atribuição de terceiros.

## Ambiente

Use Node LTS 22.13+ ou 24. No clone principal, rode `npm ci` e `npm run dev`. O app abre em http://127.0.0.1:3300. Para a organização opcional de worktrees por página, leia [docs/paginas.md](docs/paginas.md).

Antes de editar, confira a baseline. Antes de enviar um PR, rode:

```sh
npm run type-check
npm run lint
npm test
npm run build
```

Descreva o comportamento antes/depois e os checks realizados. Informe limitações de ambiente e avisos de dependências; não apresente uma auditoria com alertas como se estivesse zerada. Não use `npm audit fix --force` sem analisar a migração.

## Dados e Git

`data/`, `.env.local`, caches e dependências são locais. Não use `git add -f` para incluí-los. Não apague/renomeie branches `pagina/*` nem use push forçado. Preserve alterações de outras pessoas.

Contribuições de código e exemplos originais são oferecidas sob a [licença MIT](LICENSE). Ao incluir conteúdo de outra origem, documente a licença compatível e a proveniência.

## Segurança

Para comunicar uma vulnerabilidade, use **Report a vulnerability** na aba Security do GitHub, quando habilitada pelo mantenedor. Não abra uma issue pública contendo segredos ou uma base pessoal. Consulte [SECURITY.md](SECURITY.md).
