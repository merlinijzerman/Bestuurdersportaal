"use client";
// ============================================================
//  AntwoordWeergave — gedeelde weergave van AI-antwoorden
// ============================================================
// Eén renderer + bronkaart voor ALLE plekken waar een AI-antwoord met
// citatiemarkers en herleidbare bronnen wordt getoond: de volledige assistent
// (/ai) én de agendavoorbereiding (VoorbereidingKaart). Eerder had /ai een eigen,
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

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
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
  ACTUELE_BRON_STATUSSEN,
} from "@/core/lib/document-status-transities";
import {
  DECISION_STATUS_LABEL,
  mapDecisionToProcedureStatus,
  type DecisionStatus,
} from "@/core/lib/decision-view";
import {
  groepeerDocumentbronnen,
  pasFilterToe,
  documentIdsVan,
  documenttypeLabel,
  type Documentfilter,
  type Documentregel,
} from "@/core/lib/documentlijst";
import { pillLabelVoor } from "@/core/lib/bronsamenvatting";

// P1a — `Bron` woont sinds de laagsplitsing in `core/lib/assistent-types.ts`,
// zodat de gesprekslaag (L2) hem kan gebruiken zonder uit `app/` te importeren.
// Hier ongewijzigd doorgegeven: elke bestaande importregel blijft werken.
export type { Bron } from "@/core/lib/assistent-types";
import type { Bron } from "@/core/lib/assistent-types";

// De bronorganisatie draagt nog één kleursignaal: het nummerbolletje. De
// vlak- en tekstkleuren per organisatie zijn vervallen met de neutrale
// bronkaart (zie Bronkaart hieronder).
const BRON_NUMMER_KLEUR: Record<string, string> = {
  DNB: "bg-err text-white",
  AFM: "bg-accent text-white",
  Pensioenfederatie: "bg-ok text-white",
  Intern: "bg-warn text-white",
  Extern: "bg-warn text-white",
};

// ============================================================
//  Bronhelpers — gedeeld door de pill, de preview en de bronkaart
// ============================================================
// Één afleiding per gegeven, zodat de hover-preview en de bronkaart nooit iets
// anders beweren over dezelfde bron.

/** Vindplaats binnen het stuk: "Hoofdstuk 3 · pag. 14". Leeg = niet bekend. */
function vindplaatsVan(bron: Bron): string {
  return [bron.paragraaf, bron.pagina ? `pag. ${bron.pagina}` : null]
    .filter(Boolean)
    .join(" · ");
}

/**
 * De benoemde openen-actie, of `null` als er geen origineel is. Het
 * `#page=N`-fragment wordt gehonoreerd door de ingebouwde PDF-viewers van
 * Chrome/Edge/Firefox; bij Word/Excel (download) wordt het genegeerd.
 */
function openenActieVan(bron: Bron): { href: string; label: string } | null {
  if (!bron.heeft_origineel) return null;
  return bron.pagina
    ? {
        href: `/api/documents/${bron.document_id}/bestand#page=${bron.pagina}`,
        label: `Openen op pagina ${bron.pagina}`,
      }
    : {
        href: `/api/documents/${bron.document_id}/bestand`,
        label: "Openen in het document",
      };
}

// ── Statusoordeel ────────────────────────────────────────────────────────────
// Wat de bestuurder moet zien is niet "is dit een concept?" maar "mag ik hier
// zonder voorbehoud op varen?". Dat is een ALLOW-list, geen deny-list: de
// codebase kent één definitie van een actuele bron (ACTUELE_BRON_STATUSSEN, en
// in rag.ts dezelfde twee waarden) en alles daarbuiten — `concept`,
// `ter_bespreking`, `ter_besluitvorming`, maar óók `vervangen`,
// `alleen_historisch` en `gearchiveerd` — is géén actuele grondslag.
//
// Een deny-list met drie statussen liet de onderkant van de ladder onbewaakt:
// een vervangen beleidsstuk zag er dan uit als van kracht, en dat is precies het
// geval waarin een bestuurder op verouderd beleid vaart.
//
// BELANGRIJK: een ONBEKENDE status wordt niet gemarkeerd. Markeren betekent
// "let op, niet vastgesteld", en dat is bij ontbrekende data net zo goed een
// ongefundeerde bewering als het omgekeerde. In plaats daarvan zegt de preview
// expliciet dát de status niet is meegeleverd.

