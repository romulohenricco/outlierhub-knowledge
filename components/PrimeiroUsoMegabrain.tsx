"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Database } from "lucide-react";

/**
 * Primeira abertura dentro de um Megabrain: pergunta se a pessoa quer popular o
 * Knowledge com a base que ela já tem. "Sim" move o primeiro card do kanban (a tarefa)
 * para DOING e entrega o prompt para o agente de IA dela; "Agora não" guarda a resposta
 * e o card segue onde está. A decisão fica no servidor (data/primeiro-uso.json), então a
 * pergunta aparece uma vez, em qualquer navegador. Esc só fecha por esta sessão (a resposta
 * não é gravada). Fora de um Megabrain, não aparece nada.
 */

type Pasta = { nome: string; itens: number };
type Status = {
  detectado: boolean;
  raiz?: string;
  pastaApp?: string;
  sinais?: string[];
  estado?: string;
  cardId?: string | null;
  inventario?: Pasta[];
};
type Resposta = { megabrain?: { cardId?: string | null; coluna?: string | null }; prompt?: string | null };
type Fase = "oculto" | "pergunta" | "prompt";

const ADIADO = "primeiro-uso-adiado";
const LIMITE_CONTAGEM = 10_000;

/** O mesmo rótulo que o board mostra para cada coluna padrão. */
const ROTULO_COLUNA: Record<string, string> = { todo: "TO DO", doing: "DOING", done: "DONE", cancel: "CANCEL" };
const rotuloDe = (coluna?: string | null) => (coluna ? (ROTULO_COLUNA[coluna] ?? coluna.toUpperCase()) : null);

async function chamar(acao: "preparar" | "aceitar" | "dispensar"): Promise<Resposta | null> {
  try {
    const r = await fetch("/api/primeiro-uso", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acao }),
    });
    return r.ok ? ((await r.json()) as Resposta) : null;
  } catch {
    return null;
  }
}

function adiadoNestaSessao(): boolean {
  try {
    return sessionStorage.getItem(ADIADO) === "1";
  } catch {
    return false;
  }
}

