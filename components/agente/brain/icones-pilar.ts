/** Desenho de cada ícone de pilar (traço, viewBox 24). A chave é o nome aceito no campo
 *  `icone` do pilar (ver NOMES_ICONE_PILAR em lib/brain/pilar-icones.ts). Glifos
 *  desenhados neste app; o texto é SVG interno inserido por `Glifo` e nunca vem do usuário. */
export const ICONE_PILAR: Record<string, string> = {
  alvo: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8"/>',
  carteira: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14.5h2"/>',
  pessoas: '<circle cx="9" cy="8" r="3"/><path d="M3 19c.5-3 2.8-5 6-5s5.5 2 6 5"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14c2.6 0 4.5 1.6 5 4.2"/>',
  crescimento: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  mensagem: '<path d="M4 5h16v11H9l-5 4z"/>',
  camadas: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  paleta: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4c0-4.4-4-8.7-9-8.7z"/><circle cx="7.5" cy="11" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16.5" cy="11" r="1"/>',
  rota: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
  grade: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="12" width="8" height="9" rx="1.5"/><rect x="3" y="15" width="8" height="6" rx="1.5"/>',
  codigo: '<path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"/>',
};
