// ============================================================
//  lib/stemming.ts — Stemming-helpers (Tranche 2 Vergaderingen V2)
//
//  Pure functies voor uitslag-berekening + types die zowel server-side
//  (routes) als client-side (UI) gebruikt worden. Geen Supabase-imports
//  in de pure berekening, zodat hij makkelijk te testen is.
//
//  Belangrijk principe (zie VERGADERINGEN-V2-ONTWERP.md §7.6):
//  het systeem **rapporteert** quorum en meerderheid; het stelt geen
//  rechtsgeldigheid vast. De status-velden zijn signalen voor de
//  voorzitter, geen juridisch oordeel.
// ============================================================

export interface Alternatief {
  code: string;
  label: string;
}

export type StemmingStatus = "open" | "gesloten" | "ingetrokken";
export type VereisteMeerderheid =
  | "gewone"
  | "gekwalificeerd_twee_derde"
  | "unaniem";

export type QuorumStatus = "niet_ingesteld" | "gehaald" | "niet_gehaald";
export type MeerderheidStatus = "niet_ingesteld" | "gehaald" | "niet_gehaald";
export type BesluitAdvies = "mogelijk" | "waarschuwing" | "niet_mogelijk";

/** Eén uitgebrachte stem, genormaliseerd voor uitslag-berekening. */
export interface StemRij {
  stemgerechtigde_id: string;
  stemgerechtigde_naam: string | null;
  uitgebracht_door: string;
  uitgebracht_door_naam: string | null;
  keuze: string;
  motivering: string | null;
  is_volmacht: boolean;
  volmacht_toelichting: string | null;
}

export interface PerStemgerechtigde {
  stemgerechtigde_id: string;
  naam: string | null;
  keuze: string;
  motivering: string | null;
  is_volmacht: boolean;
  uitgebracht_door_naam: string | null;
  volmacht_toelichting: string | null;
}

export interface Uitslag {
  totalen: Record<string, number>;
  totaal_stemmen: number;
  totaal_bestuursleden: number;
  quorum_drempel: number | null;
  quorum_status: QuorumStatus;
  meerderheid_type: VereisteMeerderheid | null;
  meerderheid_status: MeerderheidStatus;
  besluitregistratie_advies: BesluitAdvies;
  winnend_alternatief: string | null;
  per_stemgerechtigde: PerStemgerechtigde[];
}

export const DEFAULT_ALTERNATIEVEN: Alternatief[] = [
  { code: "voor", label: "Voor" },
  { code: "tegen", label: "Tegen" },
  { code: "onthouden", label: "Onthouden" },
];

/**
 * Berekent de complete uitslag van een (te sluiten) stemming.
 *
 * Conventies (transparant en simpel; rechtsgeldigheid blijft bij het bestuur):
 *   • Winnend alternatief = code met de meeste stemmen. Bij gelijkspel
 *     tussen twee of meer alternatieven: geen eenduidige winnaar (null).
 *   • Meerderheid wordt getoetst t.o.v. het totaal uitgebrachte stemmen
 *     (inclusief eventuele onthoudingen in de noemer):
 *       - gewone:          winnaar * 2  >  totaal
 *       - twee_derde:      winnaar * 3  >= totaal * 2
 *       - unaniem:         winnaar      == totaal
 *   • Quorum: gehaald als totaal_stemmen >= vereist_quorum.
 *   • besluitregistratie_advies:
 *       - niet_mogelijk : geen eenduidige winnaar
 *       - waarschuwing  : quorum óf meerderheid niet gehaald
 *       - mogelijk      : anders
 */
