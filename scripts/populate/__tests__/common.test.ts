import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectSecret, scanRepo } from "../common.mjs";

/* ------------------------------------------------------------------ valores sintéticos */

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const BASE64URL = `${ALNUM}-_`;
const HEX = "0123456789abcdef";
const MAIUSCULAS_DIGITOS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/**
 * Sequência pseudoaleatória determinística (xorshift32): valores SINTÉTICOS com a forma
 * de uma chave real, montados em tempo de execução para nenhum formato de segredo ficar
 * escrito no código-fonte (e nenhuma chave real entrar no teste).
 */
function sintetico(n: number, alfabeto = ALNUM, semente = 1): string {
  let x = semente >>> 0 || 1;
  let s = "";
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    s += alfabeto[x % alfabeto.length];
  }
  return s;
}

/* ------------------------------------------------------------------ detectSecret */

describe("detectSecret: formatos atuais de chave", () => {
  const casos: [string, string, string][] = [
    ["OpenAI de projeto (sk-proj-)", `OPENAI_KEY_DO_BOT: sk-proj-${sintetico(120, BASE64URL, 11)}`, "openai-key"],
    ["OpenAI de conta de serviço (sk-svcacct-)", `chave sk-svcacct-${sintetico(90, BASE64URL, 12)} no log`, "openai-key"],
    ["OpenAI de admin (sk-admin-)", `sk-admin-${sintetico(80, BASE64URL, 13)}`, "openai-key"],
    ["OpenAI no formato antigo", `usar sk-${sintetico(48, ALNUM, 14)}`, "openai-key"],
    ["Anthropic continua com o próprio nome", `sk-ant-api03-${sintetico(90, BASE64URL, 15)}`, "anthropic-key"],
    ["Supabase access token (sbp_ + 40 hex)", `token sbp_${sintetico(40, HEX, 16)}`, "supabase-token"],
    ["Supabase secret key (sb_secret_)", `sb_secret_${sintetico(31, ALNUM, 17)}`, "supabase-secret"],
    ["ClickUp pessoal (pk_<dígitos>_<maiúsculas/dígitos>)", `pk_81234567_${sintetico(32, MAIUSCULAS_DIGITOS, 18)}`, "clickup-token"],
    ["Voyage (pa- + 40 ou mais)", `pa-${sintetico(43, BASE64URL, 19)}`, "voyage-key"],
    ["atribuição sem aspas (.env)", `ELEVENLABS_API_KEY=${sintetico(40, ALNUM, 20)}\n`, "atribuicao-de-segredo"],
    ["atribuição sem aspas com export", `export SERVICE_TOKEN=${sintetico(44, `${ALNUM}/+`, 21)}=`, "atribuicao-de-segredo"],
    ["atribuição sem aspas com dois-pontos (compose)", `  DB_PASSWORD: ${sintetico(32, ALNUM, 22)}`, "atribuicao-de-segredo"],
    ["atribuição com aspas (já existia)", `api_key = "${sintetico(32, ALNUM, 23)}"`, "atribuicao-de-segredo"],
    ["bloco de chave privada (já existia)", `${"-----BEGIN "}RSA PRIVATE KEY-----\n`, "private-key-block"],
  ];

  it.each(casos)("%s", (_nome, texto, esperado) => {
    expect(detectSecret(texto)).toBe(esperado);
    // sem estado entre chamadas (os padrões usam a flag g)
    expect(detectSecret(texto)).toBe(esperado);
  });

  it("devolve só o nome do padrão, nunca o valor", () => {
    const valor = sintetico(120, BASE64URL, 31);
    const r = detectSecret(`OPENAI_API_KEY=sk-proj-${valor}`);
    expect(r).toMatch(/^[a-z-]+$/);
    expect(r).not.toContain(valor.slice(0, 8));
  });

  it("senha escolhida por pessoa continua sendo segredo, mesmo com palavra comum ou sequência", () => {
    // só o marcador forte (máscara, interpolação, frase ou palavra de exemplo) vale para valor humano
    expect(detectSecret("postgresql://admin:SenhaDoBanco2024@db.interno:5432/app")).toBe("url-com-senha");
    expect(detectSecret("postgresql+asyncpg://admin:SenhaDoBanco2024@db:5432/app")).toBe("url-com-senha");
    expect(detectSecret("redis://default:segredo123456@cache:6379")).toBe("url-com-senha");
    expect(detectSecret("DB_PASSWORD=MinhaSenhaSuperSecreta2024ParaOBanco")).toBe("atribuicao-de-segredo");
    expect(detectSecret('password = "MeuTokenSecretoDeProducao2024"')).toBe("atribuicao-de-segredo");
    // frase em camelCase só vale como senha: num campo de chave seria nome de tipo ou classe
    expect(detectSecret("DB_PASSWORD=CorrectHorseBatteryStaple")).toBe("atribuicao-de-segredo");
  });
});

