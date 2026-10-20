import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConta, getDossie, getSocialMedia, perfilThumbPathFor, progressoDe, type ContaSocial } from "./social";

const conta = (o: Partial<ContaSocial> & { username: string }): ContaSocial => ({
  nome: "",
  bio: "",
  seguidores: 0,
  seguindo: null,
  posts: 0,
  negocio: false,
  categoria: null,
  privada: false,
  nichos: [],
  rede: "instagram",
  ...o,
});

let raiz: string;
let dir: string;
beforeEach(async () => {
  raiz = await mkdtemp(path.join(os.tmpdir(), "social-contas-"));
  dir = path.join(raiz, "instagram-contas");
  vi.stubEnv("BILHON_SOCIAL_DIR", raiz);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(raiz, { recursive: true, force: true });
});

describe("getSocialMedia — contas seguidas", () => {
  it("sem nenhum arquivo devolve tudo vazio, sem erro", async () => {
    const r = await getSocialMedia();
    expect(r.contas).toEqual([]);
    expect(r.rotulosNichos).toEqual({});
    expect(r.progresso).toEqual({ atualizadoEm: null, total: 0, comBio: 0, semBio: 0, porNicho: {} });
    expect(await getConta("conta-a")).toBeNull();
  });

  it("sem progresso.json os totais saem das próprias contas; nichos.json dá o nome de cada nicho", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "contas.json"),
      JSON.stringify([conta({ username: "conta-a", bio: "bio", nichos: ["tema_um"] }), conta({ username: "conta-b", nichos: ["tema_um", "outro"] })]),
    );
    await writeFile(path.join(dir, "nichos.json"), JSON.stringify({ nichos: [{ id: "tema_um", rotulo: "Tema um" }, { id: 3 }] }));
    const r = await getSocialMedia();
    expect(r.contas).toHaveLength(2);
    expect(r.progresso).toMatchObject({ total: 2, comBio: 1, semBio: 1, porNicho: { tema_um: 2, outro: 1 } });
    expect(r.rotulosNichos).toEqual({ tema_um: "Tema um" });
    expect((await getConta("conta-b"))?.username).toBe("conta-b");
  });

  it("progresso.json manda onde existe e conta sem listas ou sem username é normalizada ou descartada", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "contas.json"),
      JSON.stringify([{ username: "conta-a" }, { nome: "sem username" }, null]),
    );
    await writeFile(
      path.join(dir, "progresso.json"),
      JSON.stringify({ atualizadoEm: "2026-01-15T12:00:00Z", total: 10, comBio: 4, semBio: 6, porNicho: { x: 4 } }),
    );
    const r = await getSocialMedia();
    expect(r.contas).toHaveLength(1);
    expect(r.contas[0]).toMatchObject({ username: "conta-a", bio: "", nichos: [], seguidores: 0, negocio: false, categoria: null });
    expect(r.progresso).toEqual({ atualizadoEm: "2026-01-15T12:00:00Z", total: 10, comBio: 4, semBio: 6, porNicho: { x: 4 } });
  });

  it("contas.json que não é lista vale como vazio", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "contas.json"), JSON.stringify({ contas: [] }));
    expect((await getSocialMedia()).contas).toEqual([]);
  });

  it("progressoDe conta bio em branco como sem bio", () => {
    expect(progressoDe([conta({ username: "a", bio: "  " }), conta({ username: "b", bio: "x", nichos: ["n"] })])).toMatchObject({
      total: 2,
      comBio: 1,
      semBio: 1,
      porNicho: { n: 1 },
    });
  });
});

describe("dossiê e miniaturas de perfil", () => {
  it("getDossie devolve null sem arquivo e recusa username com escape sem tocar o disco", async () => {
    expect(await getDossie("conta-a")).toBeNull();
    expect(await getDossie("..")).toBeNull();
    expect(await getDossie("a/b")).toBeNull();
  });

  it("getDossie lê perfis/<username>/dossie.json e completa o que faltar", async () => {
    await mkdir(path.join(dir, "perfis", "conta-a"), { recursive: true });
    await writeFile(path.join(dir, "perfis", "conta-a", "dossie.json"), JSON.stringify({ username: "conta-a", ingeridoEm: "2026-01-15T12:00:00Z" }));
    expect(await getDossie("conta-a")).toMatchObject({ analise: "", posts: [] });
  });

  it("perfilThumbPathFor aceita arquivo com reticências no nome", () => {
    expect(perfilThumbPathFor("conta-a", "post....jpg")).toBe(path.join(dir, "perfis", "conta-a", "post....jpg"));
  });

  it("perfilThumbPathFor recusa .., . , separadores, NUL e vazio", () => {
    for (const [u, a] of [
      ["..", "x.jpg"],
      ["conta-a", ".."],
      [".", "x.jpg"],
      ["conta-a", "../x.jpg"],
      ["a\\b", "x.jpg"],
      ["conta-a", "x\0.jpg"],
      ["", "x.jpg"],
    ]) {
      expect(perfilThumbPathFor(u, a)).toBeNull();
    }
  });

  it("perfilThumbPathFor recusa pasta de perfil que é symlink para fora da raiz", async () => {
    const fora = await mkdtemp(path.join(os.tmpdir(), "social-fora-"));
    try {
      await mkdir(path.join(dir, "perfis"), { recursive: true });
      await symlink(fora, path.join(dir, "perfis", "conta-a"));
      expect(perfilThumbPathFor("conta-a", "x.jpg")).toBeNull();
    } finally {
      await rm(fora, { recursive: true, force: true });
    }
  });
});
