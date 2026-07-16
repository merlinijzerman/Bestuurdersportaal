"use client";
// ============================================================
//  AntwoordWeergave — gedeelde weergave van AI-antwoorden
// ============================================================
// Eén renderer + bronkaart voor ALLE plekken waar een AI-antwoord met
// citatiemarkers en herleidbare bronnen wordt getoond: de volledige assistent
// (/ai) én de agendavoorbereiding (AgendapuntChat). Eerder had /ai een eigen,
// rijke renderer (pills → scroll+highlight, klikbare bronkaart naar het
// origineel) en gebruikte AgendapuntChat een versimpelde variant zonder
// doorklikbare bronnen. Die divergentie is hiermee opgeheven (vervolg op ADR
// 0036, waarin de marker-rendering al werd geconsolideerd): beide instappunten
// delen nu exact dezelfde weergave en herleidbaarheid.
//
// Publieke API:
// - renderAntwoord(tekst, bronnen, berichtIdx, highlight, onBronKlik)
//     Rendert AI-tekst met lichte Markdown + citatie-pills. Een geldige
//     [Bron N]-pill roept onBronKlik(berichtIdx, bronIdx) aan (scroll+highlight).
// - <Bronkaart idx bron idVoorScroll gehighlight />
//     Eén bronkaart; bij heeft_origineel een <a> naar /api/documents/.../bestand.
// - type Bron

import { type ReactNode } from "react";
import { bronkaartLabels, normgewichtLabel, isVeiligeUrl } from "@/core/lib/bronsoort";
import {
  DOCUMENT_STATUS_LABEL,
  BRONSTATUS_LABEL,
} from "@/core/lib/document-status-transities";
import { detecteerInstantieInTekst } from "@/core/lib/assistant-source";

export interface Bron {
  document_id: string;
  titel: string;
  bron: string;
  pagina: number | null;
  paragraaf: string | null;
  fragment: string;
  heeft_origineel: boolean;
  // Increment G — bronkaartvelden (status/bronstatus/datum/bronsoort).
  documentstatus?: string | null;
  bronstatus?: string | null;
  documentdatum?: string | null;
  geldig_tot?: string | null;
  bibliotheek?: string | null;
  bronorganisatie?: string | null;
  normgewicht?: string | null;
  extern_url?: string | null;
}

const BRONKLEUR: Record<string, string> = {
  DNB: "bg-err-tint border-err/30",
  AFM: "bg-accent-tint border-accent/30",
  Pensioenfederatie: "bg-ok-tint border-ok/30",
  Intern: "bg-warn-tint border-warn/30",
  Extern: "bg-warn-tint border-warn/30",
};

const BRONTEKST: Record<string, string> = {
  DNB: "text-err-ink",
  AFM: "text-accent-ink",
  Pensioenfederatie: "text-ok-ink",
  Intern: "text-warn-ink",
  Extern: "text-warn-ink",
};

const BRON_NUMMER_KLEUR: Record<string, string> = {
  DNB: "bg-err text-white",
  AFM: "bg-accent text-white",
  Pensioenfederatie: "bg-ok text-white",
  Intern: "bg-warn text-white",
  Extern: "bg-warn text-white",
};

// Regex pakt alle inline-markeringen in één keer:
// - [Bron 1], [Bron 12]
// - [Algemene kennis], [algemene kennis]
// - [Volgens wetgeving], [volgens wetgeving]
// - [Toelichting agendapunt] (ADR 0028 — ongevalideerde bestuurs-vrijetekst)
// - [Organisatieprofiel] (OP-4 — organisatiespecifieke context, geen fondsbron)
const MARKER_REGEX =
  /(\[Bron \d+\]|\[Algemene kennis\]|\[Volgens wetgeving\]|\[Toelichting agendapunt\]|\[Organisatieprofiel\])/gi;

