# Segurança

O Knowledge é um aplicativo local/pessoal. Os scripts `npm run dev` e `npm start` escutam em `127.0.0.1`. Não exponha a porta diretamente. Para acesso externo, use um proxy/túnel na mesma máquina, Cloudflare Access e a configuração de [docs/seguranca.md](docs/seguranca.md).

## Fronteira de confiança

- Não há login local: processos e pessoas com acesso à máquina podem usar o app.
- O acesso externo configurado autoriza um e-mail; não há papéis ou isolamento entre vários usuários.
- Hosts/cabeçalhos de proxy não substituem restrições de rede. Um proxy que oculta a origem pode fazer tráfego externo parecer local.
- A base local, arquivos importados e integrações configuradas são fontes de confiança do usuário. Não importe inventários ou documentos executáveis de origem desconhecida.
- Uploads têm limite por arquivo, mas não há cotas globais ou limitação de taxa. Mantenha backups e monitore espaço em disco.
- Segredos só no servidor, nunca em `NEXT_PUBLIC_*`, Git, issue ou print. Use Supabase dedicado se configurar a `service_role`.

## Avisos de dependências de desenvolvimento

A edição pública mantém Tailwind 3 para preservar o visual e evitar uma migração de CSS sem necessidade. A cadeia de ferramentas pode apresentar alertas em `braces` (padrões profundamente aninhados) e `postcss-selector-parser` (seletores maliciosos). Eles dizem respeito ao processamento de entrada não confiável; não demonstram execução remota pela interface do app. Fontes de build e configuração de glob devem ser confiáveis. Não ofereça compilação de CSS arbitrário como serviço.

Em 20/10/2026 não havia versão corrigida publicada de braces (a mais recente era 3.0.3). O projeto não mascara esse aviso com uma versão inexistente ou um override incompatível. Reavalie ao atualizar:

- https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
- https://github.com/advisories/GHSA-rj75-hqrm-r3gf

Use `npm audit` e `npm audit --omit=dev` para distinguir ferramentas de desenvolvimento e dependências de execução. Confira o relatório de validação da versão; não presuma contagem permanente de alertas.

## Reportar um problema

Use **Security → Report a vulnerability** neste repositório, se habilitado pelo mantenedor. Caso contrário, procure o mantenedor pelo perfil GitHub antes de enviar detalhes de exploração. Não publique dados pessoais, tokens ou dumps em issues. Informe versão, sistema, passos mínimos e impacto sem incluir sua base real.

## Distribuição

Os exemplos desta edição são originais e seguem MIT. Uma licença de software não concede direitos sobre conteúdo pessoal ou obras que alguém importe depois. Confira os arquivos antes de compartilhar um pacote e não compacte indiscriminadamente uma instalação com `data/` ou `.env.local`.
