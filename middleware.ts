import { NextResponse, type NextRequest } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { ACCESS_AUD, ACCESS_CONFIGURADO, ACCESS_EMAIL, ACCESS_ISSUER, ACCESS_JWKS_URL, exigeAccess, extrairToken, origemCruzada } from "@/lib/access";

const JWKS = ACCESS_CONFIGURADO ? createRemoteJWKSet(new URL(ACCESS_JWKS_URL)) : null;
function negar(motivo: string) {
  return new NextResponse("acesso negado", {
    status: 403,
    headers: { "x-knowledge-access": motivo, "cache-control": "no-store" },
  });
}

export async function middleware(req: NextRequest) {
  // Vale para local e externo: o Host local não impede que outra página do
  // navegador dispare uma escrita.
  if (origemCruzada(req.method, req.headers)) return negar("origem-cruzada");
  if (!exigeAccess(req.headers)) return NextResponse.next();
  if (!JWKS) return negar("nao-configurado");
  const token = extrairToken(req.headers);
  if (!token) return negar("sem-jwt");
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: ACCESS_ISSUER, audience: ACCESS_AUD, algorithms: ["RS256"], requiredClaims: ["exp"] });
    if (typeof payload.email !== "string" || payload.email.toLowerCase() !== ACCESS_EMAIL.toLowerCase()) {
      return negar("email-nao-autorizado");
    }
  } catch {
    return negar("jwt-invalido");
  }
  return NextResponse.next();
}

// O otimizador de imagens também pode servir conteúdo privado, portanto é protegido.
export const config = { matcher: ["/((?!_next/static|favicon.ico).*)"] };
