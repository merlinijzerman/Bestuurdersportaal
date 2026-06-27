// ============================================================================
//  lib/generiek-curatie.ts — Increment P1/B14 (platform back-office).
// ----------------------------------------------------------------------------
//  Pure logica voor het CUREREN van generieke (sectorbrede, fonds-overstijgende)
//  documenten: metadata-defaults (§8.1), veld- en bronhygiene-validatie, en de
//  RAG-zichtbaarheidsregel (§8.3 #6, herzien 2026-06-26: alleen 'onbekend'/NULL
//  is nog zwak; 'informatief' wordt nu wél standaard getoond). Geen DB/IO → los testbaar
//  (generiek-curatie.sanity.ts). De server-actions (app/(platform)/…/acties.ts)
//  consumeren `valideerCuratie` en schrijven het genormaliseerde resultaat weg.
//
//  Bron-van-waarheid voor de RAG-zichtbaarheid is `isStandaardZichtbaarInRag`:
//  lib/rag.ts (default-uitsluiting) én de platform-UI (zichtbaarheidslabel)
//  gebruiken DEZELFDE functie, zodat label en gedrag niet uiteenlopen.
//
//  Normgewicht/URL-helpers komen uit lib/bronsoort.ts (niet dupliceren).
// ============================================================================

import {
  isGeldigNormgewicht,
  isVeiligeUrl,
  type Normgewicht,
} from "./bronsoort";

// ── Regelingstype (FO §8.1, spiegelt documenten_regelingstype_check) ────────
export const REGELINGSTYPES = ["FTK", "SPR", "FPR", "CVP", "algemeen"] as const;
export type Regelingstype = (typeof REGELINGSTYPES)[number];

export const REGELINGSTYPE_LABEL: Record<Regelingstype, string> = {
  FTK: "FTK (financieel toetsingskader)",
  SPR: "Solidaire premieregeling",
  FPR: "Flexibele premieregeling",
  CVP: "Collectief variabel pensioen",
  algemeen: "Algemeen / regelingsneutraal",
};

export function isGeldigRegelingstype(w: unknown): w is Regelingstype {
  return typeof w === "string" && (REGELINGSTYPES as readonly string[]).includes(w);
}

// ── Status-/bronstatus-subset dat via curatie zelf gezet mag worden ─────────
// Laag 2 (status) en laag 3 (bronstatus) kennen meer waarden; voor generieke
// curatie zijn alleen deze zinvol. Vervangen/alleen_historisch lopen via de
// REPLACE-actie (statustransitie), niet via vrije metadata-edit.
export const GENERIEKE_DOCUMENTSTATUS = [
  "van_kracht",
  "alleen_historisch",
  "gearchiveerd",
] as const;
export type GeneriekeDocumentstatus = (typeof GENERIEKE_DOCUMENTSTATUS)[number];

export const GENERIEKE_BRONSTATUS = ["actief", "historisch", "uitgesloten"] as const;
export type GeneriekeBronstatus = (typeof GENERIEKE_BRONSTATUS)[number];

// ── Categorische bron (documenten.bron, NOT NULL + CHECK) ───────────────────
export const GENERIEKE_BRONNEN = [
  "DNB",
  "AFM",
  "Pensioenfederatie",
  "Extern",
] as const;
export type GeneriekeBron = (typeof GENERIEKE_BRONNEN)[number];

// ── Defaults (§8.1): wat een nieuw generiek document krijgt als de curator
//    niets anders kiest. fonds_id NULL = sectorbreed; bibliotheek 'generiek'. ──
export const GENERIEK_DEFAULTS = {
  bibliotheek: "generiek",
  context: "algemeen",
  fonds_id: null,
  bron: "Extern",
  status: "van_kracht",
  bronstatus: "actief",
  normgewicht: "onbekend",
  regelingstype: "algemeen",
} as const;

// ── RAG-zichtbaarheid (§8.3 #6, herzien 2026-06-26) ─────────────────────────
// Alleen een generiek document met normgewicht 'onbekend' wordt NIET standaard
// in RAG getoond — alleen als de gebruiker er expliciet om vraagt. NULL/ongeldig
// telt als 'onbekend' (zwak). 'informatief' is bewust GEEN zwak gewicht meer:
// informatieve generieke bronnen worden voortaan wél standaard meegenomen
// (besluit Merlin IJzerman). Dit is de gedeelde bron-van-waarheid.
export const ZWAK_NORMGEWICHT: Normgewicht[] = ["onbekend"];

export function isStandaardZichtbaarInRag(
  normgewicht: string | null | undefined
): boolean {
  const ng: Normgewicht =
    normgewicht && isGeldigNormgewicht(normgewicht) ? normgewicht : "onbekend";
  return !ZWAK_NORMGEWICHT.includes(ng);
}

// ── Validatie + normalisatie ────────────────────────────────────────────────
export interface CuratieInvoer {
  titel?: string | null;
  bron?: string | null;
  bronorganisatie?: string | null;
  extern_url?: string | null;
  normgewicht?: string | null;
  documentdatum?: string | null;
  geldig_vanaf?: string | null;
  geldig_tot?: string | null;
  documentstatus?: string | null;
  bronstatus?: string | null;
  toepassingsgebied?: string | null;
  regelingstype?: string | null;
  doelgroep?: string | null;
  thema?: string | null;
  statusinterpretatie?: string | null;
}