describe("detectSecret: um marcador antes não esconde o segredo de verdade que vem depois", () => {
  // O marcador tem a forma completa do padrão (com valor aleatório no lugar dos x seria
  // segredo) e é descartado: a varredura precisa seguir para a ocorrência seguinte.
  const casos: [string, string, string, string][] = [
    ["chave com prefixo", `Exemplo: sk-proj-${"x".repeat(48)}`, `No log: sk-proj-${sintetico(120, BASE64URL, 32)}`, "openai-key"],
    ["atribuição sem aspas", `Exemplo: ACCESS_TOKEN=${"x".repeat(40)}`, `ACCESS_TOKEN=${sintetico(40, ALNUM, 34)}`, "atribuicao-de-segredo"],
    ["atribuição com aspas", `"apiKey": "${"x".repeat(32)}"`, `"apiKey": "${sintetico(32, ALNUM, 35)}"`, "atribuicao-de-segredo"],
  ];

  it.each(casos)("%s", (_nome, marcador, real, esperado) => {
    expect(detectSecret(marcador.replace(/x{32,}/, (x) => sintetico(x.length, ALNUM, 36)))).toBe(esperado);
    expect(detectSecret(marcador)).toBeNull();
    expect(detectSecret(`${marcador}\n${marcador}\n\n${real}\n`)).toBe(esperado);
  });
});

describe("detectSecret: nome composto do campo, em qualquer caixa e com ou sem aspas", () => {
  const casos: [string, string][] = [
    ["snake minúsculo com aspas", `my_api_key = "${sintetico(32, ALNUM, 61)}"`],
    ["CAIXA_ALTA com aspas", `OPENAI_API_KEY="${sintetico(40, ALNUM, 62)}"`],
    ["senha composta com aspas simples (YAML)", `db_password: '${sintetico(28, ALNUM, 63)}'`],
    ["camelCase entre aspas (JSON)", `{"apiKey": "${sintetico(32, BASE64URL, 64)}"}`],
    ["CAIXA_ALTA entre aspas (JSON)", `{"OPENAI_API_KEY": "${sintetico(40, ALNUM, 73)}"}`],
    ["access_token: sem aspas (YAML)", `access_token: ${sintetico(40, ALNUM, 65)}`],
    ["com hífen entre aspas", `"client-secret": "${sintetico(32, ALNUM, 66)}"`],
    ["cabeçalho x-api-key", `x-api-key: ${sintetico(32, ALNUM, 67)}`],
    ["opção de linha de comando", `cli --api-key=${sintetico(32, ALNUM, 68)} --verbose`],
    ["variável camelCase em código", `const accessToken = '${sintetico(36, ALNUM, 69)}';`],
    ["PascalCase sem aspas", `ApiKey: ${sintetico(32, ALNUM, 71)}`],
    ["JSON escapado dentro de string", `body = "{\\"refreshToken\\": \\"${sintetico(36, ALNUM, 70)}\\"}"`],
    ["PowerShell $env:", `$env:ANTHROPIC_API_KEY = "${sintetico(40, ALNUM, 72)}"`],
    ["nome com ponto (properties)", `spring.datasource.password=${sintetico(28, ALNUM, 74)}`],
    ["base64 com / não é caminho", `AWS_SECRET_ACCESS_KEY=${sintetico(20, ALNUM, 81)}/${sintetico(19, ALNUM, 82)}`],
  ];

  it.each(casos)("%s", (_nome, texto) => {
    expect(detectSecret(texto)).toBe("atribuicao-de-segredo");
  });
});

