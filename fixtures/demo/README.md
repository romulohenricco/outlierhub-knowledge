# Biblioteca de demonstração

Os cinco cadernos PDF, seus textos, capas, catálogo e relações foram criados originalmente para a edição pública do Knowledge em 2026. Autoria: projeto Knowledge. Distribuição sob a mesma licença MIT do código, disponível na raiz do projeto. Nenhum texto ou imagem de livros de terceiros é reutilizado.

Cada documento contém uma capa e uma página de exercícios e orientações. As relações do grafo são curadas para navegação didática; não são resultados de extração automática nem prova de validação externa.

Para reproduzir os PDFs e as capas, use Node 22.13 ou superior e Poppler com `pdftoppm` no PATH, então rode `node scripts/gerar-demo.mjs` na raiz do projeto. Não há dependências npm adicionais ou acesso à rede. Os PDFs são determinísticos; a codificação PNG depende da versão instalada do Poppler. O clone já inclui os arquivos prontos e não exige Poppler para usar o app.
