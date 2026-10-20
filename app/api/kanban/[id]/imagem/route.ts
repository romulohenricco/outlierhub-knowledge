import { mkdir, writeFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { adicionarImagem, getBoard, imagemDirDoCard } from "@/lib/kanban";
import { respostaBoardCorrompido } from "../../_resposta-board";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Teto do upload: um print de tela cabe folgado. O limite existe pelo disco e pela memória
 *  (o corpo é lido inteiro antes de gravar), não pela qualidade. */
const TAMANHO_MAX = 10 * 1024 * 1024;

/** Map, e não objeto literal: com `{}`, um tipo "constructor" ou "__proto__" achava um valor
 *  herdado do protótipo e passava pela lista de formatos aceitos. */
const EXT_POR_MIME = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

/** POST multipart/form-data {imagem: Blob, legenda?: string} — grava o print
 *  no disco e registra a referência no card. Ticket precisa já existir. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // valida o id ANTES de qualquer mkdir/writeFile: mkdir(recursive) com id
  // contendo `../..` gravaria fora de data/kanban (nada de "cria e depois confere")
  const dir = imagemDirDoCard(id);
  if (!dir) return NextResponse.json({ erro: "ticket inválido" }, { status: 400 });

  // recusa antes de ler o corpo quando o cliente já declara um tamanho acima do teto
  const declarado = Number(req.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > TAMANHO_MAX + 64 * 1024) {
    return NextResponse.json({ erro: "imagem maior que 10 MB" }, { status: 413 });
  }

  const form = await req.formData().catch(() => null);
  const imagem = form?.get("imagem");
  const legenda = form?.get("legenda");
  if (!imagem || !(imagem instanceof Blob)) {
    return NextResponse.json({ erro: "imagem ausente" }, { status: 400 });
  }
  const ext = EXT_POR_MIME.get(imagem.type);
  if (!ext) return NextResponse.json({ erro: "formato de imagem não suportado" }, { status: 400 });
  if (imagem.size > TAMANHO_MAX) return NextResponse.json({ erro: "imagem maior que 10 MB" }, { status: 413 });

  // o ticket precisa existir ANTES de gravar: id inexistente não deixa arquivo órfão no disco
  try {
    const board = await getBoard();
    if (!board.cards.some((c) => c.id === id)) return NextResponse.json({ erro: "ticket não encontrado" }, { status: 404 });
  } catch (e) {
    const resposta = respostaBoardCorrompido(e);
    if (resposta) return resposta;
    throw e;
  }

  const arquivo = `${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/${arquivo}`, Buffer.from(await imagem.arrayBuffer()));

  try {
    const card = await adicionarImagem(id, arquivo, typeof legenda === "string" && legenda.trim() ? legenda.trim() : undefined);
    if (!card) return NextResponse.json({ erro: "ticket não encontrado" }, { status: 404 });
    return NextResponse.json(card, { status: 201 });
  } catch (e) {
    const resposta = respostaBoardCorrompido(e);
    if (resposta) return resposta;
    throw e;
  }
}