/** Fasen waarin een Decision Object een genomen besluit vertegenwoordigt. */
const BESLOTEN_FASEN = new Set(["besloten", "in_implementatie"]);

/** Bron uit de besluitregistratie (core/lib/besluitvorming-bron.ts). */
function isBesluitBron(bron: Bron): boolean {
  return bron.bron === "Decision Object";
}

interface Statusoordeel {
  /** Leesbaar statuslabel, of null als de status niet is meegeleverd. */
  label: string | null;
  /** Aantoonbaar géén actuele, vastgestelde grondslag → gestippelde rand. */
  gemarkeerd: boolean;
  /** Extra tekstuele dragers naast de randstijl (bronstatus, vervallen-datum). */
  bijzonderheden: string[];
}

function statusOordeel(bron: Bron): Statusoordeel {
  const bijzonderheden: string[] = [];

  // De besluitregistratie zet een Decision Object-status in het documentstatus-
  // veld. Die hoort in een ánder domein thuis: `besloten` is daar de vastgestelde
  // grondslag, niet `vastgesteld`. Zonder deze tak zou de ruwe enum-waarde
  // ("in_onderbouwing") in de preview en het aria-label belanden.
  if (isBesluitBron(bron)) {
    const status = bron.documentstatus ?? null;
    if (!status) return { label: null, gemarkeerd: false, bijzonderheden };
    const label =
      (DECISION_STATUS_LABEL as Record<string, string>)[status] ?? status;
    const fase = mapDecisionToProcedureStatus(status as DecisionStatus);
    return { label, gemarkeerd: !BESLOTEN_FASEN.has(fase), bijzonderheden };
  }

  const status = bron.documentstatus ?? null;
  const label = status
    ? (DOCUMENT_STATUS_LABEL as Record<string, string>)[status] ?? status
    : null;

  let gemarkeerd =
    !!status && !(ACTUELE_BRON_STATUSSEN as string[]).includes(status);

  // Bronstatus en vervaldatum maken een bron óók niet-actueel, ook als de
  // documentstatus 'van_kracht' is. Zie zouActueelZijn() in core/lib/rag.ts:
  // daar telt dezelfde drieslag voor de retrieval-filtering.
  if (bron.bronstatus && bron.bronstatus !== "actief") {
    gemarkeerd = true;
    bijzonderheden.push(
      (BRONSTATUS_LABEL as Record<string, string>)[bron.bronstatus] ?? bron.bronstatus
    );
  }
  const labels = bronkaartLabels({
    bibliotheek: bron.bibliotheek,
    normgewicht: bron.normgewicht,
    geldig_tot: bron.geldig_tot,
  });
  if (labels.vervallen) {
    gemarkeerd = true;
    if (labels.vervallenLabel) bijzonderheden.push(labels.vervallenLabel);
  }

  return { label, gemarkeerd, bijzonderheden };
}

/**
 * Heeft deze bron een citeerbaar fragment? Niet op elk pad. Het dekkingsbrede
 * document-scope-pad (`documentBronnen()` in app/api/chat/route.ts) bouwt één
 * bronkaart per DOCUMENT in plaats van per chunk en laat het fragment leeg,
 * omdat het antwoord tekstueel naar pagina's verwijst; een besluitbron zonder
 * ingevulde besluitvraag levert eveneens een lege string.
 *
 * `?? ""` is geen defensieve tic: `Bron[]` komt via een ongecontroleerde cast uit
 * `gesprekken.berichten` (jsonb) en uit het SSE-event, dus een oud of
 * onvolledig bericht kan het veld missen.
 */
function heeftFragment(bron: Bron): boolean {
  return (bron.fragment ?? "").trim().length > 0;
}

// Bewust ZONDER dekkingsuitspraak. Een eerdere formulering ("het volledige
// document is als bron gebruikt") sprak het antwoord tegen: bij een document dat
// niet in MAX_BATCHES past zet de route `breedAfgekapt` en instrueert ze het
// model juist te melden dát de dekking gedeeltelijk is. De bronkaart mag die
// tegenspraak niet introduceren — en ze weet het ook niet: `breedAfgekapt` reist
// niet mee in de payload.
const GEEN_FRAGMENT_MELDING =
  "Geen losse passage als citaat aangewezen — zie de verwijzingen in het antwoord.";

