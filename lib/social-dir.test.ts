import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  caminhoSocialPermitido,
  exigirCaminhoSocial,
  lerJsonSocial,
  miniaturasYoutubeAtivas,
  pastaSocial,
  socialRoot,
} from "./social-dir";

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "social-dir-"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmp, { recursive: true, force: true });
});

describe("raiz dos dados das redes", () => {
  it("sem BILHON_SOCIAL_DIR (ou em branco) o padrão é data/social dentro do projeto", () => {
    vi.stubEnv("BILHON_SOCIAL_DIR", "");
    expect(socialRoot()).toBe(path.join(process.cwd(), "data", "social"));
    expect(pastaSocial("youtube-playlists")).toBe(path.join(process.cwd(), "data", "social", "youtube-playlists"));
  });

  it("BILHON_SOCIAL_DIR troca a raiz", () => {
    vi.stubEnv("BILHON_SOCIAL_DIR", tmp);
    expect(socialRoot()).toBe(path.resolve(tmp));
    expect(pastaSocial("instagram-saves")).toBe(path.join(path.resolve(tmp), "instagram-saves"));
  });
});

describe("contenção na raiz", () => {
  it("aceita caminho dentro da raiz (existente ou não) e recusa o de fora", () => {
    vi.stubEnv("BILHON_SOCIAL_DIR", tmp);
    expect(caminhoSocialPermitido(path.join(tmp, "instagram-saves", "decisoes.json"))).toBe(true);
    expect(caminhoSocialPermitido(path.join(tmp, "..", "outra", "x.json"))).toBe(false);
    expect(caminhoSocialPermitido(path.join(tmp, "..", path.basename(tmp) + "-irma", "x.json"))).toBe(false);
    expect(() => exigirCaminhoSocial(path.join(tmp, "..", "x"))).toThrow(/BILHON_SOCIAL_DIR/);
  });

  it("symlink dentro da raiz que aponta para fora é recusado, para leitura e para destino novo", async () => {
    const fora = await mkdtemp(path.join(os.tmpdir(), "social-fora-"));
    try {
      await writeFile(path.join(fora, "segredo.json"), JSON.stringify({ x: 1 }));
      vi.stubEnv("BILHON_SOCIAL_DIR", tmp);
      await symlink(fora, path.join(tmp, "instagram-saves"));
      expect(caminhoSocialPermitido(path.join(tmp, "instagram-saves", "segredo.json"))).toBe(false);
      expect(caminhoSocialPermitido(path.join(tmp, "instagram-saves", "novo.json"))).toBe(false);
      expect(await lerJsonSocial(path.join(tmp, "instagram-saves", "segredo.json"), "vazio")).toBe("vazio");
    } finally {
      await rm(fora, { recursive: true, force: true });
    }
  });

  it("lerJsonSocial devolve o fallback para ausente e para JSON inválido, e o dado quando existe", async () => {
    vi.stubEnv("BILHON_SOCIAL_DIR", tmp);
    await mkdir(path.join(tmp, "a"), { recursive: true });
    await writeFile(path.join(tmp, "a", "ok.json"), JSON.stringify({ n: 2 }));
    await writeFile(path.join(tmp, "a", "ruim.json"), "{ não é json");
    expect(await lerJsonSocial(path.join(tmp, "a", "ok.json"), null)).toEqual({ n: 2 });
    expect(await lerJsonSocial(path.join(tmp, "a", "ruim.json"), [])).toEqual([]);
    expect(await lerJsonSocial(path.join(tmp, "a", "nao-existe.json"), {})).toEqual({});
  });
});

describe("miniaturas do YouTube", () => {
  it("desligadas por padrão; ligam com 1, true ou sim", () => {
    vi.stubEnv("BILHON_SOCIAL_YT_MINIATURAS", "");
    expect(miniaturasYoutubeAtivas()).toBe(false);
    for (const v of ["1", "true", "SIM"]) {
      vi.stubEnv("BILHON_SOCIAL_YT_MINIATURAS", v);
      expect(miniaturasYoutubeAtivas(), v).toBe(true);
    }
    vi.stubEnv("BILHON_SOCIAL_YT_MINIATURAS", "0");
    expect(miniaturasYoutubeAtivas()).toBe(false);
  });
});
