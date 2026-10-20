/**
 * Armazém da triagem manual (servidor): lê o inventário de uma rede e grava `decisoes.json`
 * ao lado dele. Um store por rede — cada um com a própria pasta e o próprio lock.
 *
 * Re-coletar e re-categorizar o inventário NUNCA toca em decisoes.json. Leitura e
 * gravação ficam contidas na raiz de BILHON_SOCIAL_DIR (ver `lib/social-dir.ts`).
 */
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DecisoesTriagem, StatusTriagem } from "./triagem";
import { exigirCaminhoSocial, lerJsonSocial } from "./social-dir";

export function criarTriagemStore(opts: {
  /** pasta da rede, resolvida a cada uso (a env pode mudar entre chamadas) */
  dir: () => string;
  /** ids que existem hoje no inventário — decisão pra id fora dele é descartada */
  ids: (lerJson: <T>(arquivo: string, fallback: T) => Promise<T>) => Promise<string[]>;
  idValido: (s: unknown) => s is string;
}) {
  async function lerJson<T>(arquivo: string, fallback: T): Promise<T> {
    return lerJsonSocial(path.join(opts.dir(), arquivo), fallback);
  }

  let fila: Promise<unknown> = Promise.resolve();
  /** Serializa as mutações (processo único) — evita read-modify-write concorrente em decisoes.json. */
  function comLock<T>(fn: () => Promise<T>): Promise<T> {
    const prox = fila.then(fn, fn);
    fila = prox.catch(() => {});
    return prox;
  }

  /**
   * Grava a triagem: `status` aplicado a todos os `ids`; `null` desfaz (volta a "sem decisão").
   * Ignora id malformado e id que não existe no inventário. Devolve o que foi de fato aplicado.
   * Sem nenhum id aplicável (por exemplo, inventário vazio) nada é criado em disco.
   */
  async function setDecisoes(
    ids: unknown[],
    status: StatusTriagem | null,
  ): Promise<{ aplicados: string[]; ignorados: number; decisoes: DecisoesTriagem }> {
    return comLock(async () => {
      const existentes = new Set(await opts.ids(lerJson));
      const validos = [...new Set(ids.filter(opts.idValido))].filter((id) => existentes.has(id));
      const atual = await lerJson<DecisoesTriagem>("decisoes.json", {});
      if (validos.length === 0) return { aplicados: validos, ignorados: ids.length, decisoes: atual };
      const em = new Date().toISOString();
      for (const id of validos) {
        if (status === null) delete atual[id];
        else atual[id] = { status, em };
      }
      const dir = opts.dir();
      const destino = exigirCaminhoSocial(path.join(dir, "decisoes.json"));
      await mkdir(exigirCaminhoSocial(dir), { recursive: true });
      const tmp = `${destino}.tmp-${process.pid}`;
      try {
        await writeFile(tmp, JSON.stringify(atual, null, 1));
        await rename(tmp, destino);
      } catch (e) {
        await rm(tmp, { force: true });
        throw e;
      }
      return { aplicados: validos, ignorados: ids.length - validos.length, decisoes: atual };
    });
  }

  return { lerJson, setDecisoes };
}