export function PrimeiroUsoMegabrain() {
  const router = useRouter();
  const [fase, setFase] = useState<Fase>("oculto");
  const [status, setStatus] = useState<Status | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [coluna, setColuna] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const botaoPrincipal = useRef<HTMLButtonElement>(null);
  const caixa = useRef<HTMLDivElement>(null);

  /** Mantém o Tab dentro do diálogo. */
  const prenderFoco = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !caixa.current) return;
    const focaveis = Array.from(caixa.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], textarea"));
    if (focaveis.length === 0) return;
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    const ativo = document.activeElement;
    if (e.shiftKey && ativo === primeiro) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && ativo === ultimo) {
      e.preventDefault();
      primeiro.focus();
    }
  }, []);

  useEffect(() => {
    if (adiadoNestaSessao()) return;
    let vivo = true;
    (async () => {
      try {
        const r = await fetch("/api/primeiro-uso", { cache: "no-store" });
        if (!r.ok) return;
        const { megabrain } = (await r.json()) as { megabrain?: Status };
        if (!vivo || !megabrain?.detectado || megabrain.estado !== "pendente") return;
        // "preparar" é idempotente e confere o card guardado: se a pessoa o apagou, ele volta
        // a existir antes da pergunta aparecer (e o kanban, se aberto, é atualizado)
        const p = await chamar("preparar");
        const id = p?.megabrain?.cardId ?? null;
        if (!vivo || !id) return;
        if (id !== megabrain.cardId) router.refresh();
        setStatus(megabrain);
        setCardId(id);
        setColuna(p?.megabrain?.coluna ?? null);
        setFase("pergunta");
      } catch {
        /* sem resposta do servidor local: não incomoda */
      }
    })();
    return () => {
      vivo = false;
    };
  }, [router]);

  useEffect(() => {
    if (fase !== "oculto") botaoPrincipal.current?.focus();
  }, [fase]);

  const dispensar = useCallback(async () => {
    setOcupado(true);
    await chamar("dispensar");
    setOcupado(false);
    setFase("oculto");
  }, []);

  const aceitar = useCallback(async () => {
    setOcupado(true);
    setErro(null);
    const r = await chamar("aceitar");
    setOcupado(false);
    if (!r?.prompt) {
      setErro("Não consegui criar a tarefa agora. Tente de novo em instantes.");
      return;
    }
    setCardId(r.megabrain?.cardId ?? cardId);
    setColuna(r.megabrain?.coluna ?? null);
    setPrompt(r.prompt);
    setFase("prompt");
    router.refresh();
  }, [cardId, router]);

  const copiar = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const area = document.getElementById("primeiro-uso-prompt") as HTMLTextAreaElement | null;
      area?.select();
      document.execCommand("copy");
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }, [prompt]);

  /** Esc fecha só por esta sessão: não grava resposta (um Esc sem querer não encerra a pergunta). */
  const adiar = useCallback(() => {
    try {
      sessionStorage.setItem(ADIADO, "1");
    } catch {
      /* sem sessionStorage: volta na próxima abertura */
    }
    setFase("oculto");
  }, []);

  useEffect(() => {
    if (fase === "oculto") return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || ocupado) return;
      if (fase === "pergunta") adiar();
      else setFase("oculto");
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [fase, ocupado, adiar]);

  if (fase === "oculto" || !status) return null;

  const pastas = (status.inventario ?? []).slice(0, 6);
  const nomeColuna = rotuloDe(coluna);
  const sinais = (status.sinais ?? []).map((s) => `${s}/`).join(", ");

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/65 p-4"
      style={{ zIndex: "var(--bl-z-modal-backdrop)" }}
      role="presentation"
    >
      <div
        ref={caixa}
        onKeyDown={prenderFoco}
        role="dialog"
        aria-modal="true"
        aria-labelledby="primeiro-uso-titulo"
        className="w-full max-w-xl rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-elevated)] p-6 shadow-[var(--bl-shadow-md)]"
      >
        <Database className="h-7 w-7 text-[var(--bl-gold)]" strokeWidth={1.75} aria-hidden="true" />

        {fase === "pergunta" ? (
          <>
            <h2 id="primeiro-uso-titulo" className="mt-3 text-lg font-semibold text-[var(--bl-text-primary)]">
              Popular o Knowledge com o seu Megabrain?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--bl-text-secondary)]">
              Este app está dentro de um Megabrain. Quer que eu popule o Knowledge com{" "}
              <strong className="text-[var(--bl-text-primary)]">toda a base de dados</strong> dele: livros, coleções,
              transcrições, referências e o grafo?
            </p>
            {status.raiz && (
              <p className="mt-2 break-all rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] bg-[var(--bl-bg-primary)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--bl-text-secondary)]">
                {status.raiz}
              </p>
            )}
            {sinais && (
              <p className="mt-1 text-[11px] text-[var(--bl-text-dim)]">Reconhecido pelas pastas: {sinais}</p>
            )}
            <p className="mt-3 text-xs leading-relaxed text-[var(--bl-text-dim)]">
              Nada é copiado agora. Eu crio o primeiro card do kanban com essa tarefa e te dou o passo a passo para o seu
              agente de IA fazer a integração. O Megabrain só é lido, nunca alterado.
            </p>
            {pastas.length > 0 && (
              <p className="mt-3 text-xs text-[var(--bl-text-dim)]">
                Encontrei em <code className="font-mono">knowledge/</code>:{" "}
                {pastas.map((p) => `${p.nome} (${p.itens >= LIMITE_CONTAGEM ? `${LIMITE_CONTAGEM}+` : p.itens})`).join(", ")}.
              </p>
            )}
            {erro && <p className="mt-3 text-xs text-red-400">{erro}</p>}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                ref={botaoPrincipal}
                type="button"
                disabled={ocupado}
                onClick={() => void aceitar()}
                className="rounded-[var(--bl-radius-sm)] bg-[var(--bl-accent)] px-4 py-2 text-sm font-medium text-black disabled:opacity-60"
              >
                {ocupado ? "Criando a tarefa…" : "Sim, popular tudo"}
              </button>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => void dispensar()}
                className="rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] px-4 py-2 text-sm text-[var(--bl-text-secondary)] hover:text-[var(--bl-text-primary)] disabled:opacity-60"
              >
                Agora não
              </button>
              <span className="text-[11px] text-[var(--bl-text-dim)]">
                O card{cardId ? ` ${cardId}` : ""} fica no kanban{nomeColuna ? ` (em ${nomeColuna})` : ""}; use &ldquo;Agora não&rdquo; ou Esc para decidir depois.
              </span>
            </div>
          </>
        ) : (
          <>
            <h2 id="primeiro-uso-titulo" className="mt-3 text-lg font-semibold text-[var(--bl-text-primary)]">
              Pronto: o primeiro card do kanban é essa tarefa
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--bl-text-secondary)]">
              O card{cardId ? <> <strong className="text-[var(--bl-text-primary)]">{cardId}</strong></> : null}{" "}
              {coluna === "doing" ? "foi movido para DOING" : nomeColuna ? `está em ${nomeColuna}` : "está no kanban"}. Cole o
              prompt abaixo no seu agente de IA, aberto na pasta do Megabrain, para começar a integração. Para pegar o texto
              de novo, use &ldquo;copiar pro terminal&rdquo; no card.
            </p>
            <textarea
              id="primeiro-uso-prompt"
              readOnly
              value={prompt}
              rows={10}
              className="mt-3 w-full resize-y rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] bg-[var(--bl-bg-primary)] p-3 font-mono text-[11px] leading-relaxed text-[var(--bl-text-secondary)]"
            />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                ref={botaoPrincipal}
                type="button"
                onClick={() => void copiar()}
                className="inline-flex items-center gap-2 rounded-[var(--bl-radius-sm)] bg-[var(--bl-accent)] px-4 py-2 text-sm font-medium text-black"
              >
                {copiado ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                {copiado ? "Copiado" : "Copiar prompt"}
              </button>
              <Link
                href="/kanban"
                onClick={() => setFase("oculto")}
                className="rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] px-4 py-2 text-sm text-[var(--bl-text-secondary)] hover:text-[var(--bl-text-primary)]"
              >
                Ver no kanban
              </Link>
              <button type="button" onClick={() => setFase("oculto")} className="text-sm text-[var(--bl-text-dim)] hover:text-[var(--bl-text-primary)]">
                Fechar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