// Het genormaliseerde, DB-klare resultaat. Kolomnamen = documenten-kolommen,
// zodat de server-action dit direct in een insert/update kan spreaden.
export interface CuratieGenormaliseerd {
  titel: string;
  bron: GeneriekeBron;
  bibliotheek: "generiek";
  context: "algemeen";
  fonds_id: null;
  bronorganisatie: string | null;
  extern_url: string | null;
  normgewicht: Normgewicht;
  documentdatum: string | null;
  geldig_vanaf: string | null;
  geldig_tot: string | null;
  status: GeneriekeDocumentstatus;
  bronstatus: GeneriekeBronstatus;
  toepassingsgebied: string | null;
  regelingstype: Regelingstype;
  doelgroep: string | null;
  thema: string | null;
  statusinterpretatie: string | null;
}

export type CuratieValidatie =
  | { ok: true; waarde: CuratieGenormaliseerd }
  | { ok: false; fouten: Record<string, string> };

const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;

function isGeldigeDatum(s: string): boolean {
  if (!ISO_DATUM.test(s)) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function trimNaarNull(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

export function valideerCuratie(invoer: CuratieInvoer): CuratieValidatie {
  const fouten: Record<string, string> = {};

  // titel — verplicht.
  const titel = trimNaarNull(invoer.titel);
  if (!titel) fouten.titel = "Titel is verplicht.";

  // bron — categorisch, default 'Extern'.
  const bronRaw = trimNaarNull(invoer.bron) ?? GENERIEK_DEFAULTS.bron;
  if (!(GENERIEKE_BRONNEN as readonly string[]).includes(bronRaw)) {
    fouten.bron = `Bron moet één van ${GENERIEKE_BRONNEN.join(", ")} zijn.`;
  }

  // normgewicht — enum, default 'onbekend'.
  const normgewichtRaw = trimNaarNull(invoer.normgewicht) ?? GENERIEK_DEFAULTS.normgewicht;
  if (!isGeldigNormgewicht(normgewichtRaw)) {
    fouten.normgewicht = "Ongeldig normgewicht.";
  }

  // regelingstype — enum, default 'algemeen'.
  const regelingstypeRaw =
    trimNaarNull(invoer.regelingstype) ?? GENERIEK_DEFAULTS.regelingstype;
  if (!isGeldigRegelingstype(regelingstypeRaw)) {
    fouten.regelingstype = "Ongeldig regelingstype.";
  }

  // status — subset, default 'van_kracht'.
  const statusRaw = trimNaarNull(invoer.documentstatus) ?? GENERIEK_DEFAULTS.status;
  if (!(GENERIEKE_DOCUMENTSTATUS as readonly string[]).includes(statusRaw)) {
    fouten.documentstatus = "Ongeldige documentstatus.";
  }

  // bronstatus — subset, default 'actief'.
  const bronstatusRaw = trimNaarNull(invoer.bronstatus) ?? GENERIEK_DEFAULTS.bronstatus;
  if (!(GENERIEKE_BRONSTATUS as readonly string[]).includes(bronstatusRaw)) {
    fouten.bronstatus = "Ongeldige bronstatus.";
  }

  // extern_url — bronhygiene: leeg mag, maar als gevuld dan veilig http(s).
  const externUrl = trimNaarNull(invoer.extern_url);
  if (externUrl !== null && !isVeiligeUrl(externUrl)) {
    fouten.extern_url = "Externe URL moet een geldige http(s)-link zijn.";
  }

  // datums — formaat + onderlinge ordening.
  const documentdatum = trimNaarNull(invoer.documentdatum);
  const geldigVanaf = trimNaarNull(invoer.geldig_vanaf);
  const geldigTot = trimNaarNull(invoer.geldig_tot);
  for (const [veld, waarde] of [
    ["documentdatum", documentdatum],
    ["geldig_vanaf", geldigVanaf],
    ["geldig_tot", geldigTot],
  ] as const) {
    if (waarde !== null && !isGeldigeDatum(waarde)) {
      fouten[veld] = "Datum moet het formaat JJJJ-MM-DD hebben.";
    }
  }
  if (
    geldigVanaf !== null &&
    geldigTot !== null &&
    !fouten.geldig_vanaf &&
    !fouten.geldig_tot &&
    geldigVanaf > geldigTot
  ) {
    fouten.geldig_tot = "‘Geldig tot’ mag niet vóór ‘geldig vanaf’ liggen.";
  }

  if (Object.keys(fouten).length > 0) return { ok: false, fouten };

  return {
    ok: true,
    waarde: {
      titel: titel as string,
      bron: bronRaw as GeneriekeBron,
      bibliotheek: "generiek",
      context: "algemeen",
      fonds_id: null,
      bronorganisatie: trimNaarNull(invoer.bronorganisatie),
      extern_url: externUrl,
      normgewicht: normgewichtRaw as Normgewicht,
      documentdatum,
      geldig_vanaf: geldigVanaf,
      geldig_tot: geldigTot,
      status: statusRaw as GeneriekeDocumentstatus,
      bronstatus: bronstatusRaw as GeneriekeBronstatus,
      toepassingsgebied: trimNaarNull(invoer.toepassingsgebied),
      regelingstype: regelingstypeRaw as Regelingstype,
      doelgroep: trimNaarNull(invoer.doelgroep),
      thema: trimNaarNull(invoer.thema),
      statusinterpretatie: trimNaarNull(invoer.statusinterpretatie),
    },
  };
}
