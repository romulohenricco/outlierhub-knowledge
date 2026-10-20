import { Fragment } from "react";
import { ENV_ONTOLOGIA, EXEMPLO_ONTOLOGIA, getCobertura, getOntologia, type EstadoOntologia } from "@/lib/ontologia";
import { montarGrafoOntologia } from "@/lib/ontologia-grafo";
import { corPorTexto } from "@/lib/ontologia-cores";
import OntologiaGrafo from "@/components/OntologiaGrafo";
import OntologiaReferencia from "@/components/OntologiaReferencia";

export const dynamic = "force-dynamic";

export const metadata = { title: "Ontologia · Knowledge" };

/** Linhas por camada nas tabelas de leitura; o resto fica no canvas. */
const MAX_LINHAS = 200;

const MOTIVO: Record<EstadoOntologia, string> = {
  "nao-configurada": "A variável ainda não está definida.",
  ausente: "O arquivo apontado não existe.",
  "fora-da-raiz": "O arquivo está fora de BILHON_ROOT e foi recusado.",
  invalida: "O arquivo não pôde ser lido como YAML ou JSON.",
  vazia: "O arquivo foi lido, mas não tem a lista `camadas` com ao menos uma camada válida (id obrigatório).",
  ok: "",
};

const cod = "font-mono text-[12px] text-white/70";

/** Nada carregado: diz o que configurar e o formato esperado, em vez de uma tela em branco. */
function EstadoVazio({ estado, fonte }: { estado: EstadoOntologia; fonte?: string }) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Ontologia</h1>
        <p className="mt-1 text-xs text-white/40">o mapa de como as suas coisas se organizam, nas camadas que você definir</p>
      </div>
      <section className="rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] p-5 text-sm text-[var(--bl-text-secondary)]">
        <h2 className="text-base font-semibold text-white/85">Nenhuma ontologia carregada</h2>
        <p className="mt-2 leading-relaxed">
          A página desenha o arquivo que você configurar, em árvore e em grafo. Aponte{" "}
          <code className={cod}>{ENV_ONTOLOGIA}</code> para um arquivo YAML ou JSON dentro de{" "}
          <code className={cod}>BILHON_ROOT</code> (por exemplo{" "}
          <code className={cod}>data/ontologia/ontologia.yaml</code>) e reinicie o app. Você define as
          camadas e os itens de cada uma; os campos estão em <code className={cod}>docs/ontologia.md</code>.
        </p>
        <p className="mt-3 text-[12px] text-white/50">
          Estado: <span className="text-white/70">{MOTIVO[estado]}</span>
          {fonte ? <span className="ml-2 font-mono text-[11px] text-white/35">{fonte}</span> : null}
        </p>
        <p className="mt-4 text-[12px] text-white/50">Exemplo mínimo:</p>
        <pre className="mt-1.5 overflow-x-auto rounded-[var(--bl-radius-sm)] border border-[var(--bl-border)] bg-[var(--bl-bg-input)] p-3 font-mono text-[11px] leading-relaxed text-white/65">
          {EXEMPLO_ONTOLOGIA}
        </pre>
      </section>
    </main>
  );
}

const titulo = "mb-3 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--bl-text-dim)]";

