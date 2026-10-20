"use client";

import Link from "next/link";
import { ExternalLink, ArrowLeft, BadgeCheck, Image as ImageIcon, Play, Layers } from "lucide-react";
import { SocialVazio } from "./SocialVazio";
import type { ContaSocial, Dossie } from "@/lib/social";
import { dataHumana, numeroHumano, rotuloNicho } from "@/lib/social-formato";

const ICONE_TIPO = { imagem: ImageIcon, video: Play, carrossel: Layers } as const;

function thumbSrc(username: string, arquivo: string) {
  return `/api/mysocialmedia/thumb/${encodeURIComponent(username)}/${encodeURIComponent(arquivo)}`;
}

export function PerfilSocial({
  conta,
  dossie,
  rotulosNichos,
}: {
  conta: ContaSocial;
  dossie: Dossie | null;
  rotulosNichos: Record<string, string>;
}) {
  return (
    <div>
      <Link
        href="/mysocialmedia/instagram?aba=contas"
        className="mb-4 inline-flex items-center gap-1 text-sm text-white/40 hover:text-white/80"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        contas do Instagram
      </Link>

      <div className="mb-6 rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] p-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <a
            href={`https://www.instagram.com/${encodeURIComponent(conta.username)}/`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-lg font-semibold text-white/90 hover:text-[#e1306c]"
          >
            @{conta.username}
            <ExternalLink className="h-4 w-4 text-white/30" />
          </a>
          {conta.negocio && <BadgeCheck className="h-4 w-4 text-[#e1306c]" />}
          <span className="ml-auto text-sm text-white/40">{numeroHumano(conta.seguidores)} seguidores</span>
        </div>
        {conta.nome && conta.nome !== conta.username && (
          <p className="mb-2 text-sm text-white/60">{conta.nome}</p>
        )}
        <p className="mb-3 whitespace-pre-line text-sm text-white/70">{conta.bio || <span className="italic text-white/30">sem bio</span>}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {conta.categoria && (
            <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-white/40">
              {conta.categoria}
            </span>
          )}
          {conta.nichos.map((n) => (
            <span key={n} className="rounded-full bg-[rgba(168,85,247,0.15)] px-2 py-0.5 text-[11px] text-[#a855f7]">
              {rotuloNicho(n, rotulosNichos)}
            </span>
          ))}
        </div>
      </div>

      {!dossie ? (
        <SocialVazio
          titulo="Este perfil ainda não tem dossiê"
          arquivos={[`instagram-contas/perfis/${conta.username}/dossie.json`, `instagram-contas/perfis/${conta.username}/<miniatura>.jpg`]}
        >
          Bio e números vêm de <code className="text-white/60">contas.json</code>. A análise da conta e os posts recentes aparecem aqui quando você colocar o dossiê dela.
        </SocialVazio>
      ) : (
        <>
          <div className="mb-6 rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] p-5">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-[#a855f7]">análise</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-white/75">{dossie.analise}</p>
            <p className="mt-3 text-[11px] text-white/30">
              ingerido em {dataHumana(dossie.ingeridoEm)} · {dossie.posts.length} posts recentes analisados
            </p>
          </div>

          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.06em] text-white/40">posts recentes</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {dossie.posts.map((p) => {
              const Icone = ICONE_TIPO[p.tipo];
              return (
                <a
                  key={p.code}
                  href={`https://www.instagram.com/p/${encodeURIComponent(p.code)}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="group overflow-hidden rounded-[var(--bl-radius-md)] border border-[var(--bl-border)] bg-[var(--bl-bg-card-solid)] transition-colors hover:border-[var(--bl-border-hover)]"
                >
                  <div className="relative aspect-square bg-black/20">
                    {p.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumbSrc(conta.username, p.thumb)}
                        alt={p.caption || p.code}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-white/15">
                        <Icone className="h-6 w-6" />
                      </div>
                    )}
                    <span className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1">
                      <Icone className="h-3 w-3 text-white/80" />
                    </span>
                  </div>
                  <div className="p-2">
                    <p className="line-clamp-2 text-[11px] text-white/55">{p.caption || <span className="italic text-white/25">sem legenda</span>}</p>
                    <p className="mt-1 text-[10px] text-white/30">
                      {dataHumana(p.dataPost)}
                      {p.likes != null && <span> · {numeroHumano(p.likes)} curtidas</span>}
                    </p>
                  </div>
                </a>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