describe("detectSecret: chave longa e variada não vira exemplo por um trecho curto", () => {
  // Num corpo de 40+ caracteres com alta diversidade, `_key-`, `-test_` ou `my-` aparecem por
  // acaso; ali só vale o marcador forte (máscara, frase ou palavra de exemplo, x repetido, sequência).
  const casos: [string, string, string][] = [
    ["_key- no meio (OpenAI de projeto)", `sk-proj-${sintetico(30, ALNUM, 91)}_key-${sintetico(60, BASE64URL, 92)}`, "openai-key"],
    ["-test_ no meio (Anthropic)", `sk-ant-api03-${sintetico(40, ALNUM, 93)}-test_${sintetico(40, ALNUM, 94)}`, "anthropic-key"],
    ["my- no começo (Voyage)", `pa-my-${sintetico(44, ALNUM, 95)}`, "voyage-key"],
  ];

  it.each(casos)("%s", (_nome, texto, esperado) => {
    expect(detectSecret(texto)).toBe(esperado);
  });

  it("corpo curto com o mesmo trecho continua sendo exemplo", () => {
    expect(detectSecret(`sk-ant-api03-${sintetico(10, ALNUM, 98)}-test_${sintetico(10, ALNUM, 99)}`)).toBeNull();
    expect(detectSecret("ANTHROPIC_API_KEY=sk-ant-api03-test_key_do_tutorial")).toBeNull();
  });

  it("palavra de exemplo continua marcador mesmo em corpo longo e variado", () => {
    expect(detectSecret(`sk-proj-${sintetico(30, ALNUM, 96)}EXAMPLE${sintetico(30, ALNUM, 97)}`)).toBeNull();
  });
});

describe("detectSecret: marcador de documentação não é segredo", () => {
  const marcadores: [string, string][] = [
    ["sk-proj curto", "OPENAI_API_KEY=sk-proj-xxxxxxxx"],
    ["sk-proj só com x", `OPENAI_API_KEY=sk-proj-${"x".repeat(48)}`],
    ["sk legado só com x (como o .env.example do mega-brain)", `OPENAI_API_KEY=sk-${"x".repeat(48)}`],
    // literais partidos ("sk-" + …, "AKIA" + …) para o próprio código-fonte não parecer segredo
    // ao scripts/verificar-publicacao.mjs nem a scanners externos; o texto testado é o mesmo
    ["sk-proj em sequência", "sk-" + "proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD"],
    ["sk legado em sequência repetida", `sk-${"1234567890abcdef".repeat(3)}`],
    ["chave entre <>", "OPENAI_API_KEY=<sua-chave>"],
    ["sk-ant em português", "ANTHROPIC_API_KEY=sk-" + "ant-api03-SUA_CHAVE_AQUI_SUA_CHAVE_AQUI"],
    ["sk-ant curto (docs/api-keys-guide.md)", "ANTHROPIC_API_KEY=sk-ant-sua-chave-aqui"],
    ["atribuição your-…-here (engine/jarvis/docs)", "ASSEMBLYAI_API_KEY=your-assemblyai-api-key-here"],
    ["sbp_ zerado", `SUPABASE_ACCESS_TOKEN=sbp_${"0".repeat(40)}`],
    ["sbp_ em sequência", `sbp_${"abcdef0123456789".repeat(3).slice(0, 40)}`],
    ["sb_secret_ só com x", `SUPABASE_SECRET_KEY=sb_secret_${"x".repeat(24)}`],
    ["pk_ com X", `CLICKUP_API_KEY=pk_12345678_${"X".repeat(32)}`],
    ["pa- de exemplo", `VOYAGE_API_KEY=pa-your-voyage-api-key-here-${"x".repeat(20)}`],
    ["pa- só com x", `VOYAGE_API_KEY=pa-${"x".repeat(43)}`],
    ["ghp_ só com x", `GITHUB_TOKEN=ghp_${"x".repeat(36)}`],
    ["AWS de exemplo da documentação", "aws_access_key_id = AKIA" + "IOSFODNN7EXAMPLE"],
    ["URL com user:pass (engine/intelligence/rag/store_resolver.py)", "  • DATABASE_URL=postgresql://user:pass@host:5432/db"],
    ["URL com variáveis interpoladas", "postgres://${DB_USER}:${DB_PASSWORD}@db:5432/app"],
    ["URL com senha mascarada", "postgresql://postgres:********@localhost:54322/postgres"],
    ["atribuição com aspas de exemplo", `password = "your_password_here_${"x".repeat(12)}"`],
    ["chave de exemplo com EXAMPLE (como a da documentação da AWS)", `aws_secret_access_key = ${sintetico(30, ALNUM, 51)}EXAMPLEKEY`],
    ["valor REDACTED entre aspas", `"accessToken": "REDACTED_${sintetico(20, ALNUM, 52)}"`],
    ["URL com senha changeme", "postgres://admin:changeme@db:5432/app"],
    ["frase de exemplo longa", "OPENAI_API_KEY=sk-" + "your-openai-api-key-from-the-dashboard-here"],
  ];

  it.each(marcadores)("%s", (_nome, texto) => {
    expect(detectSecret(texto)).toBeNull();
  });
});

