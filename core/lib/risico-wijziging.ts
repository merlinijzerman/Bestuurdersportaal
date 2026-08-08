// ============================================================================
//  core/lib/risico-wijziging.ts — besluit 0141
// ----------------------------------------------------------------------------
//  Het wijzigen van een bestaand risico. Puur (geen I/O), gedeeld door de PATCH-
//  route en de bewerkmodal, getest in risico-wijziging.sanity.ts.
//
//  WAAROM EEN REDENPLICHT OP MAAR DRIE VELDEN
//  ------------------------------------------
//  `kans`, `impact` en `niveau` bepalen samen de plek in de heatmap en daarmee
//  de bestuurlijke prioritering: een risico van "hoog" naar "middel" schuiven
//  verandert wat het bestuur als aandachtspunt ziet. Zo'n verschuiving zonder
//  motivering is achteraf niet te reconstrueren — en juist bij een risicomatrix
//  is de vraag "waarom stond dit vorig kwartaal nog op hoog?" de kern.
//
//  Een titel of toelichting corrigeren is dat niet. Daar een motivering
//  afdwingen levert alleen maar lege redenen op ("typo"), wat het auditspoor
//  eerder vervuilt dan verrijkt.
//
//  Dit spiegelt GOVERNANCE_KRITIEKE_VELDEN in document-metadata.ts: dezelfde
//  gedachte, andere entiteit.
//
//  NIVEAU: AFGELEID TENZIJ HANDMATIG
//  ---------------------------------
//  `niveau` volgt normaal uit kans + impact (leidNiveauAf). Alleen met
//  `niveau_handmatig` mag een bestuur er bewust van afwijken. De route mag die
//  afleiding daarom niet aan de client overlaten — hier gebeurt het één keer.
// ============================================================================

import {
  leidNiveauAf,
  CATEGORIEEN,
  type CategorieSlug,
  type NiveauSlug,
  type TypeRisicoSlug,
} from "./risico-config";

/** De velden die via PATCH bewerkbaar zijn. `status` staat er bewust NIET bij:
 *  sluiten loopt via de eigen route met eigen motiveringsplicht. */
export type RisicoVeld =
  | "titel"
  | "toelichting"
  | "categorie"
  | "kans"
  | "impact"
  | "niveau"
  | "niveau_handmatig"
  | "type_risico"
  | "eigenaar_naam"
  | "volgende_beoordeling";

/**
 * De weegvelden: wijziging vereist een motivering.
 *
 * `niveau_handmatig` hoort erbij omdat het aan- of uitzetten daarvan het niveau
 * loskoppelt van kans × impact — dat is dezelfde bestuurlijke ingreep als het
 * niveau zelf verzetten, alleen indirect.
 */
export const WEEGVELDEN: RisicoVeld[] = ["kans", "impact", "niveau", "niveau_handmatig"];

export function isWeegveld(veld: RisicoVeld): boolean {
  return WEEGVELDEN.includes(veld);
}

export const RISICO_VELD_LABEL: Record<RisicoVeld, string> = {
  titel: "Titel",
  toelichting: "Toelichting",
  categorie: "Categorie",
  kans: "Kans",
  impact: "Impact",
  niveau: "Risiconiveau",
  niveau_handmatig: "Niveau handmatig gezet",
  type_risico: "Type",
  eigenaar_naam: "Eigenaar",
  volgende_beoordeling: "Volgende beoordeling",
};

/** De huidige waarden van een risico, voor zover deze module ze nodig heeft. */
export interface RisicoHuidig {
  titel: string;
  toelichting: string | null;
  categorie: string;
  kans: number;
  impact: number;
  niveau: string;
  niveau_handmatig: boolean;
  type_risico: string;
  eigenaar_naam: string | null;
  volgende_beoordeling: string | null;
}

/** De (deel)waarden die de client aanlevert. Afwezig = niet wijzigen. */
export interface RisicoInvoer {
  titel?: string;
  toelichting?: string | null;
  categorie?: string;
  kans?: number;
  impact?: number;
  niveau?: string;
  niveau_handmatig?: boolean;
  type_risico?: string;
  eigenaar_naam?: string | null;
  volgende_beoordeling?: string | null;
  reden?: string;
}

export type WijzigingUitkomst =
  | {
      ok: true;
      /** Kolom → nieuwe waarde, klaar voor de UPDATE. Leeg = niets te doen. */
      update: Record<string, unknown>;
      /** Per gewijzigd veld de oude en nieuwe waarde, voor het auditlog. */
      diff: Record<string, { oud: unknown; nieuw: unknown }>;
      gewijzigdeVelden: RisicoVeld[];
      /** Was er een weegveld bij? Dan draagt de logregel dat kenmerk. */
      raaktWeging: boolean;
      reden: string | null;
    }
  | { ok: false; foutcode: string; melding: string };

const TOEGESTANE_CATEGORIEEN = CATEGORIEEN.map((c) => c.slug) as string[];
const TOEGESTANE_NIVEAUS = ["laag", "middel", "hoog"];
const TOEGESTANE_TYPES = ["structureel", "tijdelijk"];
/** ISO-datum zonder tijd, zoals `volgende_beoordeling` in de DB staat. */
const DATUM_PATROON = /^\d{4}-\d{2}-\d{2}$/;