const GEEN_STATUS_MELDING = "Status niet meegeleverd bij deze bronvermelding";

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

// ============================================================
//  Hover-preview op de [Bron N]-pill
// ============================================================
// Verifiëren zonder te scrollen: fragment, vindplaats en een benoemde
// openen-actie, uit data die al in de client zit. Vervangt het native
// `title`-attribuut, dat NIET aan WCAG 1.4.13 voldoet (niet hoverbaar, niet met
// Escape te sluiten, en op sommige platforms te kort zichtbaar).
//
// Twee bewuste constructiekeuzes:
//
//  1. POSITION: FIXED, niet absolute. Het antwoord staat in beide surfaces in een
//     scrollcontainer (/ai: `flex-1 overflow-y-auto`; agendapuntchat:
//     `max-h-96 overflow-y-auto`) en tabellen staan in `overflow-x-auto`. Een
//     absoluut gepositioneerde preview wordt daar afgeknipt. Er staat vandaag
//     geen `transform`/`filter`/`perspective` op een voorouder, dus het viewport
//     blijft het containing block. Zet die daar ooit wél op, dan verschuift deze
//     preview mee — dat is de bekende grens van deze constructie.
//  2. DE PREVIEW IS EEN SIBLING VAN DE PILL, geen kind. Er staat een link in, en
//     een <a> in een <button> is ongeldige HTML en breekt de tabvolgorde. Omdat
//     hij wél in dezelfde wrapper zit, telt hij voor mouseenter/mouseleave en
//     voor focus als één geheel — precies wat "hoverbaar" en "persistent" vragen.

const PREVIEW_BREEDTE = 320;
/** Uitstel bij het wegbewegen, zodat de muis de kier naar de preview kan oversteken. */
const SLUIT_VERTRAGING_MS = 150;
/**
 * Ruimte die boven de pill vrij moet zijn om de preview daar te plaatsen. Ruim
 * genomen: bij een lange titel plus een citaat van 300 tekens wordt de preview
 * ongeveer 280px hoog. Past hij niet, dan gaat hij eronder — en `maxHeight` in
 * de stijl vangt het uitzonderlijke geval af dat hij ook dán niet past.
 */
const PREVIEW_RUIMTE_BOVEN = 320;

type PreviewPositie = { left: number; top?: number; bottom?: number };