// ============================================================
//  Antwoord-renderer met lichte Markdown + citatiemarkers
// ============================================================
// Rendert het AI-antwoord met lichte Markdown-ondersteuning. Blok-niveau:
// koppen (#..), opsommingen (- / *) en genummerde lijsten (1.), en alinea's.
// Inline-opmaak (vet/cursief/code) en de citatiemarkers ([Bron N], [Algemene
// kennis], [Volgens wetgeving]) lopen via parseInline. Bewust een eigen, kleine
// renderer i.p.v. een externe library: geen extra dependency, volledige controle
// over de bron-pills, en bestand tegen half-gestreamde (nog niet gesloten)
// markdown tijdens het streamen.
export function renderAntwoord(
  tekst: string,
  bronnen: Bron[] | undefined,
  berichtIdx: number,
  highlight: { berichtIdx: number; bronIdx: number } | null,
  onBronKlik: (berichtIdx: number, bronIdx: number) => void,
) {
  const regels = tekst.split("\n");
  const blokken: ReactNode[] = [];
  let lijstType: "ul" | "ol" | null = null;
  let lijstItems: string[] = [];
  let sleutel = 0;

  const inline = (s: string) =>
    parseInline(s, bronnen, berichtIdx, highlight, onBronKlik);

  const sluitLijst = () => {
    if (!lijstType) return;
    const items = lijstItems.map((it, k) => (
      <li key={k}>{inline(it)}</li>
    ));
    blokken.push(
      lijstType === "ul" ? (
        <ul key={sleutel++} className="list-disc pl-5 my-1.5 space-y-0.5">
          {items}
        </ul>
      ) : (
        <ol key={sleutel++} className="list-decimal pl-5 my-1.5 space-y-0.5">
          {items}
        </ol>
      )
    );
    lijstType = null;
    lijstItems = [];
  };

  for (const regel of regels) {
    const ul = regel.match(/^\s*[-*]\s+(.*)$/);
    const ol = regel.match(/^\s*\d+\.\s+(.*)$/);
    const kop = regel.match(/^(#{1,6})\s+(.*)$/);

    if (ul) {
      if (lijstType !== "ul") sluitLijst();
      lijstType = "ul";
      lijstItems.push(ul[1]);
      continue;
    }
    if (ol) {
      if (lijstType !== "ol") sluitLijst();
      lijstType = "ol";
      lijstItems.push(ol[1]);
      continue;
    }

    sluitLijst();

    if (kop) {
      blokken.push(
        <p key={sleutel++} className="font-bold text-ink mt-2 mb-1">
          {inline(kop[2])}
        </p>
      );
      continue;
    }
    if (!regel.trim()) continue; // lege regel = alinea-scheiding (spacing via mt)

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
  bronnen: Bron[] | undefined,
  berichtIdx: number,
  highlight: { berichtIdx: number; bronIdx: number } | null,
  onBronKlik: (berichtIdx: number, bronIdx: number) => void,
) {
  if (!regel) return null;
  // Reset regex state per call (g-flag is stateful op het Regexp-object)
  const regex = new RegExp(MARKER_REGEX.source, "gi");
  const delen = regel.split(regex);
  return delen.map((deel, i) => {
    if (!deel) return null;

    const bronMatch = deel.match(/^\[Bron (\d+)\]$/i);
    if (bronMatch) {
      const bronIdx = parseInt(bronMatch[1], 10) - 1;
      const bron = bronnen?.[bronIdx];
      if (bron) {
        return (
          <BronPill
            key={i}
            nummer={bronIdx + 1}
            bron={bron}
            gehighlight={
              highlight?.berichtIdx === berichtIdx &&
              highlight?.bronIdx === bronIdx
            }
            onClick={() => onBronKlik(berichtIdx, bronIdx)}
          />
        );
      }
      // Bronvermelding-validatie: een citatie die niet aan een aangeleverde
      // bron te koppelen is, wordt zichtbaar gemarkeerd i.p.v. stil getoond.
      return <OngeldigeBronPill key={i} nummer={bronIdx + 1} />;
    }
    if (/^\[algemene kennis\]$/i.test(deel)) {
      return <KennisPill key={i} label="Algemene kennis" instantie={detecteerInstantieInTekst(regel)} />;
    }
    if (/^\[volgens wetgeving\]$/i.test(deel)) {
      return <KennisPill key={i} label="Volgens wetgeving" instantie={detecteerInstantieInTekst(regel)} />;
    }
    // ADR 0028 — herkomst uit de agendapunt-toelichting: ongevalideerde
    // bestuurs-vrijetekst, géén vastgestelde fondsbron. Eigen waarschuwende
    // styling zodat de niet-vastgestelde herkomst visueel onderscheiden blijft.
    if (/^\[toelichting agendapunt\]$/i.test(deel)) {
      return <ToelichtingPill key={i} />;
    }
    if (/^\[organisatieprofiel\]$/i.test(deel)) {
      return <OrganisatieprofielPill key={i} />;
    }
    // Geen marker → verwerk inline-markdown (vet/cursief/code).
    return <span key={i}>{parseMarkdownInline(deel)}</span>;
  });
}

// Inline-markdown voor een tekstsegment zonder citatiemarkers. Subset: **vet**,
// *cursief* / _cursief_, `code`. Vet wordt vóór cursief gematcht zodat ** niet
// per ongeluk als twee losse * wordt gelezen.
function parseMarkdownInline(tekst: string): ReactNode[] {
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  return tekst.split(regex).map((stuk, i) => {
    if (!stuk) return null;
    if (/^\*\*[^*]+\*\*$/.test(stuk)) {
      return <strong key={i}>{stuk.slice(2, -2)}</strong>;
    }
    if (/^`[^`]+`$/.test(stuk)) {
      return (
        <code key={i} className="bg-app-bg rounded px-1 py-0.5 text-[0.85em]">
          {stuk.slice(1, -1)}
        </code>
      );
    }
    if (/^\*[^*]+\*$/.test(stuk) || /^_[^_]+_$/.test(stuk)) {
      return <em key={i}>{stuk.slice(1, -1)}</em>;
    }
    return stuk;
  });
}

function BronPill({
  nummer,
  bron,
  gehighlight,
  onClick,
}: {
  nummer: number;
  bron: Bron;
  gehighlight: boolean;
  onClick: () => void;
}) {
  const locatie = [bron.paragraaf, bron.pagina && `pag. ${bron.pagina}`]
    .filter(Boolean)
    .join(", ");
  const tooltip =
    `${bron.bron} — ${bron.titel}` +
    (locatie ? ` (${locatie})` : "") +
    `\n\n„${bron.fragment}"` +
    `\n\nKlik om de bronvermelding hieronder te openen.`;
  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip}
      className={`relative -top-[1px] inline-flex items-center justify-center align-baseline mx-0.5 min-w-[20px] h-[18px] px-1.5 rounded-md text-[10px] font-bold leading-none transition-colors cursor-pointer ${
        gehighlight
          ? "bg-accent text-white"
          : "bg-accent/20 text-ink hover:bg-accent/45 hover:shadow-sm"
      }`}
    >
      {nummer}
    </button>
  );
}

// Increment I-3 — de grijze pill draagt nu, indien het antwoord die noemt, de
// bron-instantie (DNB/AFM/…). Zo is inline al zichtbaar waaraan de algemene
// kennis wordt toegeschreven, zonder de kennis te begrenzen of een verzonnen
// documentverwijzing te suggereren.
function KennisPill({ label, instantie }: { label: string; instantie?: string | null }) {
  return (
    <span
      className="relative -top-[1px] inline-flex items-center align-baseline mx-0.5 px-1.5 h-[18px] rounded-md text-[10px] font-semibold leading-none bg-app-line text-muted"
      title={
        instantie
          ? `Niet uit een intern document — algemene kennis, toegeschreven aan ${instantie}`
          : "Niet uit een intern document — algemene kennis of wetgeving"
      }
    >
      {instantie ? `${label} · ${instantie}` : label}
    </span>
  );
}

// ADR 0028 — claim die steunt op de agendapunt-toelichting (door het bestuur
// opgestelde vrije tekst, géén vastgestelde fondsbron). Eigen indigo-styling
// onderscheidt deze herkomst visueel van de gouden [Bron N] (vastgestelde bron)
// en de grijze [Algemene kennis], zodat de niet-vastgestelde status zichtbaar is.
function ToelichtingPill() {
  return (
    <span
      className="relative -top-[1px] inline-flex items-center align-baseline mx-0.5 px-1.5 h-[18px] rounded-md text-[10px] font-semibold leading-none bg-accent-tint text-accent-ink border border-accent/30"
      title="Steunt op de toelichting bij het agendapunt — door het bestuur opgestelde vrije tekst, geen bestuurlijk vastgestelde fondsbron. Verifieer voordat u hierop besluit."
    >
      Toelichting agendapunt
    </span>
  );
}

// OP-4 (FO Organisatieprofiel v0.4 §7/§8) — claim gegrond op het generieke
// organisatieprofiel: organisatiespecifieke context, geen bestuurlijk vastgestelde
// fondsbron en geen wet/regelgeving. Weegt boven algemene kennis, maar onder
// formele stukken. Eigen paars-getinte styling (phase-token) onderscheidt deze
// herkomst van de gouden [Bron N], de grijze [Algemene kennis] en de amber
// [Toelichting agendapunt].
function OrganisatieprofielPill() {
  return (
    <span
      className="relative -top-[1px] inline-flex items-center align-baseline mx-0.5 px-1.5 h-[18px] rounded-md text-[10px] font-semibold leading-none bg-phase-tint text-phase-ink border border-phase/30"
      title="Gegrond op het organisatieprofiel — organisatiespecifieke context, geen bestuurlijk vastgestelde bron en geen wet- of regelgeving. Weegt boven algemene kennis, maar onder formele stukken."
    >
      Organisatieprofiel
    </span>
  );
}

// Bronvermelding-validatie: een [Bron N] die niet aan een aangeleverde bron kan
// worden gekoppeld. Zichtbaar gemarkeerd zodat de bestuurder een mogelijk
// onjuiste/gehallucineerde verwijzing herkent en kan verifiëren.
function OngeldigeBronPill({ nummer }: { nummer: number }) {
  return (
    <span
      className="relative -top-[1px] inline-flex items-center gap-0.5 align-baseline mx-0.5 px-1.5 h-[18px] rounded-md text-[10px] font-semibold leading-none bg-warn-tint text-warn-ink border border-warn/30"
      title="Deze bronverwijzing kon niet aan een aangeleverde bron worden gekoppeld. Controleer dit; mogelijk een onjuiste of niet-onderbouwde verwijzing."
    >
      ⚠ Bron {nummer}?
    </span>
  );
}

export function Bronkaart({
  idx,
  bron,
  idVoorScroll,
  gehighlight,
}: {
  idx: number;
  bron: Bron;
  idVoorScroll: string;
  gehighlight: boolean;
}) {
  const locatie = [bron.paragraaf, bron.pagina && `pag. ${bron.pagina}`]
    .filter(Boolean)
    .join(", ");

  const inhoud = (
    <>
      <span
        className={`flex-shrink-0 w-7 h-7 rounded-md text-[11px] font-bold flex items-center justify-center ${
          BRON_NUMMER_KLEUR[bron.bron] || "bg-app-line text-white"
        }`}
      >
        {idx + 1}
      </span>
      <div className="flex-1 min-w-0">
        <div
          className={`font-bold ${BRONTEKST[bron.bron] || "text-ink"}`}
        >
          {bron.bron} — {bron.titel}
        </div>
        {locatie && (
          <div className="text-muted mt-0.5 italic">📍 {locatie}</div>
        )}
        <div className="text-muted mt-1 leading-relaxed">
          „{bron.fragment}"
        </div>
        <BronkaartMeta bron={bron} />
        {!bron.heeft_origineel && (
          <div className="text-muted mt-1 text-[11px] italic">
            Origineel niet beschikbaar — alleen tekst voor de AI-assistent
          </div>
        )}
      </div>
      {bron.heeft_origineel && (
        <span className="flex-shrink-0 text-muted group-hover:text-ink transition-colors text-sm leading-none mt-1">
          ↗
        </span>
      )}
    </>
  );

  const baseKlasse = `flex items-start gap-2.5 p-2.5 rounded-lg border text-xs transition-all ${
    BRONKLEUR[bron.bron] || "bg-app-bg border-line"
  } ${
    gehighlight
      ? "ring-2 ring-accent ring-offset-1 shadow-md scale-[1.01]"
      : ""
  }`;

  if (bron.heeft_origineel) {
    // Spring direct naar de pagina als we die weten. De #page=N-fragment wordt
    // gehonoreerd door de ingebouwde PDF-viewers van Chrome/Edge/Firefox; voor
    // Word/Excel (download) wordt de fragment genegeerd — geen kwaad.
    const href = bron.pagina
      ? `/api/documents/${bron.document_id}/bestand#page=${bron.pagina}`
      : `/api/documents/${bron.document_id}/bestand`;
    return (
      <a
        id={idVoorScroll}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`group ${baseKlasse} hover:border-accent hover:shadow-sm cursor-pointer scroll-mt-24`}
        title={
          bron.pagina
            ? `Origineel openen op pagina ${bron.pagina} (nieuw tabblad)`
            : "Origineel openen in nieuw tabblad"
        }
      >
        {inhoud}
      </a>
    );
  }
  return (
    <div id={idVoorScroll} className={`${baseKlasse} scroll-mt-24`}>
      {inhoud}
    </div>
  );
}

// Increment G — bronkaart-metadatastrip: status/bronstatus/datum + (bij generiek)
// bronsoort/normgewicht/externe URL/"Vervallen per". Alles optioneel: ontbrekende
// velden (bv. uit het fallback-pad) worden simpelweg niet getoond.
function BronkaartMeta({ bron }: { bron: Bron }) {
  const statusLabel = bron.documentstatus
    ? (DOCUMENT_STATUS_LABEL as Record<string, string>)[bron.documentstatus] ??
      bron.documentstatus
    : null;
  const bronstatusLabel =
    bron.bronstatus && bron.bronstatus !== "actief"
      ? (BRONSTATUS_LABEL as Record<string, string>)[bron.bronstatus] ?? bron.bronstatus
      : null;
  const labels = bronkaartLabels(
    {
      bibliotheek: bron.bibliotheek,
      normgewicht: bron.normgewicht,
      geldig_tot: bron.geldig_tot,
    }
  );
  const heeftIets =
    statusLabel ||
    bronstatusLabel ||
    bron.documentdatum ||
    labels.isGeneriek ||
    labels.vervallen;
  if (!heeftIets) return null;

  const chip =
    "text-[10px] px-1.5 py-0.5 rounded border bg-white/70 border-line text-muted";
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
      {labels.isGeneriek && (
        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-accent-tint border-accent/30 text-accent-ink">
          {labels.bronsoortLabel}
        </span>
      )}
      {statusLabel && <span className={chip}>{statusLabel}</span>}
      {bronstatusLabel && (
        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-warn-tint border-warn/30 text-warn-ink">
          {bronstatusLabel}
        </span>
      )}
      {bron.documentdatum && <span className={chip}>📅 {bron.documentdatum}</span>}
      {labels.isGeneriek && bron.normgewicht && (
        <span className={chip}>{normgewichtLabel(bron.normgewicht)}</span>
      )}
      {labels.isGeneriek && bron.bronorganisatie && (
        <span className={chip}>{bron.bronorganisatie}</span>
      )}
      {labels.vervallen && labels.vervallenLabel && (
        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-err-tint border-err/30 text-err-ink">
          {labels.vervallenLabel}
        </span>
      )}
      {labels.isGeneriek && isVeiligeUrl(bron.extern_url) && (
        <a
          href={bron.extern_url ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] px-1.5 py-0.5 rounded border bg-white/70 border-line text-accent-ink hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          Externe bron ↗
        </a>
      )}
    </div>
  );
}
