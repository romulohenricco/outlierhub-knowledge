// SERVER-ONLY: junta as duas leituras (organização + pasta de notas) sem nunca lançar.
import { lerMemoria as lerMemoriaPadrao, memoriaRaiz } from "./memoria";
import { caminhoOrganizacao, lerOrganizacao as lerOrganizacaoPadrao } from "./organizacao";
import type { BrainDados, Memoria, OrgLeitura } from "./tipos";

type Opcoes = {
  organizacao?: string;
  memoriaRaiz?: string;
  lerOrganizacao?: (caminho: string) => Promise<OrgLeitura>;
  lerMemoria?: (raiz: string) => Promise<Memoria | null>;
};

/** Sem nada configurado (ou com qualquer falha de leitura) devolve os dois motivos em vez de lançar. */
export async function carregarBrain(o: Opcoes = {}): Promise<BrainDados> {
  const lo = o.lerOrganizacao ?? lerOrganizacaoPadrao;
  const lm = o.lerMemoria ?? lerMemoriaPadrao;
  let org: OrgLeitura;
  try {
    org = await lo(o.organizacao ?? caminhoOrganizacao());
  } catch (e) {
    org = { ok: false, estado: "invalida", motivo: `falha ao ler a organização (${e instanceof Error ? e.message : "erro"})` };
  }
  let memoria: Memoria | null = null;
  let memoriaMotivo: string | undefined;
  let memoriaFalha = false;
  try {
    memoria = await lm(o.memoriaRaiz ?? memoriaRaiz());
    if (!memoria) memoriaMotivo = "pasta de notas ausente, fora de BILHON_ROOT ou sem arquivos .md";
  } catch (e) {
    memoriaMotivo = `falha ao ler a pasta de notas (${e instanceof Error ? e.message : "erro"})`;
    memoriaFalha = true;
  }
  return { org, memoria, ...(memoriaMotivo ? { memoriaMotivo } : {}), ...(memoriaFalha ? { memoriaFalha } : {}) };
}
