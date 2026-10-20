import { NextRequest, NextResponse } from "next/server";
import {
  caminhoRelativoDoApp,
  colunaDoCard,
  detectarMegabrain,
  garantirCardValido,
  gravarEstado,
  iniciarCard,
  inventarioConhecimento,
  lerEstado,
  textoDoCard,
} from "@/lib/primeiro-uso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACOES = ["preparar", "aceitar", "dispensar", "reabrir"] as const;
type Acao = (typeof ACOES)[number];

/**
 * Primeiro uso dentro de um Megabrain (ver lib/primeiro-uso.ts).
 *
 * GET só LÊ: diz se este app está dentro de um Megabrain e em que pé está a pergunta. Toda
 * página do app consulta esta rota ao abrir, então ela é barata: só lista as pastas de
 * `knowledge/` enquanto a pergunta está pendente (depois de respondida, nunca mais).
 * Quem muda alguma coisa é o POST (protegido pelo middleware contra requisição de outra
 * origem): "preparar" cria (ou recria) o card do kanban e mantém a pergunta pendente,
 * "aceitar" move o card para DOING e devolve a tarefa, "dispensar" guarda o "agora não" e
 * "reabrir" volta a perguntar.
 */
export async function GET() {
  const det = detectarMegabrain();
  if (!det.detectado || !det.raiz) {
    return NextResponse.json({ megabrain: { detectado: false, motivo: det.motivo } });
  }
  const { megabrain } = await lerEstado();
  return NextResponse.json({
    megabrain: {
      detectado: true,
      raiz: det.raiz,
      pastaApp: caminhoRelativoDoApp(det),
      sinais: det.sinais,
      estado: megabrain.estado,
      cardId: megabrain.cardId,
      inventario: megabrain.estado === "pendente" ? inventarioConhecimento(det.raiz) : [],
    },
  });
}

export async function POST(req: NextRequest) {
  const corpo = (await req.json().catch(() => null)) as { acao?: unknown } | null;
  const acao = corpo && typeof corpo === "object" ? corpo.acao : undefined;
  if (typeof acao !== "string" || !(ACOES as readonly string[]).includes(acao)) {
    return NextResponse.json({ erro: `acao precisa ser uma de: ${ACOES.join("|")}` }, { status: 400 });
  }

  const det = detectarMegabrain();
  if (!det.detectado || !det.raiz) {
    return NextResponse.json({ erro: "Este app não está dentro de um Megabrain (veja BILHON_MEGABRAIN_ROOT)." }, { status: 409 });
  }

  try {
    const atual = (await lerEstado()).megabrain;
    switch (acao as Acao) {
      case "preparar": {
        const cardId = await garantirCardValido(det, atual.cardId);
        const salvo = await gravarEstado(atual.estado, cardId);
        return NextResponse.json({
          ok: true,
          megabrain: { estado: salvo.megabrain.estado, cardId, coluna: await colunaDoCard(cardId) },
        });
      }
      case "aceitar": {
        const cardId = await garantirCardValido(det, atual.cardId);
        const coluna = await iniciarCard(cardId);
        const salvo = await gravarEstado("aceito", cardId);
        return NextResponse.json({
          ok: true,
          megabrain: { estado: salvo.megabrain.estado, cardId, coluna },
          prompt: await textoDoCard(cardId),
        });
      }
      case "dispensar": {
        const salvo = await gravarEstado("dispensado", atual.cardId);
        return NextResponse.json({ ok: true, megabrain: { estado: salvo.megabrain.estado, cardId: salvo.megabrain.cardId } });
      }
      case "reabrir": {
        const salvo = await gravarEstado("pendente", atual.cardId);
        return NextResponse.json({ ok: true, megabrain: { estado: salvo.megabrain.estado, cardId: salvo.megabrain.cardId } });
      }
    }
  } catch (e) {
    // board corrompido é persistente: a mesma resposta das rotas do kanban diz o que fazer
    const { BoardCorrompidoError } = await import("@/lib/kanban");
    if (e instanceof BoardCorrompidoError) {
      return NextResponse.json(
        { erro: "O board do kanban está corrompido. Restaure um backup de data/kanban/backups/ e tente de novo.", codigo: "board_corrompido" },
        { status: 503 },
      );
    }
    // mensagem genérica: o detalhe (caminho, erro do disco) não vai para o navegador
    return NextResponse.json({ erro: "Não foi possível registrar o primeiro uso." }, { status: 500 });
  }
}