export function berekenUitslag(
  alternatieven: Alternatief[],
  stemmen: StemRij[],
  totaalBestuursleden: number,
  vereistQuorum: number | null,
  vereisteMeerderheid: VereisteMeerderheid | null
): Uitslag {
  // Totalen initialiseren op 0 voor elk alternatief.
  const totalen: Record<string, number> = {};
  for (const a of alternatieven) totalen[a.code] = 0;
  for (const s of stemmen) {
    if (totalen[s.keuze] === undefined) totalen[s.keuze] = 0;
    totalen[s.keuze] += 1;
  }

  const totaalStemmen = stemmen.length;

  // Winnend alternatief bepalen (eenduidig?).
  let maxCount = -1;
  let winnaars: string[] = [];
  for (const code of Object.keys(totalen)) {
    const c = totalen[code];
    if (c > maxCount) {
      maxCount = c;
      winnaars = [code];
    } else if (c === maxCount) {
      winnaars.push(code);
    }
  }
  const eenduidigeWinnaar =
    totaalStemmen > 0 && winnaars.length === 1 && maxCount > 0;
  const winnendAlternatief = eenduidigeWinnaar ? winnaars[0] : null;

  // Quorum-status.
  let quorumStatus: QuorumStatus;
  if (vereistQuorum === null || vereistQuorum === undefined) {
    quorumStatus = "niet_ingesteld";
  } else {
    quorumStatus = totaalStemmen >= vereistQuorum ? "gehaald" : "niet_gehaald";
  }

  // Meerderheid-status.
  let meerderheidStatus: MeerderheidStatus;
  if (!vereisteMeerderheid) {
    meerderheidStatus = "niet_ingesteld";
  } else if (!eenduidigeWinnaar) {
    meerderheidStatus = "niet_gehaald";
  } else {
    const w = totalen[winnendAlternatief as string];
    let gehaald = false;
    if (vereisteMeerderheid === "gewone") {
      gehaald = w * 2 > totaalStemmen;
    } else if (vereisteMeerderheid === "gekwalificeerd_twee_derde") {
      gehaald = w * 3 >= totaalStemmen * 2;
    } else if (vereisteMeerderheid === "unaniem") {
      gehaald = w === totaalStemmen;
    }
    meerderheidStatus = gehaald ? "gehaald" : "niet_gehaald";
  }

  // Besluitregistratie-advies.
  let advies: BesluitAdvies;
  if (!eenduidigeWinnaar) {
    advies = "niet_mogelijk";
  } else if (
    quorumStatus === "niet_gehaald" ||
    meerderheidStatus === "niet_gehaald"
  ) {
    advies = "waarschuwing";
  } else {
    advies = "mogelijk";
  }

  const perStemgerechtigde: PerStemgerechtigde[] = stemmen.map((s) => ({
    stemgerechtigde_id: s.stemgerechtigde_id,
    naam: s.stemgerechtigde_naam,
    keuze: s.keuze,
    motivering: s.motivering,
    is_volmacht: s.is_volmacht,
    uitgebracht_door_naam: s.uitgebracht_door_naam,
    volmacht_toelichting: s.volmacht_toelichting,
  }));

  return {
    totalen,
    totaal_stemmen: totaalStemmen,
    totaal_bestuursleden: totaalBestuursleden,
    quorum_drempel: vereistQuorum ?? null,
    quorum_status: quorumStatus,
    meerderheid_type: vereisteMeerderheid ?? null,
    meerderheid_status: meerderheidStatus,
    besluitregistratie_advies: advies,
    winnend_alternatief: winnendAlternatief,
    per_stemgerechtigde: perStemgerechtigde,
  };
}

/** Korte tekstuele samenvatting van de uitslag voor notificaties. */
export function uitslagSamenvatting(
  uitslag: Uitslag,
  alternatieven: Alternatief[]
): string {
  const labelVan = (code: string) =>
    alternatieven.find((a) => a.code === code)?.label ?? code;
  const delen = Object.entries(uitslag.totalen)
    .filter(([, n]) => n > 0)
    .map(([code, n]) => `${labelVan(code)}: ${n}`);
  return delen.length > 0 ? delen.join(", ") : "geen stemmen uitgebracht";
}

/** Type-guard: is `x` een geldige array van alternatieven? */
export function isAlternatievenArray(x: unknown): x is Alternatief[] {
  if (!Array.isArray(x) || x.length < 2) return false;
  const codes = new Set<string>();
  for (const el of x) {
    if (typeof el !== "object" || el === null) return false;
    const o = el as Record<string, unknown>;
    if (typeof o.code !== "string" || !o.code.trim()) return false;
    if (typeof o.label !== "string" || !o.label.trim()) return false;
    if (codes.has(o.code)) return false; // geen dubbele codes
    codes.add(o.code);
  }
  return true;
}

/** Is dit de default voor/tegen/onthouden-set? (bepaalt of dissent-prompt verschijnt) */
export function isDefaultAlternatieven(alternatieven: Alternatief[]): boolean {
  if (alternatieven.length !== 3) return false;
  const codes = alternatieven.map((a) => a.code).sort();
  return (
    codes[0] === "onthouden" && codes[1] === "tegen" && codes[2] === "voor"
  );
}
