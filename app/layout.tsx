import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  Inter,
  JetBrains_Mono,
  IBM_Plex_Mono,
} from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { PagePanelProvider } from "@/components/PagePanel";
import { PageTopbarProvider } from "@/components/PageTopbar";
import { OnboardingBanner } from "@/components/OnboardingBanner";
import { ToastProvider } from "@/components/Toast";
import { getKnowledgeProvider } from "@/lib/providers";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  weight: ["300", "400", "500", "600"],
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  weight: ["400", "500"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  weight: ["400", "500"],
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Knowledge",
  description: "Estante viva de uma base de conhecimento pessoal — local-first.",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
};

/** Aplica o tema salvo ANTES da hidratação (evita flash; chave 'bl-theme'). */
const themeInit = `try{var t=localStorage.getItem('bl-theme')||'bos';document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

/** Aplica o estado do painel antes da hidratação (chave 'bl-nav'). Telas compactas
 *  (≤1023px) abrem colapsadas por padrão — o painel é overlay e não deve cobrir o conteúdo no load. */
const navInit = `try{var s=localStorage.getItem('bl-nav');if(s==='collapsed'||window.innerWidth<=1023)document.documentElement.setAttribute('data-nav','collapsed')}catch(e){}`;

/** Menus recolhidos pelo orb (chave 'bl-chrome') — aplicado antes da hidratação pra não piscar. */
const chromeInit = `try{if(localStorage.getItem('bl-chrome')==='recolhido')document.documentElement.setAttribute('data-chrome','recolhido')}catch(e){}`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const status = await getKnowledgeProvider().status();
  return (
    <html
      lang="pt-BR"
      data-theme="bos"
      suppressHydrationWarning
      className={`${geist.variable} ${geistMono.variable} ${inter.variable} ${jetbrainsMono.variable} ${ibmPlexMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <script dangerouslySetInnerHTML={{ __html: navInit }} />
        <script dangerouslySetInnerHTML={{ __html: chromeInit }} />
      </head>
      {/* suppressHydrationWarning: extensões de browser injetam classe no body */}
      <body suppressHydrationWarning>
        {status.configured ? (
          <ToastProvider>
            <PagePanelProvider>
              <PageTopbarProvider>
                <AppShell>{children}</AppShell>
              </PageTopbarProvider>
            </PagePanelProvider>
          </ToastProvider>
        ) : (
          <OnboardingBanner reason={status.reason ?? "Provider selecionado não está configurado."} />
        )}
      </body>
    </html>
  );
}
