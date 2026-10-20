import { mkdir, writeFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { adicionarAudio, audioDirDoCard, getBoard } from "@/lib/kanban";
import { respostaBoardCorrompido } from "../../_resposta-board";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Teto do upload: uma nota de voz de vários minutos cabe folgada. O limite existe pelo
 *  disco e pela memória (o corpo é lido inteiro antes de gravar). */
const TAMANHO_MAX = 25 * 1024 * 1024;

/** Map, e não objeto literal: um tipo herdado do protótipo ("constructor") não pode virar extensão. */
const EXT_POR_MIME = new Map<string, string>([
  ["audio/webm", "webm"],
  ["audio/ogg", "ogg"],
  ["audio/mp4", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/wav", "wav"],
]);

/** POST multipart/form-data {audio: Blob} — grava a nota de voz no disco e
 *  registra a referência no card. Ticket precisa já existir (salvar antes de gravar). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // valida o id ANTES de qualquer mkdir/writeFile: mkdir(recursive) com id
  // contendo `../..` gravaria fora de data/kanban (nada de "cria e depois confere")
  const dir = audioDirDoCard(id);
  if (!dir) return NextResponse.json({ erro: "ticket inválido" }, { status: 400 });

  // recusa antes de ler o corpo quando o cliente já declara um tamanho acima do teto
  const declarado = Number(req.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > TAMANHO_MAX + 64 * 1024) {
    return NextResponse.json({ erro: "áudio maior que 25 MB" }, { status: 413 });
  }

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!audio || !(audio instanceof Blob)) {
    return NextResponse.json({ erro: "áudio ausente" }, { status: 400 });
  }
  const ext = EXT_POR_MIME.get(audio.type) ?? "webm";
  if (audio.size > TAMANHO_MAX) return NextResponse.json({ erro: "áudio maior que 25 MB" }, { status: 413 });

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
  await writeFile(`${dir}/${arquivo}`, Buffer.from(await audio.arrayBuffer()));

  try {
    const card = await adicionarAudio(id, arquivo);
    if (!card) return NextResponse.json({ erro: "ticket não encontrado" }, { status: 404 });
    return NextResponse.json(card, { status: 201 });
  } catch (e) {
    const resposta = respostaBoardCorrompido(e);
    if (resposta) return resposta;
    throw e;
  }
}
