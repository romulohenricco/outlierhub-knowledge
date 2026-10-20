import type { Persona } from "@/lib/personas";

const LARGURA = 760;
const ALTURA = 150;
const NO_L = 128;
const NO_A = 26;
const PASSO_MAX = 140;

const corta = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * Capa do card: núcleo (arquétipo) → barramento → pilares → agentes como pontos.
 * Todo traço usa `accent`; o fundo é um brilho radial suave atrás do núcleo.
 */
export function PersonaOrganograma({ persona }: { persona: Persona }) {
  const { cor: accent, pilares: pillars, arquetipo: archetype, id } = persona;
  const n = pillars.length;
  const gradId = `capa-${id.replace(/[^A-Za-z0-9_-]/g, "")}`;
  // muitos pilares: o passo encolhe (e o nó com ele) para caber sempre no desenho
  const passo = n > 1 ? Math.min(PASSO_MAX, (LARGURA - NO_L - 20) / (n - 1)) : PASSO_MAX;
  const larguraNo = Math.min(NO_L, passo - 8);
  const x0 = LARGURA / 2 - ((n - 1) * passo) / 2;
  const cx = (i: number) => x0 + i * passo;
  const yNucleo = 12;
  const yBarra = 62;
  const yPilar = 72;
  const yPontos = yPilar + NO_A + 24;

  return (
    <svg
      viewBox={`0 0 ${LARGURA} ${ALTURA}`}
      className="block h-auto w-full"
      style={{ aspectRatio: `${LARGURA} / ${ALTURA}` }}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Organograma de ${persona.nome}: ${n} pilares`}
    >
      <defs>
        <radialGradient id={gradId} cx="50%" cy="8%" r="70%">
          <stop offset="0%" stopColor={accent} stopOpacity="0.14" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={LARGURA} height={ALTURA} fill={`url(#${gradId})`} />

      {/* núcleo → barramento */}
      <line x1={LARGURA / 2} y1={yNucleo + NO_A} x2={LARGURA / 2} y2={yBarra} stroke={accent} strokeWidth="1.2" strokeOpacity="0.55" />
      {n > 0 && (
        <line x1={cx(0)} y1={yBarra} x2={cx(n - 1)} y2={yBarra} stroke={accent} strokeWidth="1.2" strokeOpacity="0.55" />
      )}

      {pillars.map((p, i) => {
        const x = cx(i);
        const k = p.agentes.length;
        const espaco = k > 1 ? Math.min(14, (larguraNo - 6) / (k - 1)) : 0;
        const larg = (k - 1) * espaco;
        return (
          <g key={p.nome}>
            <line x1={x} y1={yBarra} x2={x} y2={yPilar} stroke={accent} strokeWidth="1.2" strokeOpacity="0.55" />
            <rect x={x - larguraNo / 2} y={yPilar} width={larguraNo} height={NO_A} rx={4} fill="var(--bl-bg-primary)" stroke={accent} strokeWidth="1.3" />
            <text x={x} y={yPilar + 16.5} textAnchor="middle" fontSize="9.5" fontWeight={600} fill="var(--bl-text-primary)" fontFamily="var(--bl-font-mono)">
              {corta(p.nome, Math.max(3, Math.floor(larguraNo / 7)))}
            </text>
            <line x1={x} y1={yPilar + NO_A} x2={x} y2={yPontos - 12} stroke={accent} strokeWidth="1.2" strokeOpacity="0.55" />
            {k > 1 && (
              <line x1={x - larg / 2} y1={yPontos - 12} x2={x + larg / 2} y2={yPontos - 12} stroke={accent} strokeWidth="1.2" strokeOpacity="0.55" />
            )}
            {p.agentes.map((a, j) => {
              const px = x - larg / 2 + j * espaco;
              return (
                <g key={a}>
                  <line x1={px} y1={yPontos - 12} x2={px} y2={yPontos - 3.2} stroke={accent} strokeWidth="1.2" strokeOpacity="0.55" />
                  <circle cx={px} cy={yPontos} r={3.2} fill="var(--bl-bg-primary)" stroke={accent} strokeWidth="1.3">
                    <title>{a}</title>
                  </circle>
                </g>
              );
            })}
          </g>
        );
      })}

      <rect x={LARGURA / 2 - 80} y={yNucleo} width={160} height={NO_A} rx={4} fill="var(--bl-bg-primary)" stroke={accent} strokeWidth="1.6" />
      <circle cx={LARGURA / 2 - 62} cy={yNucleo + NO_A / 2} r={3} fill={accent} />
      <text x={LARGURA / 2 + 6} y={yNucleo + 16.5} textAnchor="middle" fontSize="9.5" fontWeight={600} fill={accent} fontFamily="var(--bl-font-mono)">
        {corta(archetype, 22)}
      </text>
    </svg>
  );
}
