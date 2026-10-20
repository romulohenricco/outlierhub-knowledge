import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // sem isto o middleware trunca o corpo em 10 MB e o upload de áudio (teto 25 MB) falha mudo
  experimental: { middlewareClientMaxBodySize: "30mb" },
  // Cabeçalhos de segurança. A trava contra incorporação em moldura de outro site
  // fica de fora de /api/file/: o leitor embute essa rota em um iframe do próprio
  // app (visualizador nativo de PDF), e ela só entrega o arquivo, sem interface
  // para clicar. O microfone é do próprio app (gravação de áudio do kanban).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self), payment=(), usb=()" },
        ],
      },
      {
        source: "/((?!api/file/).*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
  distDir: (process.env.NEXT_DIST_DIR || undefined) ?? ".next",
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