describe("detectSecret: atribuição sem aspas não confunde código com segredo", () => {
  const codigo: [string, string][] = [
    ["número curto", "MAX_TOKENS=4096"],
    ["nome de constante (sem dígito nem caixa mista)", "TOKEN_LIMIT=calcular_limite_padrao_do_modelo"],
    ["chamada de função", 'API_KEY = carregar_configuracao_ambiente_v2("OPENAI")'],
    ["acesso a atributo", "ACCESS_TOKEN=ConfiguracaoDoAmbienteGlobal2.valor"],
    ["interpolação", "OPENAI_API_KEY=${OPENAI_API_KEY}"],
    ["nome que só contém KEY dentro de outra palavra", `MONKEY_BUSINESS=${sintetico(40, ALNUM, 41)}`],
    ["variável minúscula em Python", `token = obter_token_do_ambiente_${sintetico(4, HEX, 42)}()`],
    ["constante CAIXA_ALTA com dígito como valor", "TOKEN_ENV_VAR=OPENAI_API_KEY_V2_PRODUCTION"],
    ["constante entre aspas (nome da variável de ambiente)", 'api_key_env = "PROVEDOR_ADMIN_API_KEY_2"'],
    ["caminho absoluto com dígito", "SECRET_PATH=/var/lib/app2/secrets/prod2024"],
    ["caminho relativo com dígito (YAML)", "TOKEN_DIR: config/tokens/service2/prod"],
    ["tipo camelCase numa anotação (TypeScript)", "  apiKeyProvider: AuthenticationTokenProviderService;"],
    ["slug num campo key (JSON)", '"key": "pipeline-mce-fase-quatro-lote"'],
  ];

  it.each(codigo)("%s", (_nome, texto) => {
    expect(detectSecret(texto)).toBeNull();
  });
});

