// ============================================================================
//  "Een document doorgronden" — pure sectie-/instructielaag (P2 Deel B).
// ----------------------------------------------------------------------------
//  Eén bron van waarheid voor: de kiesbare secties, de zichtbare leesbare beurt
//  (client), de server-side samengestelde instructie (route), en de gelogde
//  promptvariant (auditspoor). Zo lopen UI, /api/chat en de eval niet uiteen.
//
//  Puur en programmatisch narekenbaar (zie doorgrond.sanity.ts): geen DB, geen
//  React, geen modelaanroep. De instructie wordt aan de GEBRUIKERSPROMPT
//  toegevoegd (niet aan de toon-systeemprompt SP_* — CLAUDE.md-guardrail).
//
//  Vaste lengtenorm "kort — ongeveer één A4": bewust GEEN lengteknop (werkopdracht
//  "Niet in scope"). Lengte is achteraf te sturen via de bestaande vervolgacties
//  maak_korter/maak_concreter (vraagtype.ts). Dit halveert de promptmatrix.
// ============================================================================

export type DoorgrondSectieId =
  | "samenvatting"
  | "aandachtspunten"
  | "kritische_vragen"
  | "afwijkingen";

export interface DoorgrondSectie {
  id: DoorgrondSectieId;
  /** Kop in het antwoord én in de UI-rij. */
  titel: string;
  /** Toelichting onder de rij in de scherpsteltoestand. */
  uiHint: string;
  /** True = alleen selecteerbaar bij een aantoonbaar eerdere versie. */
  vereistVorigeVersie: boolean;
}

/** De vier secties, in de vaste volgorde waarin ze in het antwoord verschijnen. */
export const DOORGROND_SECTIES: readonly DoorgrondSectie[] = [
  {
    id: "samenvatting",
    titel: "Samenvatting",
    uiHint: "De kern in tien regels.",
    vereistVorigeVersie: false,
  },
  {
    id: "aandachtspunten",
    titel: "Bestuurlijke aandachtspunten",
    uiHint: "Wat vraagt aandacht of actie van het bestuur.",
    vereistVorigeVersie: false,
  },
  {
    id: "kritische_vragen",
    titel: "Kritische vragen",
    uiHint: "Drie vragen om in de vergadering te stellen.",
    vereistVorigeVersie: false,
  },
  {
    id: "afwijkingen",
    titel: "Afwijkingen",
    uiHint: "Wat wijkt af van de vorige versie.",
    vereistVorigeVersie: true,
  },
];

/**
 * Versie-identifier van het instructietemplate. Wordt in de Governance Log
 * (retrieval_meta.doorgrond.promptvariant) vastgelegd zodat achteraf te
 * reconstrueren is wélk template een antwoord voortbracht (criterium 13).
 */
export const DOORGROND_PROMPTVARIANT = "doorgrond_v1_kort";

// ── Beschikbaarheid + validatie ──────────────────────────────────────────────

/** Is een sectie kiesbaar gegeven of er een eerdere versie is (besluitpunt 2)? */
export function sectieBeschikbaar(
  id: DoorgrondSectieId,
  heeftVorigeVersie: boolean
): boolean {
  const sectie = DOORGROND_SECTIES.find((s) => s.id === id);
  if (!sectie) return false;
  return sectie.vereistVorigeVersie ? heeftVorigeVersie : true;
}

/**
 * Mag de taak starten? Minimaal één sectie én alle gekozen secties moeten
 * beschikbaar zijn (voorkomt dat "afwijkingen" meegaat zonder eerdere versie).
 */
export function magDoorgronden(
  gekozen: readonly DoorgrondSectieId[],
  heeftVorigeVersie: boolean
): boolean {
  if (gekozen.length === 0) return false;
  return gekozen.every((id) => sectieBeschikbaar(id, heeftVorigeVersie));
}

/** Behoudt de vaste sectievolgorde en ontdubbelt; filtert onbekende id's. */
export function sorteerSecties(
  gekozen: readonly DoorgrondSectieId[]
): DoorgrondSectieId[] {
  const set = new Set(gekozen);
  return DOORGROND_SECTIES.filter((s) => set.has(s.id)).map((s) => s.id);
}

// ── Zichtbare beurt (client) ──────────────────────────────────────────────────

function opsomming(delen: string[]): string {
  if (delen.length <= 1) return delen[0] ?? "";
  return delen.slice(0, -1).join(", ") + " en " + delen[delen.length - 1];
}

/**
 * De leesbare gebruikersbeurt die in de chat verschijnt (B5). Bewust kort — de
 * samengestelde instructie is langer en wordt server-side opgebouwd; daarom legt
 * het auditspoor de parameters vast, niet alleen deze zin (B6).
 *   "Doorgrond «Actuarieel rapport Q2 2026» — samenvatting en bestuurlijke aandachtspunten."
 */
export function bouwDoorgrondZin(
  documentTitel: string,
  gekozen: readonly DoorgrondSectieId[]
): string {
  const namen = sorteerSecties(gekozen)
    .map((id) => DOORGROND_SECTIES.find((s) => s.id === id)!.titel.toLowerCase());
  return `Doorgrond «${documentTitel}» — ${opsomming(namen)}.`;
}

// ── Samengestelde instructie (server, gebruikersprompt) ───────────────────────

function sectieInstructie(id: DoorgrondSectieId, vorigeTitel: string | null): string {
  switch (id) {
    case "samenvatting":
      return "## Samenvatting\nGeef de kern in ongeveer tien regels.";
    case "aandachtspunten":
      return "## Bestuurlijke aandachtspunten\nBenoem wat aandacht of actie van het bestuur vraagt.";
    case "kritische_vragen":
      return "## Kritische vragen\nFormuleer drie kritische vragen om in de vergadering te stellen. Formuleer zelf geen besluit of aanbeveling.";
    case "afwijkingen":
      return `## Afwijkingen\nBenoem wat afwijkt van de vorige versie${
        vorigeTitel ? ` («${vorigeTitel}»)` : ""
      }, met de belangrijkste verschillen.`;
  }
}

/**
 * De server-side instructie die in de gebruikersprompt komt. Somt de gekozen
 * secties op als koppen en legt de vaste lengtenorm + het human-in-the-loop-
 * kader op. `vorigeTitel` alleen relevant als "afwijkingen" meegaat.
 */
export function bouwDoorgrondInstructie(
  gekozen: readonly DoorgrondSectieId[],
  vorigeTitel: string | null
): string {
  const secties = sorteerSecties(gekozen);
  const blokken = secties.map((id) => sectieInstructie(id, vorigeTitel)).join("\n\n");
  return (
    "Doorgrond het document en lever UITSLUITEND de volgende secties, elk onder de " +
    "opgegeven kop, in deze volgorde:\n\n" +
    blokken +
    "\n\nHoud het geheel kort — richtlijn ongeveer één A4. U signaleert en spiegelt; " +
    "formuleer zelf geen besluit of aanbeveling."
  );
}
