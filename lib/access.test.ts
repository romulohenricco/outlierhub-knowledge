import { describe, expect, it } from "vitest";
import { EXIGE_ACCESS_QUANDO, extrairToken, precisaDeAccess } from "./access";


describe("precisaDeAccess — separa o mundo público do local", () => {
  it("hostname público exige Access", () => {
    expect(precisaDeAccess("knowledge.example.invalid")).toBe(true);
  });

  it("hostname público com porta explícita também exige", () => {
    expect(precisaDeAccess("knowledge.example.invalid:443")).toBe(true);
  });

  it("é case-insensitive — Host chega como o cliente mandou", () => {
    expect(precisaDeAccess("Knowledge.Example.Invalid")).toBe(true);
  });

  const locais = ["127.0.0.1:3300", "127.0.0.1", "localhost:3300", "localhost", "[::1]:3300"];
  for (const h of locais) {
    it(`local não exige: ${h}`, () => {
      expect(precisaDeAccess(h)).toBe(false);
    });
  }

  it("Host ausente EXIGE Access", () => {
    // Sem Host não dá pra provar que é local, então nega — não provar que é
    // público não pode virar passe livre.
    expect(precisaDeAccess(null)).toBe(true);
    expect(precisaDeAccess("")).toBe(true);
  });

  it("subdomínio parecido também exige Access — e não vira o hostname real", () => {
    // hosts de nome parecido (a) exigem Access como qualquer outro e (b) NÃO são
    // confundidos com o host local por sufixo.
    expect(precisaDeAccess("evil-knowledge.example.invalid")).toBe(true);
    expect(precisaDeAccess("knowledge.example.invalid.attacker.com")).toBe(true);
    expect(precisaDeAccess("127.0.0.1.attacker.com")).toBe(true);
  });

  it("não traz domínios pessoais por padrão", () => {
    expect(EXIGE_ACCESS_QUANDO).toEqual([]);
  });
});

describe("extrairToken — header ou cookie, nessa ordem", () => {
  const req = (headers: Record<string, string>) => new Headers(headers);

  it("lê o header injetado pelo Access", () => {
    expect(extrairToken(req({ "cf-access-jwt-assertion": "abc.def.ghi" }))).toBe("abc.def.ghi");
  });

  it("cai pro cookie CF_Authorization quando o header não vem", () => {
    expect(extrairToken(req({ cookie: "CF_Authorization=xyz.123.456; outro=1" }))).toBe(
      "xyz.123.456",
    );
  });

  it("header vence o cookie", () => {
    const h = req({ "cf-access-jwt-assertion": "do-header", cookie: "CF_Authorization=do-cookie" });
    expect(extrairToken(h)).toBe("do-header");
  });

  it("sem nenhum dos dois devolve null — o chamador nega", () => {
    expect(extrairToken(req({}))).toBeNull();
    expect(extrairToken(req({ cookie: "sessao=1" }))).toBeNull();
  });

  it("cookie de nome parecido não é aceito", () => {
    expect(extrairToken(req({ cookie: "XCF_Authorization=nao; CF_Authorization_old=nao" }))).toBeNull();
  });
});

/**
 * Postura fail-closed: NEGA POR PADRÃO, e só o que é comprovadamente local
 * passa. O desenho inverso (allowlist do protegido, em que só o hostname exato
 * exigia JWT) deixaria qualquer outro Host passar com 200 e dado completo.
 */
describe("precisaDeAccess — nega por padrão", () => {
  const forasteiros = [
    "novo.example.invalid",
    "qualquer.coisa",
    "evil.com",
    "knowledge.example.invalid.attacker.com",
    "evil-knowledge.example.invalid",
    "0.0.0.0",
    "0.0.0.0:3300",
    "::1",
  ];
  for (const h of forasteiros) {
    it(`Host desconhecido EXIGE Access: ${h}`, () => {
      expect(precisaDeAccess(h)).toBe(true);
    });
  }

  it("Host ausente exige Access — fail-closed, não fail-open", () => {
    expect(precisaDeAccess(null)).toBe(true);
    expect(precisaDeAccess("")).toBe(true);
  });

  it("só loopback passa", () => {
    for (const h of ["127.0.0.1:3300", "localhost", "[::1]:3300"]) {
      expect(precisaDeAccess(h), `${h} deveria passar`).toBe(false);
    }
  });
});