function berekenPositie(pil: HTMLElement): PreviewPositie {
  const r = pil.getBoundingClientRect();
  const breedte = Math.min(PREVIEW_BREEDTE, window.innerWidth - 16);
  const left = Math.min(
    Math.max(8, r.left + r.width / 2 - breedte / 2),
    Math.max(8, window.innerWidth - breedte - 8)
  );
  // Boven de pill als daar plek is; anders eronder. Door met `bottom` te ankeren
  // hoeven we de hoogte van de preview niet vooraf te meten.
  return r.top > PREVIEW_RUIMTE_BOVEN
    ? { left, bottom: window.innerHeight - r.top + 8 }
    : { left, top: r.bottom + 8 };
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
  const [positie, setPositie] = useState<PreviewPositie | null>(null);
  const wrapper = useRef<HTMLSpanElement>(null);
  const pil = useRef<HTMLButtonElement>(null);
  const sluitTimer = useRef<number | null>(null);
  const previewId = useId();
  const open = positie !== null;

  const annuleerSluiten = () => {
    if (sluitTimer.current !== null) {
      window.clearTimeout(sluitTimer.current);
      sluitTimer.current = null;
    }
  };

  const toon = useCallback(() => {
    annuleerSluiten();
    if (pil.current) setPositie(berekenPositie(pil.current));
  }, []);

  const verberg = () => {
    annuleerSluiten();
    setPositie(null);
  };

  const verbergStraks = () => {
    annuleerSluiten();
    sluitTimer.current = window.setTimeout(() => setPositie(null), SLUIT_VERTRAGING_MS);
  };

  useEffect(() => () => annuleerSluiten(), []);

  // Meebewegen met de omringende scrollcontainer én het venster, plus sluiten
  // zodra de pill uit beeld scrolt (anders blijft de preview los in het venster
  // hangen). En: WCAG 1.4.13 "dismissible" vraagt dat Escape werkt ZONDER de
  // focus te verplaatsen — een preview die met de muis is geopend heeft de focus
  // niet, dus een handler op de wrapper zou dan nooit vuren. Vandaar `document`.
  // Bewust géén stopPropagation/preventDefault: de @-mention-Escape op de
  // textarea in AssistentClient moet ongemoeid blijven.
  useEffect(() => {
    if (!open) return;
    const herbereken = () => {
      if (!pil.current) return;
      const r = pil.current.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) {
        setPositie(null);
        return;
      }
      setPositie(berekenPositie(pil.current));
    };
    const opEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const focusBinnen = wrapper.current?.contains(document.activeElement);
      verberg();
      if (focusBinnen) pil.current?.focus();
    };
    window.addEventListener("scroll", herbereken, { capture: true, passive: true });
    window.addEventListener("resize", herbereken);
    document.addEventListener("keydown", opEscape);
    return () => {
      window.removeEventListener("scroll", herbereken, { capture: true });
      window.removeEventListener("resize", herbereken);
      document.removeEventListener("keydown", opEscape);
    };
    // `verberg` is stabiel genoeg: hij raakt alleen refs en de setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const oordeel = statusOordeel(bron);
  const label = pillLabelVoor({
    titel: bron.titel,
    documentdatum: bron.documentdatum,
    documenttypeLabel: documenttypeLabel(bron),
  });

  return (
    <span
      ref={wrapper}
      className="relative inline-block"
      onMouseEnter={toon}
      onMouseLeave={verbergStraks}
      onFocus={toon}
      onBlur={(e) => {
        // Focus die binnen de wrapper blijft (pill → openen-link) sluit niet.
        if (!wrapper.current?.contains(e.relatedTarget as Node | null)) verberg();
      }}
    >
      <button
        ref={pil}
        type="button"
        // Klikken betekent "breng me naar de bronkaart". De preview heeft dan zijn
        // werk gedaan; laten staan zou hem — via de scroll-listener — bovenop de
        // kaart plaatsen waar zojuist naartoe is gescrold. Op touch is dit het
        // normale pad: daar is er geen hover, wel focus.
        onClick={() => {
          verberg();
          onClick();
        }}
        aria-describedby={previewId}
        aria-label={`Bron ${nummer}: ${bron.titel}${
          oordeel.label ? ` (${oordeel.label})` : ""
        } — toon bronvermelding`}
        className={`relative -top-[1px] inline-flex items-center align-baseline mx-0.5 h-[20px] gap-1.5 rounded-full border py-0 pl-[3px] pr-2 text-[11px] font-bold leading-none transition-colors cursor-pointer ${
          // Geen actuele, vastgestelde grondslag → gestippelde rand. Kleur is nooit
          // de enige drager: dezelfde status staat als tekst in de beschrijving.
          oordeel.gemarkeerd ? "border-dashed border-warn" : "border-warn/40"
        } ${
          gehighlight
            ? "bg-warn/25 text-warn-ink shadow-sm"
            : "bg-warn-tint text-warn-ink hover:bg-warn/20"
        }`}
      >
        <span
          aria-hidden="true"
          className="grid h-[15px] w-[15px] flex-none place-items-center rounded-full bg-warn text-[9px] text-white"
        >
          {nummer}
        </span>
        {/* Het afgeleide label maakt van "[3]" een leesbare bronvermelding. Het
            nummer blijft staan: dát koppelt de bewering aan de bronkaart en aan
            het auditspoor. Ontbreken titel én documenttype, dan blijft het label
            leeg en toont de pill alleen het nummer — zoals voorheen. */}
        {label && (
          <span className="max-w-[160px] truncate font-semibold">{label}</span>
        )}
      </button>
      {/* De beschrijving staat er ALTIJD, ook dicht. Zou `aria-describedby` pas
          bij het openen worden gezet, dan heeft de schermlezer de focusmelding al
          samengesteld en valt juist het citaat — de kern van deze tranche — weg.
          De zichtbare preview is daarom puur visueel (aria-hidden). */}
      <span id={previewId} className="sr-only">
        {beschrijvingVoorSchermlezer(bron, oordeel)}
      </span>
      {open && <BronPreview bron={bron} oordeel={oordeel} positie={positie} />}
    </span>
  );
}

