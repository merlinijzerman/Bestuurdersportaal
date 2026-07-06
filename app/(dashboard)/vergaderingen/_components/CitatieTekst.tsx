"use client";
// ============================================================
//  CitatieTekst — gedeelde weergave van AI-tekst met citatie-pills
// ============================================================
// Eén renderer voor alle plekken waar AI-output met herkomstmarkers wordt
// getoond ([Bron N], [Algemene kennis], [Volgens wetgeving],
// [Toelichting agendapunt]). Geëxtraheerd uit AgendapuntChat (ADR 0036 —
// geaccepteerde schuld "dubbele marker-rendering" hiermee opgelost) en
// hergebruikt door VoorbereidingsBlok (bestuurlijke duiding).
//
// Gedrag identiek aan de oorspronkelijke AgendapuntChat-renderer:
// - alinea's, opsommingen (-, *, 1.), koppen (#), **vet**;
// - [Bron N] wordt een klikbare pill; verwijst het nummer niet naar een
//   aangeleverde bron, dan rood + doorgehaald (ongeldige citatie);
// - [Algemene kennis]/[Volgens wetgeving] grijze herkomst-badge;
// - [Toelichting agendapunt] amberkleurige badge (geen vastgestelde bron).

import type { ReactNode } from "react";

// Zelfde markers als de AI-pagina (incl. [Toelichting agendapunt], ADR 0028).
export const MARKER_REGEX =
  /(\[Bron \d+\]|\[Algemene kennis\]|\[Volgens wetgeving\]|\[Toelichting agendapunt\])/gi;

// Minimaal broncontract — structureel compatibel met BronVerwijzing (lib/rag)
// en met de bronnenlijst die de voorbereiding-route opslaat in ai_output.
export interface CitatieBron {
  titel: string;
  pagina?: number | null;
  paragraaf?: string | null;
}

interface Props {
  tekst: string;
  bronnen?: CitatieBron[];
  /** Klik op een geldige [Bron N]-pill; bv. het bronnenblok openen. */
  onBronKlik?: () => void;
}

export default function CitatieTekst({ tekst, bronnen, onBronKlik }: Props) {
  return <>{renderBlokken(tekst, bronnen, onBronKlik)}</>;
}

function renderBlokken(
  tekst: string,
  bronnen: CitatieBron[] | undefined,
  onBronKlik?: () => void
) {
  const regels = tekst.split("\n");
  const blokken: ReactNode[] = [];
  let lijstItems: string[] = [];
  let sleutel = 0;

  const inline = (s: string) => parseInline(s, bronnen, onBronKlik);

  const sluitLijst = () => {
    if (lijstItems.length === 0) return;
    blokken.push(
      <ul key={sleutel++} className="list-disc pl-4 my-1 space-y-0.5">
        {lijstItems.map((it, k) => (
          <li key={k}>{inline(it)}</li>
        ))}
      </ul>
    );
    lijstItems = [];
  };

  for (const regel of regels) {
    const li = regel.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (li) {
      lijstItems.push(li[1]);
      continue;
    }
    sluitLijst();
    const kop = regel.match(/^#{1,6}\s+(.*)$/);
    if (kop) {
      blokken.push(
        <p key={sleutel++} className="font-semibold text-ink mt-1.5 mb-0.5">
          {inline(kop[1])}
        </p>
      );
      continue;
    }
    if (!regel.trim()) continue;
    blokken.push(
      <p key={sleutel++} className={blokken.length > 0 ? "mt-1.5" : ""}>
        {inline(regel)}
      </p>
    );
  }
  sluitLijst();
  return blokken;
}

function parseInline(
  regel: string,
  bronnen: CitatieBron[] | undefined,
  onBronKlik?: () => void
) {
  if (!regel) return null;
  const regex = new RegExp(MARKER_REGEX.source, "gi");
  const delen = regel.split(regex);
  return delen.map((deel, i) => {
    if (!deel) return null;
    const bronMatch = deel.match(/^\[Bron (\d+)\]$/i);
    if (bronMatch) {
      const nr = parseInt(bronMatch[1], 10);
      const bron = bronnen?.[nr - 1];
      return (
        <button
          key={i}
          type="button"
          onClick={onBronKlik}
          title={
            bron
              ? `${bron.titel}${bron.pagina != null ? `, p. ${bron.pagina}` : ""}`
              : "Bron niet gevonden in de aangeleverde context"
          }
          className={`inline-flex items-center justify-center min-w-4 h-4 px-0.5 rounded-full text-[9px] font-semibold align-text-top mx-0.5 ${
            bron
              ? "bg-accent text-white hover:bg-accent hover:text-ink"
              : "bg-red-100 text-red-700 line-through"
          }`}
        >
          {nr}
        </button>
      );
    }
    if (/^\[(algemene kennis|volgens wetgeving)\]$/i.test(deel)) {
      const label = /wetgeving/i.test(deel) ? "Volgens wetgeving" : "Algemene kennis";
      return (
        <span
          key={i}
          className="inline-block text-[9px] font-medium bg-gray-100 text-gray-600 border border-gray-200 rounded-full px-1.5 align-text-top mx-0.5"
          title="Niet gebaseerd op interne fondsdocumenten"
        >
          {label}
        </span>
      );
    }
    if (/^\[toelichting agendapunt\]$/i.test(deel)) {
      return (
        <span
          key={i}
          className="inline-block text-[9px] font-medium bg-amber-100 text-amber-800 border border-amber-200 rounded-full px-1.5 align-text-top mx-0.5"
          title="Afkomstig uit de toelichting van het agendapunt — geen vastgestelde fondsbron"
        >
          Toelichting agendapunt
        </span>
      );
    }
    // Minimale inline-markdown: **vet**.
    const stukjes = deel.split(/(\*\*[^*]+\*\*)/g);
    return (
      <span key={i}>
        {stukjes.map((s, j) => {
          const vet = s.match(/^\*\*([^*]+)\*\*$/);
          return vet ? <strong key={j}>{vet[1]}</strong> : <span key={j}>{s}</span>;
        })}
      </span>
    );
  });
}
