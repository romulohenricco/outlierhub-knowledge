/** Biblioteca original Knowledge. Node puro; capas via Poppler (pdftoppm). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = path.join(root, 'fixtures/demo');
const livrosDir = path.join(base, 'livros');
mkdirSync(path.join(livrosDir, '.covers'), { recursive: true });
const books = [
  { id: 'guia-knowledge', titulo: 'Seu primeiro Knowledge', tema: 'conhecimento', dominio: 'conhecimento', cor: [0.08, 0.39, 0.36], linha: ['Seu primeiro', 'Knowledge'], subtitulo: 'Da leitura a uma ideia que pode ser usada.', resumo: 'Um percurso para capturar uma ideia, registrar sua origem e conectar conhecimento a uma decisão. Inclui revisão semanal da biblioteca.', conceitos: ['captura', 'revisao', 'decisao'], secoes: [
    ['01 / Comece por uma pergunta', 'Uma biblioteca fica mais útil quando responde a uma necessidade concreta. Antes de importar arquivos, escreva uma pergunta: o que preciso entender para tomar a próxima decisão? Separe apenas três fontes para começar. A quantidade deve caber em uma sessão de leitura.'],
    ['02 / Registre com contexto', 'Ao encontrar uma ideia útil, descreva-a com suas próprias palavras. Anote a fonte, a página e a pergunta que ela ajuda a responder. Separe a afirmação do autor da sua interpretação. Uma nota pequena com contexto vale mais que um trecho longo sem origem.'],
    ['03 / Use e revise', 'Abra o grafo para comparar conceitos e volte ao documento para conferir o sentido. Leve uma ação concreta ao kanban: testar uma hipótese, escrever um resumo ou revisar uma decisão. Uma vez por semana, procure notas sem uso e decida se devem ser conectadas, arquivadas ou esclarecidas.'],
    ['Experimento de 15 minutos', 'Escolha um documento. Registre uma ideia, uma dúvida e uma ação possível. No fim, explique a ideia em duas frases sem olhar a fonte. Se faltar clareza, volte ao texto antes de adicionar novos arquivos.'],
  ] },
  { id: 'organizar-fontes', titulo: 'Organizar fontes com contexto', tema: 'conhecimento', dominio: 'conhecimento', cor: [0.18, 0.30, 0.56], linha: ['Organizar fontes', 'com contexto'], subtitulo: 'Uma origem clara torna a consulta confiável.', resumo: 'Como organizar fontes, registrar autoria e permissões, distinguir evidência de interpretação e preparar uma revisão de referências.', conceitos: ['fontes', 'contexto', 'revisao'], secoes: [
    ['01 / Dê um endereço à origem', 'Registre título, autoria, data de consulta e localização do documento. Para um arquivo local, prefira um caminho relativo ao projeto. Para uma página, guarde o endereço e a data de acesso. Não coloque senhas ou links de acesso privado em notas compartilhadas.'],
    ['02 / Preserve as diferenças', 'Uma fonte pode trazer um fato observado, uma opinião ou uma hipótese. Marque essa diferença na sua nota. Quando duas fontes discordarem, preserve o desacordo e descreva o contexto de cada uma. Uma categoria comum facilita encontrar documentos, mas não torna suas conclusões equivalentes.'],
    ['03 / Revise antes de compartilhar', 'Confira se você pode redistribuir o arquivo e se ele contém dados de outras pessoas. O direito de ler um documento não implica permissão para publicá-lo. Uma biblioteca pública pode usar exemplos originais, materiais autorizados ou links para a fonte em vez de cópias.'],
    ['Ficha mínima de fonte', 'Título: o nome pelo qual você vai procurar. Origem: quem produziu e onde consultar. Uso: qual pergunta esse material ajuda a responder. Limite: o que ainda não foi verificado. Revisão: quando a ficha precisa ser conferida novamente.'],
  ] },
  { id: 'perguntas-e-conexoes', titulo: 'Perguntas e conexões', tema: 'conhecimento', dominio: 'conhecimento', cor: [0.40, 0.26, 0.56], linha: ['Perguntas', 'e conexões'], subtitulo: 'Transforme proximidade em uma relação explicável.', resumo: 'Perguntas para ligar conceitos no grafo, comparar fontes e registrar uma hipótese sem confundir conexão com comprovação.', conceitos: ['perguntas', 'fontes', 'contexto'], secoes: [
    ['01 / Faça perguntas menores', 'Troque uma pergunta ampla por algo observável. Em vez de perguntar como melhorar todos os projetos, pergunte qual informação faltou na última entrega. Uma pergunta menor permite escolher fontes, buscar conceitos e reconhecer quando a investigação avançou.'],
    ['02 / Nomeie a relação', 'Duas notas podem mencionar o mesmo assunto por motivos diferentes. Ao conectá-las, escreva um verbo: explica, contradiz, depende de, exemplifica. Se você não consegue explicar a ligação em uma frase, mantenha a conexão como hipótese e procure uma evidência melhor.'],
    ['03 / Volte ao documento', 'O grafo ajuda a navegar e formular perguntas. A leitura da fonte permite verificar o que foi afirmado. Confira a página e o contexto antes de usar uma ligação em uma decisão. Uma visualização atraente não substitui a verificação.'],
    ['Exercício de conexão', 'Escolha duas fontes sobre um problema. Escreva um ponto de acordo, uma diferença e uma pergunta que permanece aberta. Crie apenas as relações que consegue explicar. Registre o próximo passo para esclarecer a pergunta.'],
  ] },
  { id: 'projeto-em-acao', titulo: 'Um projeto em ação', tema: 'projetos', dominio: 'projetos', cor: [0.63, 0.31, 0.13], linha: ['Um projeto', 'em ação'], subtitulo: 'Um resultado claro, um próximo passo possível.', resumo: 'Planejamento de projetos com resultado observável, decisão registrada, tarefas pequenas e revisão do trabalho no kanban.', conceitos: ['decisao', 'revisao', 'entrega'], secoes: [
    ['01 / Defina o resultado', 'Descreva uma mudança que alguém poderá observar quando o projeto terminar. Por exemplo: uma pessoa consegue instalar o aplicativo seguindo o guia e abrir um documento de exemplo. A descrição orienta o trabalho e dá um critério para reconhecer a entrega.'],
    ['02 / Quebre o próximo passo', 'Uma tarefa deve indicar uma ação e um resultado verificável. Substitua melhorar documentação por testar as instruções em uma pasta vazia e registrar os pontos que faltam. Associe as fontes usadas à tarefa para reduzir a busca por contexto quando o trabalho for retomado.'],
    ['03 / Registre a decisão', 'Quando escolher uma solução, anote o problema, as alternativas consideradas e o motivo da escolha. Inclua o que faria você reconsiderar. Esse registro evita repetir discussões e permite revisar a decisão quando aparecer informação nova.'],
    ['Revisão de encerramento', 'Compare o resultado observado com o combinado. Liste o que funcionou, uma dificuldade e uma mudança para o próximo projeto. Guarde os documentos finais com sua origem e mova as tarefas concluídas para o estado correspondente no kanban.'],
  ] },
  { id: 'conteudo-com-clareza', titulo: 'Conteúdo com clareza', tema: 'conteudo', dominio: 'conteudo', cor: [0.49, 0.23, 0.34], linha: ['Conteúdo', 'com clareza'], subtitulo: 'Uma ideia útil, explicada para uma pessoa.', resumo: 'Um roteiro para escrever conteúdo claro: pergunta do leitor, exemplo concreto, fontes identificadas e revisão antes da entrega.', conceitos: ['perguntas', 'fontes', 'entrega'], secoes: [
    ['01 / Escolha o que explicar', 'Escreva a pergunta do leitor no topo do rascunho. Responda em uma frase simples antes de desenvolver o texto. A frase serve como direção: cada parágrafo deve explicar, demonstrar ou qualificar essa resposta. Corte desvios que não ajudam a pessoa a agir ou compreender.'],
    ['02 / Mostre um caso concreto', 'Use uma situação pequena que possa ser acompanhada do início ao fim. Para explicar organização de notas, mostre uma pergunta, uma fonte e uma nota resultante. Identifique exemplos inventados como exemplos. Não transforme uma hipótese em promessa de resultado.'],
    ['03 / Confira e entregue', 'Verifique nomes, números, links e permissões de imagens. Atribua ideias de terceiros à origem correspondente. Leia o texto em voz alta e substitua frases vagas por ações observáveis. Termine com um próximo passo que a pessoa consiga executar.'],
    ['Roteiro de revisão', 'A abertura responde à pergunta? O exemplo demonstra a ideia? As fontes estão acessíveis? Existe alguma afirmação maior que a evidência? O próximo passo está claro? Se uma resposta for não, revise esse ponto antes de publicar.'],
  ] },
];

// PDF 1.4 com Helvetica/WinAnsi: texto pesquisável, sem fontes ou serviços externos.
const literal = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
function wrap(s, max = 83) {
  const lines = []; let line = '';
  for (const word of s.split(' ')) { if ((line + ' ' + word).trim().length > max) { lines.push(line); line = word; } else line = (line + ' ' + word).trim(); }
  if (line) lines.push(line); return lines;
}
function pdf(book, i) {
  const rgb = book.cor.join(' ');
  const text = (x, y, size, s, bold = false, color = '0.13 0.17 0.21') => `${color} rg BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${literal(s)}) Tj ET\n`;
  let cover = `0.97 0.96 0.93 rg 0 0 595 842 re f\n${rgb} rg 0 0 20 842 re f 48 654 72 5 re f\n`;
  cover += text(48, 777, 12, 'KNOWLEDGE / BIBLIOTECA ABERTA', true);
  cover += text(48, 695, 13, `CADERNO 0${i + 1}`, true, rgb);
  book.linha.forEach((line, j) => { cover += text(48, 584 - j * 49, 38, line, true); });
  wrap(book.subtitulo, 53).forEach((line,j) => { cover += text(50, 441 - j * 25, 17, line); });
  cover += `${rgb} rg 48 185 499 1 re f\n`;
  cover += text(48, 151, 12, 'Leia. Conecte. Coloque em prática.', true);
  cover += text(48, 115, 10, 'Texto e projeto visual originais do Knowledge. Licença MIT.');
  cover += text(48, 96, 10, 'Edição de demonstração / 2026');
  let body = text(48, 789, 10, `KNOWLEDGE / ${book.titulo}`, true, rgb);
  body += `${rgb} rg 48 770 499 2 re f\n`;
  let y = 733;
  for (const [heading, paragraph] of book.secoes) {
    body += text(48, y, 16, heading, true, rgb); y -= 29;
    for (const line of wrap(paragraph)) { body += text(48, y, 11, line); y -= 17; }
    y -= 26;
  }
  if (y < 65) throw new Error(`Conteúdo ultrapassa a página: ${book.id} (${y})`);
  body += text(48, 38, 9, 'Knowledge / conteúdo original / MIT'); body += text(531, 38, 9, '02');
  const stream = s => `<< /Length ${Buffer.byteLength(s, 'latin1')} >>\nstream\n${s}endstream`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [5 0 R 7 0 R] /Count 2 >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents 6 0 R >>', stream(cover), '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents 8 0 R >>', stream(body), `<< /Title (${literal(book.titulo)}) /Author (Knowledge) /Subject (Conteudo original de demonstracao - MIT) /Creator (Knowledge - gerar-demo.mjs) >>`];
  let result = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'; const offsets = [0];
  objects.forEach((o,j) => { offsets.push(Buffer.byteLength(result, 'latin1')); result += `${j+1} 0 obj\n${o}\nendobj\n`; });
  const start = Buffer.byteLength(result, 'latin1'); result += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(n => { result += `${String(n).padStart(10,'0')} 00000 n \n`; });
  result += `trailer\n<< /Size ${objects.length+1} /Root 1 0 R /Info 9 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(result, 'latin1');
}
const catalog = books.map((b,i) => {
  const arquivo = `${b.id}.pdf`; const target = path.join(livrosDir, arquivo);
  writeFileSync(target, pdf(b,i));
  execFileSync('pdftoppm', ['-f','1','-singlefile','-scale-to','840','-png', target, path.join(livrosDir,'.covers',b.id)], { stdio: 'inherit' });
  return { id: b.id, titulo: b.titulo, tema: b.tema, dominio: b.dominio, resumo: b.resumo, arquivo, formato: 'pdf', paginas: 2 };
});
const concepts = { captura: 'Captura de ideias', revisao: 'Revisão', decisao: 'Decisão', fontes: 'Fontes', contexto: 'Contexto', perguntas: 'Perguntas', entrega: 'Entrega' };
const nodes = [...catalog.map(b=>({id:`livro:${b.arquivo}`,label:b.titulo,tipo:'livro'})), ...Object.entries(concepts).map(([id,label])=>({id,label,tipo:'conceito'}))];
const edges = []; const liga = (src,rel,dst) => edges.push({id:edges.length+1,src,rel,dst,status:'confirmed',n_fontes:1,peso:0.8});
books.forEach(b=>b.conceitos.forEach(c=>liga(`livro:${b.id}.pdf`,'aborda',c)));
liga('captura','preserva','contexto'); liga('fontes','orientam','decisao'); liga('perguntas','conduzem','revisao'); liga('decisao','orienta','entrega'); liga('revisao','confere','fontes');
writeFileSync(path.join(base,'livros.json'), JSON.stringify(catalog,null,2)+'\n');
writeFileSync(path.join(base,'grafo.json'), JSON.stringify({nodes,edges},null,2)+'\n');
console.log(`Gerados ${catalog.length} PDFs originais, capas e grafo (${nodes.length} nós, ${edges.length} relações).`);
