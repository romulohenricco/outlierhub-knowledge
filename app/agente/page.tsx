import { carregarBrain } from "@/lib/brain/carregar";
import type { BrainDados } from "@/lib/brain/tipos";
import { getEcosystem, getFavoritosAgente, getOcultosAgente } from "@/lib/ecosystem";
import { Ecossistema } from "@/components/Ecossistema";
import type { EcoFonte, EcoFonteEstado } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Agente · Knowledge" };

const ROTULO_FONTE: Record<EcoFonte["id"], string> = {
  registro: "registro de entidades",
  repos: "repositórios",
  espelhos: "itens espelhados",
  uso: "evidência de uso",
};

const ESTADO_FONTE: Record<EcoFonteEstado, string> = {
  "nao-configurada": "não configurada",
  ausente: "arquivo ainda não existe",
  "fora-da-raiz": "fora de BILHON_ROOT (recusada)",
  invalida: "ilegível ou inválida",
  ok: "lida",
};

const CODE = "font-mono text-[12px] text-white/70";

/** Nada carregado: diz o que configurar e o estado de cada fonte, em vez de uma tela em branco. */
function EstadoVazio({ fontes, brain }: { fontes: EcoFonte[]; brain: BrainDados }) {
  const orgEstado = brain.org.ok ? "lida" : ESTADO_FONTE[brain.org.estado];
  const notasEstado = brain.memoria ? `lida (${brain.memoria.total} notas)` : (brain.memoriaMotivo ?? "pasta de notas ausente");
  return (
    <section className="rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] p-5 text-sm text-[var(--bl-text-secondary)]">
      <h2 className="text-base font-semibold text-white/85">Nenhuma entidade carregada</h2>
      <p className="mt-2 leading-relaxed">
        O inventário mostra só o que você configurar. Aponte <code className={CODE}>BILHON_REGISTRO_ENTIDADES</code> para
        um registro de entidades (YAML ou JSON), ou coloque <code className={CODE}>repos.json</code> e{" "}
        <code className={CODE}>espelhos.json</code> em <code className={CODE}>data/agente/</code>. O formato dos
        arquivos está em <code className={CODE}>docs/agente-registro.md</code>.
      </p>
      <p className="mt-2 leading-relaxed">
        As visões <strong className="text-white/80">Radial</strong> e <strong className="text-white/80">Neural</strong>{" "}
        (grafo do ecossistema) também desenham a sua organização em pilares (
        <code className={CODE}>data/agente/organizacao.json</code> ou <code className={CODE}>BILHON_BRAIN_ORG_JSON</code>) e
        uma pasta de notas .md ligadas por <code className={CODE}>[[links]]</code> (
        <code className={CODE}>data/agente/memoria/</code> ou <code className={CODE}>BILHON_BRAIN_STORE</code>). Assim que
        houver qualquer um desses dados, as abas aparecem.
      </p>
      <ul className="mt-4 space-y-1.5 text-[12px]">
        {fontes.map((f) => (
          <li key={f.id} className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-white/70">{ROTULO_FONTE[f.id]}</span>
            <span className="font-mono text-[11px] text-white/35">{f.env}</span>
            <span className={f.estado === "ok" ? "text-green-300" : "text-white/45"}>{ESTADO_FONTE[f.estado]}</span>
          </li>
        ))}
        <li className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-white/70">organização do grafo</span>
          <span className="font-mono text-[11px] text-white/35">BILHON_BRAIN_ORG_JSON</span>
          <span className={brain.org.ok ? "text-green-300" : "text-white/45"}>{orgEstado}</span>
        </li>
        <li className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-white/70">notas do grafo</span>
          <span className="font-mono text-[11px] text-white/35">BILHON_BRAIN_STORE</span>
          <span className={brain.memoria ? "text-green-300" : "text-white/45"}>{notasEstado}</span>
        </li>
      </ul>
    </section>
  );
}

export default async function AgentePage() {
  // pasta de estado fora da raiz permitida (BILHON_ROOT) é recusada pela contenção de
  // caminhos: a página abre mesmo assim, sem favoritos/ocultos, e mostra o estado das fontes.
  // A organização e as notas do grafo nunca lançam: sem elas, vêm vazias.
  const [ecosystem, favoritos, ocultos, brain] = await Promise.all([
    getEcosystem(),
    getFavoritosAgente().catch(() => ({})),
    getOcultosAgente().catch(() => ({})),
    carregarBrain(),
  ]);
  const temOrg = brain.org.ok && brain.org.data.pilares.length > 0;
  const vazio = ecosystem.entities.length === 0 && !temOrg && !brain.memoria;
  if (vazio) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">Agente · inventário</h1>
          <p className="mt-1 text-xs text-white/40">
            squads, agents, skills, workflows, clones, shadows, workers, engines e repos · 0 entidades
          </p>
        </div>
        <EstadoVazio fontes={ecosystem.fontes ?? []} brain={brain} />
      </main>
    );
  }
  return (
    <main>
      <Ecossistema ecosystem={ecosystem} favoritos={favoritos} ocultos={ocultos} brain={brain} />
    </main>
  );
}