/** Wat een schermlezer bij de pill voorleest: dezelfde inhoud als de preview. */
function beschrijvingVoorSchermlezer(bron: Bron, oordeel: Statusoordeel): string {
  const delen = [
    bron.titel,
    vindplaatsVan(bron),
    bron.documentdatum ?? "",
    oordeel.label ?? GEEN_STATUS_MELDING,
    ...oordeel.bijzonderheden,
    heeftFragment(bron) ? `Citaat: ${bron.fragment}` : GEEN_FRAGMENT_MELDING,
  ];
  return delen.filter(Boolean).join(". ");
}

function BronPreview({
  bron,
  oordeel,
  positie,
}: {
  bron: Bron;
  oordeel: Statusoordeel;
  positie: PreviewPositie;
}) {
  const openen = openenActieVan(bron);
  const regel = [
    vindplaatsVan(bron),
    bron.documentdatum,
    oordeel.label ?? GEEN_STATUS_MELDING,
    ...oordeel.bijzonderheden,
    bron.bron,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <span
      // Bewust GEEN role="tooltip": die rol mag geen interactieve inhoud bevatten
      // en er staat een link in. In plaats daarvan: de tékst is aria-hidden (die
      // staat al in de sr-only-beschrijving bij de pill, dus zou dubbel klinken),
      // en de LINK blijft gewoon bereikbaar — pill → openen-link in de tabvolgorde.
      style={{
        position: "fixed",
        left: positie.left,
        top: positie.top,
        bottom: positie.bottom,
        width: Math.min(PREVIEW_BREEDTE, 1000),
        maxWidth: "calc(100vw - 16px)",
        maxHeight: "calc(100vh - 16px)",
      }}
      className="z-50 block overflow-y-auto rounded-lg border border-app-line-strong bg-app-surface p-3 text-left text-xs font-normal leading-relaxed text-ink shadow-card-hover"
    >
      <span aria-hidden="true">
        <span className="block font-bold">{bron.titel}</span>
        <span className="mt-0.5 block text-[11px] text-muted">{regel}</span>
        {heeftFragment(bron) ? (
          <span className="mt-2 block border-l-2 border-app-line-strong pl-2.5 italic text-muted">
            „{bron.fragment}&rdquo;
          </span>
        ) : (
          <span className="mt-2 block text-muted">{GEEN_FRAGMENT_MELDING}</span>
        )}
      </span>
      {openen ? (
        <a
          href={openen.href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block text-[11px] font-bold text-accent-ink hover:underline"
        >
          {openen.label} →
        </a>
      ) : (
        <span aria-hidden="true" className="mt-2 block text-[11px] italic text-muted">
          Origineel niet beschikbaar — alleen tekst voor de AI-assistent
        </span>
      )}
    </span>
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

// ============================================================
//  Bronkaart
// ============================================================
// De kaart is NEUTRAAL (witte kaart, kleurloze rand): met twee kaarten naast
// elkaar maakte een gekleurd vlak per bronorganisatie het blok onrustig, terwijl
// die kleur al in het nummerbolletje zit. Het fragment krijgt een citaatbalk en
// het losse `↗` is een benoemde actie geworden ("Openen op pagina 14").
//
// De kaart zelf is bewust géén <a> meer. Dat gaf twee problemen: de openen-actie
// had geen naam (alleen een pijltje), en `BronkaartMeta` rendert bij generieke
// bronnen een "Externe bron ↗"-link — een <a> genest in een <a>, wat ongeldige
// HTML is en in schermlezers onvoorspelbaar navigeert. Het anker voor
// scroll+highlight (`idVoorScroll`) blijft ongewijzigd op de buitenste kaart.
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
  const vindplaats = vindplaatsVan(bron);
  const openen = openenActieVan(bron);

  return (
    <div
      id={idVoorScroll}
      className={`scroll-mt-24 rounded-xl border bg-app-surface p-3 text-xs transition-all ${
        gehighlight
          ? "border-accent ring-2 ring-accent ring-offset-1 shadow-card-hover"
          : "border-line shadow-card"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={`flex-shrink-0 w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center ${
            BRON_NUMMER_KLEUR[bron.bron] || "bg-app-line text-white"
          }`}
        >
          {idx + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-snug text-ink break-words">
            {bron.titel}
          </div>
          <div className="mt-0.5 text-[11px] text-muted">
            {[bron.bron, vindplaats].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>

      {heeftFragment(bron) ? (
        <div className="mt-2 rounded-r-md border-l-2 border-app-line-strong bg-app-zebra px-2.5 py-1.5 leading-relaxed text-ink">
          „{bron.fragment}&rdquo;
        </div>
      ) : (
        <div className="mt-2 italic text-muted">{GEEN_FRAGMENT_MELDING}</div>
      )}

      <BronkaartMeta bron={bron} />

      {openen ? (
        <a
          href={openen.href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-[11px] font-bold text-accent-ink hover:underline"
        >
          {openen.label} →
        </a>
      ) : (
        <div className="mt-2 text-[11px] italic text-muted">
          Origineel niet beschikbaar — alleen tekst voor de AI-assistent
        </div>
      )}
    </div>
  );
}

// ============================================================================
//  Lichte bronweergave tijdens reflectie (B-opt tranche 2f, ANTWOORDPAD §4)
// ----------------------------------------------------------------------------
//  Een reflectiebeurt is visueel lichter dan een regulier antwoord: geen volle
//  bronbalk en geen onderbouwingspaneel. Bevat de beurt wél een dossieruitspraak
//  ([Bron N]), dan één gedempte regel die uitklapt naar de bestaande bronkaarten.
//
//  ⚠ UITSLUITEND WEERGAVE. De beurt wordt onveranderd gelogd als gewone
//  chatbeurt, met dezelfde bronvermeldingen, zónder enige markering dat het
//  reflectie betrof (besluit 0112). Deze component raakt geen enkel logpad; wie
//  hier "de logging meeneemt", raakt het auditspoor. Gedeeld door /ai én de
//  agendapuntchat (besluit 0079).
// ============================================================================

export function LichteReflectieBron({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mt-2">
      <div className="text-xs text-muted flex items-center gap-2 flex-wrap">
        <span>Zelfde bronbasis als het eerdere antwoord</span>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={onToggle}
          className="text-muted hover:text-ink underline-offset-2 hover:underline"
        >
          {open ? "Bronnen verbergen" : "Bronnen bekijken"}
        </button>
      </div>
      {open && <div className="mt-2 flex flex-col gap-2">{children}</div>}
    </div>
  );
}

// ============================================================================
//  Documentlijst bij antwoordmodus `bronoverzicht` (besluit 0099)
// ============================================================================
// Bij "welke stukken hebben we over X?" ZIJN de documenten het antwoord. Ze
// stonden tot nu toe ingeklapt onder een alinea die de titels in proza herhaalde.
// Deze lijst promoveert ze naar het antwoord zelf.
//
// Drie dingen die deze component NIET doet, en dat is opzet:
//  - hij bepaalt geen antwoordmodus; die wordt gelezen uit de meta van het
//    bericht (`onderbouwing.antwoordmodus`) en is server-side vastgesteld;
//  - hij haalt niets op. De filterchips werken op de al aangeleverde bronnen —
//    geen fetch, geen nieuwe retrieval, geen wijziging aan de filtering vóór
//    retrieval. Wat je wegfiltert telt nog steeds mee in "n van m";
//  - hij zet geen scope door naar de server. "Vraag hierover" vult de bestaande
//    client-scope en zet de cursor in het invoerveld; de gebruiker formuleert
//    zelf de vraag en de server-side validatie blijft onverkort leidend.

// P1a — `leesAntwoordmodus` woont sinds de laagsplitsing in
// `core/lib/vraagtype.ts`, naast `ANTWOORDMODI` waar de modusnamen zelf staan.
// De toelichting is met de functie meeverhuisd. Hier ongewijzigd doorgegeven,
// zodat de importregel van elke bestaande consument blijft werken.
export { leesAntwoordmodus } from "@/core/lib/vraagtype";

/** Bestandstype-badge. Ontbreekt het type, dan verschijnt er niets — geen lege badge. */
function BestandstypeBadge({ type }: { type?: string | null }) {
  if (!type || !type.trim()) return null;
  return (
    <span className="flex-shrink-0 rounded border border-line bg-app-zebra px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
      {type.trim()}
    </span>
  );
}

export function Documentenlijst({
  bronnen,
  onScope,
  ankerIdVoorBron,
  gehighlightBronIdx,
}: {
  bronnen: Bron[] | undefined;
  /**
   * Zet de document-scope voor de volgende vraag. Weglaten = geen
   * scope-vervolgacties; de agendapuntchat doet dat, want daar ís de scope al
   * vast (de aan het agendapunt gekoppelde stukken).
   */
  onScope?: (documentIds: string[], titels: string[]) => void;
  /**
   * Bouwt het scroll-anker voor bronindex `j` (0-gebaseerd) — dezelfde id die de
   * caller anders op de bronkaart in het paneel zet. Zonder dit zou een klik op
   * een `[Bron N]`-pill in deze modus nergens landen: de bronkaarten staan hier
   * niet meer, dus hun ankers bestaan niet.
   */
  ankerIdVoorBron?: (bronIdx: number) => string;
  /** Bronindex die kort oplicht na een klik op een pill. */
  gehighlightBronIdx?: number | null;
}) {
  const [filter, setFilter] = useState<Documentfilter>("alle");
  // Bij een ander antwoord (of een herladen gesprek) hoort de filterkeuze niet
  // mee te reizen: de berichten worden op index gerenderd, dus zonder deze reset
  // blijft "Alleen vastgesteld" plakken op het bericht dat toevallig dezelfde
  // plek krijgt.
  useEffect(() => setFilter("alle"), [bronnen]);

  const alleGroepen = groepeerDocumentbronnen(bronnen ?? []);
  const { groepen, zichtbaar, totaal, zonderStatus } = pasFilterToe(alleGroepen, filter);
  if (totaal === 0) return null;

  const zichtbareIds = documentIdsVan(groepen);
  const zichtbareTitels = groepen.flatMap((g) => g.documenten.map((d) => d.titel));

  return (
    <section className="mt-3" aria-label="Gevonden documenten">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted">
          Gevonden documenten
        </span>
        <span className="text-[11px] text-muted">
          {zichtbaar} van {totaal} zichtbaar
          {filter === "vastgesteld" && zonderStatus > 0
            ? ` · ${zonderStatus} zonder status`
            : ""}
        </span>
        <div className="flex gap-1.5" role="group" aria-label="Filter op status">
          <FilterChip
            actief={filter === "alle"}
            onClick={() => setFilter("alle")}
            label="Alle"
          />
          <FilterChip
            actief={filter === "vastgesteld"}
            onClick={() => setFilter("vastgesteld")}
            label="Alleen vastgesteld"
          />
        </div>
      </div>
      {/* Geen schijnzekerheid: dit is de opgehaalde set bij déze vraag, niet de
          inventaris van de bibliotheek. */}
      <p className="mb-2 text-[11px] italic text-muted">
        De stukken die bij deze vraag zijn opgehaald — geen uitputtend overzicht van
        de bibliotheek.
      </p>

      {groepen.length === 0 ? (
        <p className="text-xs text-muted">
          Geen van de gevonden stukken is aantoonbaar vastgesteld of van kracht
          {zonderStatus > 0
            ? ` (van ${zonderStatus} is de status niet meegeleverd)`
            : ""}
          . Zet het filter op &ldquo;Alle&rdquo; om ze toch te zien.
        </p>
      ) : (
        <div className="space-y-3">
          {groepen.map((groep) => (
            <div key={groep.sleutel}>
              <div className="mb-1.5 text-[11px] font-semibold text-muted">
                {groep.label}{" "}
                <span className="font-normal">({groep.documenten.length})</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2 items-start">
                {groep.documenten.map((doc) => (
                  <Documentkaart
                    key={doc.document_id}
                    doc={doc}
                    ankerIdVoorBron={ankerIdVoorBron}
                    gehighlight={
                      typeof gehighlightBronIdx === "number" &&
                      doc.bronnummers.includes(gehighlightBronIdx + 1)
                    }
                    onScope={
                      onScope ? () => onScope([doc.document_id], [doc.titel]) : undefined
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {onScope && zichtbareIds.length > 1 && (
        <button
          type="button"
          onClick={() => onScope(zichtbareIds, zichtbareTitels)}
          className="mt-3 rounded-full border border-app-line-control px-3 py-1.5 text-xs text-ink transition-colors hover:border-accent hover:bg-warn-tint"
        >
          Vraag over deze {zichtbareIds.length} documenten
        </button>
      )}
    </section>
  );
}

function FilterChip({
  actief,
  onClick,
  label,
}: {
  actief: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actief}
      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
        actief
          ? "border-accent bg-accent-tint text-accent-ink"
          : "border-app-line-control text-muted hover:border-accent hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function Documentkaart({
  doc,
  onScope,
  ankerIdVoorBron,
  gehighlight,
}: {
  doc: Documentregel;
  onScope?: () => void;
  ankerIdVoorBron?: (bronIdx: number) => string;
  gehighlight?: boolean;
}) {
  const bron = doc as Bron;
  const openen = openenActieVan(bron);
  const typeLabel = documenttypeLabel(doc);
  const vindplaats = vindplaatsVan(bron);
  const chip =
    "rounded border border-line bg-app-zebra px-1.5 py-0.5 text-[10px] text-muted";

  return (
    <div
      className={`rounded-xl border bg-app-surface p-3 text-xs transition-all ${
        gehighlight
          ? "border-accent ring-2 ring-accent ring-offset-1 shadow-card-hover"
          : "border-line shadow-card"
      }`}
    >
      {/* Scroll-ankers: één per bronvermelding die naar dit document wijst. Na
          ontdubbeling wijzen meerdere `[Bron N]`-pills naar dezelfde kaart, en
          zonder deze ankers zou een klik op zo'n pill nergens landen — de
          bronkaarten uit het paneel staan er in deze modus immers niet. */}
      {ankerIdVoorBron &&
        doc.bronnummers.map((n) => (
          <span key={n} id={ankerIdVoorBron(n - 1)} className="block scroll-mt-24" />
        ))}

      <div className="flex items-start gap-2">
        <BestandstypeBadge type={doc.bestandstype} />
        <span className="min-w-0 flex-1 font-semibold leading-snug text-ink break-words">
          {doc.titel}
        </span>
      </div>

      <div className="mt-0.5 text-[11px] text-muted">
        {doc.bron}
        {doc.bronnummers.length > 1
          ? ` · ${doc.bronnummers.length} passages`
          : ""}
      </div>

      {/* Ontbrekende waarden leveren géén lege chip — het element blijft weg. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {typeLabel && <span className={chip}>{typeLabel}</span>}
      </div>
      {/* Dezelfde metadatastrip als de bronkaart: status, bronstatus, datum,
          bronsoort, normgewicht, bronorganisatie, "Vervallen per" én de
          "Externe bron ↗"-link. Die laatste is voor een generiek kader zonder
          lokaal origineel het énige pad naar het stuk; in deze modus staan de
          bronkaarten niet meer in het paneel, dus zonder hergebruik zou dat pad
          verdwijnen. */}
      <BronkaartMeta bron={bron} />

      {heeftFragment(bron) ? (
        <div className="mt-2 rounded-r-md border-l-2 border-app-line-strong bg-app-zebra px-2.5 py-1.5 leading-relaxed text-ink">
          „{doc.fragment}&rdquo;
          {vindplaats && (
            <span className="mt-1 block text-[11px] not-italic text-muted">{vindplaats}</span>
          )}
        </div>
      ) : (
        <div className="mt-2 italic text-muted">{GEEN_FRAGMENT_MELDING}</div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {openen ? (
          <a
            href={openen.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-bold text-accent-ink hover:underline"
          >
            {openen.label} →
          </a>
        ) : (
          <span className="text-[11px] italic text-muted">
            Origineel niet beschikbaar — alleen tekst voor de AI-assistent
          </span>
        )}
        {onScope && (
          <button
            type="button"
            onClick={onScope}
            className="text-[11px] font-bold text-accent-ink hover:underline"
          >
            Vraag hierover →
          </button>
        )}
      </div>
    </div>
  );
}

// Increment G — bronkaart-metadatastrip: status/bronstatus/datum + (bij generiek)
// bronsoort/normgewicht/externe URL/"Vervallen per". Alles optioneel: ontbrekende
// velden (bv. uit het fallback-pad) worden simpelweg niet getoond.
function BronkaartMeta({ bron }: { bron: Bron }) {
  // Zelfde oordeel als de pill, zodat kaart en pill nooit iets anders beweren —
  // inclusief de juiste labelset voor een besluitregistratiebron.
  const statusLabel = statusOordeel(bron).label;
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

  // Zebra i.p.v. wit-op-wit: de bronkaart is sinds deze tranche zelf wit.
  const chip =
    "text-[10px] px-1.5 py-0.5 rounded border bg-app-zebra border-line text-muted";
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2">
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
          className="text-[10px] px-1.5 py-0.5 rounded border bg-app-zebra border-line text-accent-ink hover:underline"
        >
          Externe bron ↗
        </a>
      )}
    </div>
  );
}