describe("detectSecret: custo linear no tamanho do texto", () => {
  // 256 KB de trechos em que um padrão recomeçava a cada `-`, `+` ou `.` e relia o resto da
  // linha: 1 MB de `a-a-a-…` levava minutos. Linear, cada um leva dezenas de milissegundos.
  const casos: [string, string, string][] = [
    ["a-a-a-…", "", "a-"],
    ["a.a.a.…", "", "a."],
    ["Ab+Ab+…", "", "Ab+"],
    ["eyJ-eyJ-…", "", "eyJ-"],
    ["pa- seguido de -your-x-your-x…", "pa-", "-your-x"],
  ];

  it.each(casos)("%s", (_nome, prefixo, unidade) => {
    const texto = prefixo + unidade.repeat(Math.ceil(262144 / unidade.length));
    const t0 = performance.now();
    detectSecret(texto);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

/* ------------------------------------------------------------------ scanRepo: link/junction */

/** Erros de criação de link que significam "o sistema não deixa": o teste é pulado. */
const SEM_PERMISSAO = new Set(["EPERM", "EACCES", "ENOTSUP", "ENOSYS"]);

/** Cria link/junction; false quando o sistema recusa por permissão (symlink de arquivo no Windows sem modo de desenvolvedor). */
function liga(alvo: string, link: string, tipo: "junction" | "file"): boolean {
  try {
    symlinkSync(alvo, link, tipo);
    return true;
  } catch (e) {
    if (SEM_PERMISSAO.has((e as NodeJS.ErrnoException).code ?? "")) return false;
    throw e;
  }
}

function escreve(raiz: string, arquivos: Record<string, string>) {
  for (const [rel, txt] of Object.entries(arquivos)) {
    const abs = path.join(raiz, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, txt);
  }
}

describe("scanRepo: entrada de primeiro nível que é link/junction", () => {
  // Tudo numa pasta temporária: o alvo dos links (fora/) fica DENTRO dela, então nem a
  // varredura nem a limpeza alcançam nada fora do teste.
  let base: string;
  let fora: string;
  let repo: string;
  let repoClaudeLink: string;
  let junctions = true;
  let linkDeArquivo = true;

  beforeAll(() => {
    base = mkdtempSync(path.join(tmpdir(), "common-links-"));
    fora = path.join(base, "fora");
    repo = path.join(base, "repo");
    repoClaudeLink = path.join(base, "repo-claude-link");
    escreve(fora, {
      "docs-fora/guia.md": "# Guia de fora\n\nCONTEUDO-DE-FORA da pasta docs\n",
      "skills-fora/s/SKILL.md": "# Skill de fora\n\nCONTEUDO-DE-FORA da pasta skills\n",
      "aninhado/n.md": "# Aninhado\n\nCONTEUDO-DE-FORA aninhado\n",
      "README.md": "# Readme de fora\n\nCONTEUDO-DE-FORA do readme\n",
      "claude-fora/CLAUDE.md": "# Claude de fora\n\nCONTEUDO-DE-FORA do CLAUDE.md\n",
      "claude-fora/rules/r.md": "# Regra de fora\n\nCONTEUDO-DE-FORA das regras\n",
    });
    const real = {
      "knowledge/external/x/a.md": "# A\n\nconteudo real do knowledge\n",
      "engine/run.py": "print('ok')\n",
    };
    escreve(repo, { ...real, ".claude/rules/regra.md": "# Regra\n\nregra real\n" });
    escreve(repoClaudeLink, real);

    junctions =
      liga(path.join(fora, "docs-fora"), path.join(repo, "docs"), "junction") &&
      liga(path.join(fora, "skills-fora"), path.join(repo, ".claude", "skills"), "junction") &&
      liga(path.join(fora, "aninhado"), path.join(repo, "knowledge", "external", "link-aninhado"), "junction") &&
      liga(path.join(fora, "claude-fora"), path.join(repoClaudeLink, ".claude"), "junction");
    linkDeArquivo = liga(path.join(fora, "README.md"), path.join(repo, "README.md"), "file");
  });

  afterAll(() => {
    if (base) rmSync(base, { recursive: true, force: true });
  });

  it("pasta de ROOT_DIRS e de CLAUDE_DIRS: registrada como link-ou-junction e não atravessada", async (ctx) => {
    if (!junctions) ctx.skip();
    const { docs, excluded } = await scanRepo(repo);
    expect(excluded).toContainEqual({ rel: "docs", motivo: "link-ou-junction" });
    expect(excluded).toContainEqual({ rel: ".claude/skills", motivo: "link-ou-junction" });
    const rels = docs.map((d: { rel: string }) => d.rel);
    expect(rels).toEqual(expect.arrayContaining(["knowledge/external/x/a.md", "engine/run.py", ".claude/rules/regra.md"]));
    expect(rels.filter((r: string) => r.startsWith("docs/") || r.startsWith(".claude/skills/") || r.includes("link-aninhado"))).toEqual([]);
    expect(docs.some((d: { text: string }) => d.text.includes("CONTEUDO-DE-FORA"))).toBe(false);
  });

  it("arquivo de ROOT_FILES que é link: registrado e não lido", async (ctx) => {
    if (!linkDeArquivo) ctx.skip();
    const { docs, excluded } = await scanRepo(repo);
    expect(excluded).toContainEqual({ rel: "README.md", motivo: "link-ou-junction" });
    expect(docs.some((d: { rel: string }) => d.rel === "README.md")).toBe(false);
  });

  it(".claude inteira como junction: registrada uma vez, nada de dentro entra", async (ctx) => {
    if (!junctions) ctx.skip();
    const { docs, excluded } = await scanRepo(repoClaudeLink);
    expect(excluded).toEqual([{ rel: ".claude", motivo: "link-ou-junction" }]);
    const rels = docs.map((d: { rel: string }) => d.rel);
    expect(rels).toEqual(["engine/run.py", "knowledge/external/x/a.md"]);
  });
});