export default async function OntologiaPage() {
  const { ontologia: o, estado, fonte } = await getOntologia();
  if (!o) return <EstadoVazio estado={estado} fonte={fonte} />;

  const cobertura = await getCobertura();
  const grafo = montarGrafoOntologia(o);
  const pct = (n: number, t: number) => (t ? Math.round((n / t) * 100) : 0);
  const porId = new Map(grafo.nodes.map((n) => [n.id, n]));
  const { itens: itensDescartados, ligacoes: ligacoesDescartadas } = o.descartes;

  return (
    <main className="px-6 pb-8">
      {/* a página abre direto no grafo — a ontologia inteira num mapa só.
          -mx-6 anula o padding da página: o canvas vai da barra lateral até o
          respiro do shell à direita (fica livre pra pegar a barra de rolagem) */}
      <section className="-mx-6 mb-10">
        <OntologiaGrafo nodes={grafo.nodes} links={grafo.links} fonte={fonte} />
      </section>

      {/* seções de leitura: recuam pra fora dos menus flutuantes (o canvas acima não recua) */}
      <div style={{ paddingLeft: "var(--chrome-left)" }}>
        <div className="mx-auto max-w-6xl">
          {(itensDescartados > 0 || ligacoesDescartadas > 0) && (
            <p className="mb-6 rounded-[var(--bl-radius-sm)] border border-dashed border-[var(--bl-border-hover)] px-3 py-2 text-[11px] text-[var(--bl-text-muted)]">
              Itens do arquivo ignorados por estarem incompletos, repetidos ou acima do limite: {itensDescartados}.
              Ligações para itens que não existem: {ligacoesDescartadas}.
            </p>
          )}

          {/* modelo de referência — um card por camada do arquivo + as regras */}
          <OntologiaReferencia nodes={grafo.nodes} regras={o.regras} />

          {/* estado aplicado — cobertura nos materiais do app */}
          {cobertura.length > 0 && (
            <section className="mb-10">
              <h2 className={titulo}>
                estado aplicado <span className="normal-case">— cobertura da ontologia nos materiais</span>
              </h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {cobertura.map((c) => {
                  const dims = [
                    ["domínio", c.comDominio],
                    ["checksum", c.comChecksum],
                    ["relações", c.comRelacoes],
                    ...(c.comAnotacao !== undefined
                      ? ([["anotação", c.comAnotacao]] as [string, number][])
                      : []),
                  ] as [string, number][];
                  return (
                    <div
                      key={c.nome}
                      className="rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] p-4"
                    >
                      <div className="flex items-baseline justify-between">
                        <p className="text-sm font-semibold">{c.nome}</p>
                        <p className="font-mono text-xs text-[var(--bl-text-dim)]">{c.total} materiais</p>
                      </div>
                      {/* dimensões de metadado com % */}
                      <div className="mt-3 space-y-1.5">
                        {dims.map(([dim, n]) => (
                          <div key={dim} className="flex items-center gap-2">
                            <span className="w-20 shrink-0 font-mono text-[10px] text-[var(--bl-text-dim)]">{dim}</span>
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bl-bg-input)]">
                              <div
                                className="h-full rounded-full bg-[var(--bl-accent)]"
                                style={{ width: `${pct(n, c.total)}%` }}
                              />
                            </div>
                            <span className="w-9 shrink-0 text-right font-mono text-[10px] text-[var(--bl-text-secondary)]">
                              {pct(n, c.total)}%
                            </span>
                          </div>
                        ))}
                      </div>
                      {/* distribuição por domínio */}
                      <div className="mt-3 flex h-2 overflow-hidden rounded-full" title="distribuição por domínio">
                        {c.distDominio.map(([d, n]) => (
                          <div
                            key={d}
                            style={{ width: `${pct(n, c.total)}%`, background: corPorTexto(d) }}
                            title={`${d}: ${n}`}
                          />
                        ))}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5">
                        {c.distDominio.map(([d, n]) => (
                          <span key={d} className="font-mono text-[9px] text-[var(--bl-text-dim)]">
                            <span style={{ color: corPorTexto(d) }}>●</span> {d} {n}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* uma tabela por camada */}
          {o.camadas.map((c) => {
            const itens = c.itens.slice(0, MAX_LINHAS);
            if (!c.itens.length) return null;
            const cor = porId.get(`camada:${c.id}`)?.cor;
            return (
              <section key={c.id} className="mb-10">
                <h2 className={titulo}>
                  <span style={{ color: cor }}>●</span> {c.rotulo} ({c.itens.length})
                  {c.descricao ? <span className="normal-case"> — {c.descricao}</span> : null}
                </h2>
                <div className="overflow-x-auto rounded-[var(--bl-radius-md)] border border-[var(--bl-border)]">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[var(--bl-bg-elevated)] font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--bl-text-dim)]">
                      <tr>
                        <th className="px-3 py-2">item</th>
                        <th className="px-3 py-2">status</th>
                        <th className="px-3 py-2">descrição</th>
                        <th className="px-3 py-2">fonte</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itens.map((it) => {
                        const no = porId.get(`item:${c.id}/${it.id}`);
                        return (
                          <Fragment key={it.id}>
                            <tr className="border-t border-[var(--bl-border)] align-top">
                              <td className="px-3 py-2 font-mono text-[var(--bl-accent)]">
                                {it.nome}
                                {it.pai ? <span className="ml-1 text-[var(--bl-text-muted)]">↳ {it.pai}</span> : null}
                              </td>
                              <td className="px-3 py-2">
                                {it.status ? (
                                  <span
                                    className="rounded-[var(--bl-radius-sm)] border px-1.5 py-px text-[10px] font-semibold"
                                    style={{ color: no?.corStatus, borderColor: no?.corStatus }}
                                  >
                                    {it.status}
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-3 py-2 text-[var(--bl-text-secondary)]">{it.descricao}</td>
                              <td className="px-3 py-2 font-mono text-[10px] text-[var(--bl-text-dim)]">{it.fonte}</td>
                            </tr>
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {c.itens.length > itens.length && (
                  <p className="mt-2 font-mono text-[10px] text-[var(--bl-text-muted)]">
                    +{c.itens.length - itens.length} no grafo
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
