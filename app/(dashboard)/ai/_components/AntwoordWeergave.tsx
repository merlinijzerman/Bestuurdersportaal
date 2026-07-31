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

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  parseerBlokken,
  bronIndexVoor,
  numeriekeKolommen,
  type Blok,
  type InlineDeel,
  type InlineStuk,
} from "@/core/lib/antwoord-parser";
import {
  bouwKopie,
  nlDatum,
  schrijfNaarKlembord,
  type KopieBron,
  type KopiePayload,
} from "@/core/lib/antwoord-klembord";
import { bronkaartLabels, normgewichtLabel, isVeiligeUrl } from "@/core/lib/bronsoort";
import {
  DOCUMENT_STATUS_LABEL,
  BRONSTATUS_LABEL,
} from "@/core/lib/document-status-transities";

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

// ============================================================
//  Antwoord-renderer met lichte Markdown + citatiemarkers
// ============================================================
// Rendert het AI-antwoord met lichte Markdown-ondersteuning. Blok-niveau:
// koppen (#..), opsommingen (- / *) en genummerde lijsten (1.), en alinea's.
// Inline-opmaak (vet/cursief/code) en de citatiemarkers ([Bron N], [Algemene
// kennis], [Volgens wetgeving]) lopen mee in dezelfde AST. Bewust een eigen,
// kleine parser i.p.v. een externe library: geen extra dependency, volledige
// controle over de bron-pills, en bestand tegen half-gestreamde (nog niet
// gesloten) markdown tijdens het streamen.
//
// De PARSER zelf woont sinds deze tranche in core/lib/antwoord-parser.ts (pure
// functies, testbaar, gedeeld met de kopieerfunctie); dit bestand is nog
// uitsluitend de React-rendering van de AST die daaruit komt. De key-nummering
// van de AST (`k`) is die van de oude implementatie, zodat het remount-gedrag
// tijdens het streamen niet verschuift.
export function renderAntwoord(
  tekst: string,
  bronnen: Bron[] | undefined,
  berichtIdx: number,
  highlight: { berichtIdx: number; bronIdx: number } | null,
  onBronKlik: (berichtIdx: number, bronIdx: number) => void,
  /**
   * Zet de kopieerknop per blok aan. Weglaten (of null) = geen knoppen — zo
   * blijft een nog stromend antwoord onkopieerbaar, want een halve kopie met
   * een volledige herkomstregel zou meer suggereren dan er staat.
   */
  kopie?: KopieHerkomst | null,
) {
  const inline = (delen: InlineDeel[]) =>
    renderInline(delen, bronnen, berichtIdx, highlight, onBronKlik);

  // De omhulling staat er ALTIJD, ook zonder kopieerknop: zo is de DOM-structuur
  // gelijk tijdens en na het streamen. Zou de wrapper pas verschijnen zodra het
  // antwoord af is, dan wordt op dat moment de hele antwoord-subtree opnieuw
  // opgebouwd — onnodig werk en een zichtbare hik aan het eind van elk antwoord.
  //
  // De LEESMAAT zit op de omhulling en niet op het blok zelf. Zo valt de
  // kopieerknop (absoluut, rechtsboven) binnen de tekstkolom in plaats van
  // honderden pixels daarbuiten: in /ai is de container 1020px breed terwijl de
  // tekst tot 68ch loopt. Tabellen krijgen de maat niet — die houden de volle
  // breedte.
  const omhul = (sleutel: number, blok: Blok, inhoud: ReactNode) => (
    <div
      key={sleutel}
      className={`ai-blok group${blok.soort === "tabel" ? "" : " ai-lees"}`}
    >
      {inhoud}
      {kopie && (
        <KopieerKnop
          bouw={() => bouwBlokKopie([blok], bronnen, kopie)}
          label={`${BLOK_LABEL[blok.soort]} kopiëren`}
          klasse="absolute top-0 right-0"
        />
      )}
    </div>
  );

  return parseerBlokken(tekst).map((blok, sleutel) => {
    switch (blok.soort) {
      case "lijst":
        return omhul(
          sleutel,
          blok,
          blok.geordend ? (
            <ol key={sleutel} className="list-decimal pl-5 my-1.5 space-y-0.5">
              {blok.items.map((it, k) => (
                <li key={k}>{inline(it)}</li>
              ))}
            </ol>
          ) : (
            <ul key={sleutel} className="list-disc pl-5 my-1.5 space-y-0.5">
              {blok.items.map((it, k) => (
                <li key={k}>{inline(it)}</li>
              ))}
            </ul>
          ),
        );

      case "tabel": {
        // Uitlijning per kolom uit de CELINHOUD (deterministische regex in
        // core/lib/antwoord-parser). De kopcel volgt de kolom, net als in de
        // stuurinformatie-tabellen.
        const numeriek = numeriekeKolommen(blok);
        return omhul(
          sleutel,
          blok,
          <div key={sleutel} className="my-3 overflow-x-auto">
            <table className="si-tabel si-tabel-gesloten">
              <thead>
                <tr>
                  {blok.kop.map((c, ci) => (
                    // .si-tabel zet zelf geen text-align op th; de browser-default
                    // is center. Alle si-tabel-gebruikers zetten die per th —
                    // die conventie volgen we hier ook.
                    <th key={ci} className={numeriek[ci] ? "si-num" : "text-left"}>
                      {inline(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {blok.rijen.map((rij, ri) => (
                  <tr key={ri} className="align-top">
                    {rij.map((c, ci) => (
                      <td key={ci} className={numeriek[ci] ? "si-num" : undefined}>
                        {inline(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
      }

      case "kop":
        // Een echte kop i.p.v. een vetgedrukte alinea, zodat schermlezers erop
        // kunnen navigeren. Alle markdown-niveaus (# t/m ######) landen bewust
        // op h4: de kopniveaus van het model zijn geen documenthiërarchie en
        // zouden de paginastructuur anders vervuilen.
        return omhul(
          sleutel,
          blok,
          <h4 key={sleutel} className="ai-kop">
            {inline(blok.inline)}
          </h4>,
        );

      case "alinea":
        return omhul(
          sleutel,
          blok,
          <p key={sleutel} className={sleutel > 0 ? "mt-1.5" : undefined}>
            {inline(blok.inline)}
          </p>,
        );
    }
  });
}

// ============================================================
//  Kopiëren uit de chat (besluit 0098)
// ============================================================
// De kopieerknop is de enige weg naar het klembord en loopt altijd via
// bouwKopie(), dat de bronnenlijst en de herkomstregel zelf toevoegt. Er is
// bewust geen variant zonder. Een kopieeractie wordt NIET gelogd: het is geen
// besluit en geen export naar het dossier. Voeg hier dus ook geen "voor de
// zekerheid"-logging toe — dat is een expliciet besluit van de opdrachtgever.

/** Waar de kopie vandaan komt; voedt de herkomstregel. */
export interface KopieHerkomst {
  fondsnaam?: string | null;
  surface: "assistent" | "agendapunt";
}

/** De Bron-payload van de weergave omgezet naar de velden onder een kopie. */
function bouwBlokKopie(
  blokken: Blok[],
  bronnen: Bron[] | undefined,
  herkomst: KopieHerkomst,
): KopiePayload {
  const kopieBronnen: KopieBron[] = (bronnen ?? []).map((b, i) => ({
    nummer: i + 1,
    titel: b.titel,
    bron: b.bron,
    paragraaf: b.paragraaf,
    pagina: b.pagina,
    documentdatum: b.documentdatum,
    documentstatus: b.documentstatus,
  }));
  return bouwKopie(blokken, kopieBronnen, {
    fondsnaam: herkomst.fondsnaam ?? null,
    // Bewust hier en niet tijdens het renderen: een datum in de render zou bij
    // server-rendering een andere waarde geven dan in de browser (hydration).
    datum: nlDatum(new Date()),
    surface: herkomst.surface,
  });
}

// Onderscheidende knoplabels: met vijftien identieke "Dit blok kopiëren"-knoppen
// kan een schermlezergebruiker ze niet uit elkaar houden.
const BLOK_LABEL: Record<string, string> = {
  alinea: "Deze alinea",
  kop: "Dit kopje",
  lijst: "Deze lijst",
  tabel: "Deze tabel",
};

const STATUS_TEKST: Record<string, string> = {
  opmaak: "Gekopieerd, met opmaak en bronvermelding.",
  tekst: "Gekopieerd als tekst, met bronvermelding. Uw browser ondersteunt geen opgemaakte kopie.",
  mislukt: "Kopiëren is niet gelukt.",
};

/**
 * Kopieerknop. Zichtbaar bij hover én bij toetsenbordfocus (niet alleen hover),
 * en meldt de uitkomst via een aria-live-gebied zodat een schermlezergebruiker
 * bevestiging krijgt.
 */
function KopieerKnop({
  bouw,
  label,
  klasse = "",
  toon = "icoon",
}: {
  bouw: () => KopiePayload;
  label: string;
  klasse?: string;
  toon?: "icoon" | "tekst";
}) {
  const [status, setStatus] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  // Timer opruimen bij unmount én bij een volgende klik: anders wist een oudere
  // timer de status van een nieuwere kopie voortijdig.
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const kopieer = () => {
    // De payload wordt SYNCHROON opgebouwd: Safari verbreekt de
    // gebruikersgebaar-keten zodra er vóór het schrijven ge-await wordt.
    const payload = bouw();
    void schrijfNaarKlembord(payload).then((r) => {
      setStatus(r);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setStatus(null), 4000);
    });
  };

  const zichtbaarheid =
    toon === "icoon"
      ? "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
      : "";

  return (
    <>
      <button
        type="button"
        onClick={kopieer}
        aria-label={label}
        className={`${klasse} ${zichtbaarheid} inline-flex items-center gap-1 rounded-md border border-app-line-control bg-app-surface px-2 py-1 text-[11px] font-semibold text-muted transition-colors hover:border-accent hover:text-ink`}
      >
        <span aria-hidden="true">⧉</span>
        {toon === "tekst" ? label : null}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {status ? STATUS_TEKST[status] : ""}
      </span>
    </>
  );
}

/**
 * "Antwoord kopiëren" voor de actiebalk onder een antwoord. Kopieert het hele
 * antwoord inclusief bronnenlijst en herkomstregel.
 */
export function AntwoordKopieerKnop({
  tekst,
  bronnen,
  herkomst,
}: {
  tekst: string;
  bronnen: Bron[] | undefined;
  herkomst: KopieHerkomst;
}) {
  return (
    <KopieerKnop
      bouw={() => bouwBlokKopie(parseerBlokken(tekst), bronnen, herkomst)}
      label="Antwoord kopiëren"
      toon="tekst"
    />
  );
}

// Rendert de inline-AST van één regel of tabelcel: citatiemarkers worden pills,
// tekstsegmenten dragen hun eigen inline-markdown (vet/cursief/code).
function renderInline(
  delen: InlineDeel[],
  bronnen: Bron[] | undefined,
  berichtIdx: number,
  highlight: { berichtIdx: number; bronIdx: number } | null,
  onBronKlik: (berichtIdx: number, bronIdx: number) => void,
) {
  if (delen.length === 0) return null;
  return delen.map((deel) => {
    switch (deel.soort) {
      case "bron": {
        const bronIdx = bronIndexVoor(deel.nummer, bronnen?.length ?? 0);
        const bron = bronIdx !== null ? bronnen?.[bronIdx] : undefined;
        if (bron && bronIdx !== null) {
          return (
            <BronPill
              key={deel.k}
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
        return <OngeldigeBronPill key={deel.k} nummer={deel.nummer} />;
      }
      case "kennis":
        return (
          <KennisPill key={deel.k} label={deel.label} instantie={deel.instantie} />
        );
      // ADR 0028 — herkomst uit de agendapunt-toelichting: ongevalideerde
      // bestuurs-vrijetekst, géén vastgestelde fondsbron. Eigen waarschuwende
      // styling zodat de niet-vastgestelde herkomst visueel onderscheiden blijft.
      case "toelichting":
        return <ToelichtingPill key={deel.k} />;
      case "organisatieprofiel":
        return <OrganisatieprofielPill key={deel.k} />;
      case "tekst":
        return <span key={deel.k}>{renderStukken(deel.stukken)}</span>;
    }
  });
}

// Inline-markdown voor een tekstsegment zonder citatiemarkers. Subset: **vet**,
// *cursief* / _cursief_, `code`.
function renderStukken(stukken: InlineStuk[]): ReactNode[] {
  return stukken.map((s) => {
    switch (s.soort) {
      case "vet":
        return <strong key={s.k}>{s.tekst}</strong>;
      case "code":
        return (
          <code key={s.k} className="bg-app-bg rounded px-1 py-0.5 text-[0.85em]">
            {s.tekst}
          </code>
        );
      case "cursief":
        return <em key={s.k}>{s.tekst}</em>;
      case "plat":
        return s.tekst;
    }
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