function leeg(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

/**
 * Bouwt de update + diff voor een risicowijziging, of weigert met een reden.
 *
 * Validatie zit hier en niet in de route, zodat de sanity-suite hem kan naslaan
 * en de bewerkmodal dezelfde regels kan tonen vóórdat er een verzoek uitgaat
 * (UX-principe "maak vereisten en blokkers expliciet").
 */
export function bouwRisicoWijziging(
  huidig: RisicoHuidig,
  invoer: RisicoInvoer
): WijzigingUitkomst {
  const update: Record<string, unknown> = {};
  const diff: Record<string, { oud: unknown; nieuw: unknown }> = {};
  const gewijzigdeVelden: RisicoVeld[] = [];

  const zet = (veld: RisicoVeld, oud: unknown, nieuw: unknown) => {
    if (oud === nieuw) return;
    update[veld] = nieuw;
    diff[veld] = { oud, nieuw };
    gewijzigdeVelden.push(veld);
  };

  // ── Tekstvelden ───────────────────────────────────────────────────────────
  if (invoer.titel !== undefined) {
    const titel = invoer.titel.trim();
    if (!titel) {
      return { ok: false, foutcode: "titel_leeg", melding: "Titel mag niet leeg zijn." };
    }
    zet("titel", huidig.titel, titel);
  }
  if (invoer.toelichting !== undefined) {
    zet("toelichting", huidig.toelichting, leeg(invoer.toelichting));
  }
  if (invoer.eigenaar_naam !== undefined) {
    zet("eigenaar_naam", huidig.eigenaar_naam, leeg(invoer.eigenaar_naam));
  }

  // ── Enums ─────────────────────────────────────────────────────────────────
  if (invoer.categorie !== undefined) {
    if (!TOEGESTANE_CATEGORIEEN.includes(invoer.categorie)) {
      return { ok: false, foutcode: "categorie_ongeldig", melding: "Ongeldige categorie." };
    }
    zet("categorie", huidig.categorie, invoer.categorie);
  }
  if (invoer.type_risico !== undefined) {
    if (!TOEGESTANE_TYPES.includes(invoer.type_risico)) {
      return { ok: false, foutcode: "type_ongeldig", melding: "Ongeldig type risico." };
    }
    zet("type_risico", huidig.type_risico, invoer.type_risico);
  }

  // ── Datum ─────────────────────────────────────────────────────────────────
  if (invoer.volgende_beoordeling !== undefined) {
    const datum = leeg(invoer.volgende_beoordeling);
    if (datum !== null && !DATUM_PATROON.test(datum)) {
      return {
        ok: false,
        foutcode: "datum_ongeldig",
        melding: "Volgende beoordeling moet een datum zijn (JJJJ-MM-DD).",
      };
    }
    zet("volgende_beoordeling", huidig.volgende_beoordeling, datum);
  }

  // ── Weging ────────────────────────────────────────────────────────────────
  const kans = invoer.kans === undefined ? huidig.kans : Number(invoer.kans);
  const impact = invoer.impact === undefined ? huidig.impact : Number(invoer.impact);
  for (const [naam, waarde] of [
    ["kans", kans],
    ["impact", impact],
  ] as const) {
    if (!Number.isInteger(waarde) || waarde < 1 || waarde > 5) {
      return {
        ok: false,
        foutcode: `${naam}_ongeldig`,
        melding: `${naam === "kans" ? "Kans" : "Impact"} moet een geheel getal 1 t/m 5 zijn.`,
      };
    }
  }
  zet("kans", huidig.kans, kans);
  zet("impact", huidig.impact, impact);

  const handmatig =
    invoer.niveau_handmatig === undefined ? huidig.niveau_handmatig : !!invoer.niveau_handmatig;
  zet("niveau_handmatig", huidig.niveau_handmatig, handmatig);

  // Niveau wordt hier afgeleid — nooit blind van de client overgenomen. Alleen
  // met `niveau_handmatig` telt een aangeleverde waarde mee.
  let niveau: NiveauSlug;
  if (handmatig) {
    const gevraagd = invoer.niveau ?? huidig.niveau;
    if (!TOEGESTANE_NIVEAUS.includes(gevraagd)) {
      return { ok: false, foutcode: "niveau_ongeldig", melding: "Ongeldig risiconiveau." };
    }
    niveau = gevraagd as NiveauSlug;
  } else {
    niveau = leidNiveauAf(kans, impact);
  }
  zet("niveau", huidig.niveau, niveau);

  // ── Uitkomst ──────────────────────────────────────────────────────────────
  if (gewijzigdeVelden.length === 0) {
    return { ok: false, foutcode: "geen_wijziging", melding: "Er is niets gewijzigd." };
  }

  const raaktWeging = gewijzigdeVelden.some(isWeegveld);
  const reden = leeg(invoer.reden);
  if (raaktWeging && !reden) {
    const geraakt = gewijzigdeVelden
      .filter(isWeegveld)
      .map((v) => RISICO_VELD_LABEL[v].toLowerCase());
    return {
      ok: false,
      foutcode: "reden_verplicht",
      melding:
        `Geef een motivering: u wijzigt ${geraakt.join(" en ")}. ` +
        "Dat verandert de plek in de heatmap en dus de bestuurlijke prioritering; " +
        "de motivering landt in het logboek van dit risico.",
    };
  }

  return {
    ok: true,
    update,
    diff,
    gewijzigdeVelden,
    raaktWeging,
    reden,
  };
}

/** Categorie-slug type-guard, voor de UI. */
export function isGeldigeCategorie(v: unknown): v is CategorieSlug {
  return typeof v === "string" && TOEGESTANE_CATEGORIEEN.includes(v);
}

/** Type-guard voor het risicotype, voor de UI. */
export function isGeldigTypeRisico(v: unknown): v is TypeRisicoSlug {
  return typeof v === "string" && TOEGESTANE_TYPES.includes(v);
}
