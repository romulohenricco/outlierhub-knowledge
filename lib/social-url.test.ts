import { describe, expect, it } from "vitest";
import { urlHttp } from "./social-url";

describe("urlHttp — só http(s) vira link", () => {
  it("aceita http e https", () => {
    expect(urlHttp("https://example.invalid/p/abc/")).toBe("https://example.invalid/p/abc/");
    expect(urlHttp("  http://example.invalid/x ")).toBe("http://example.invalid/x");
  });

  it("recusa esquemas perigosos, caminho relativo e o que não é texto", () => {
    for (const u of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "//example.invalid/x", "/p/abc", "", null, undefined, 3]) {
      expect(urlHttp(u), String(u)).toBeUndefined();
    }
  });
});
