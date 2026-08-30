// Besluitmoment-telling (P3/PR-D, #168, §7) — vervangt de readiness-weergave.
// ---------------------------------------------------------------------------
// Readiness meet procesbreed en is met de zes niveaus verdwenen (besluit 0187).
// Wat een besluitmoment (een stap met `vereist_besluit`) in de plaats krijgt is
// een telling per zwaarte (§7 r441): de openstaande vereisten uit de unie
//   {vereisten met `besluitmoment_stap = N`} ∪ {vereisten met `stap_volgorde = N`}.
// Zonder deze telling zou een besluitmoment "0 openstaand" tonen omdat er niets
// aan hangt, niet omdat alles rond is (§7 r434).
//
// PUUR bovenop de bestaande vervulling: elk `EvidenceItem` draagt al `vervuld`
// (de ENE D10-implementatie in decision.ts, gepind tegen fn_stap_open_per_zwaarte
// via de afwijking-snapshot-pin) plus `zwaarte` (afgeleid) en `besluitmoment_stap`.
// Deze module telt en groepeert alleen — geen tweede vervullingslogica.

import type { EvidenceItem } from "./decision-view";
import { zwaarteVanVereiste, type Zwaarte } from "./requirement-zwaarte";
import { requirementSleutel } from "./requirement-sleutel";

export type OpenVereiste = { label: string; requirement_sleutel: string };
export type OpenPerZwaarte = {
  kritiek: OpenVereiste[];
  vereist: OpenVereiste[];
  optioneel: OpenVereiste[];
};

function leeg(): OpenPerZwaarte {
  return { kritiek: [], vereist: [], optioneel: [] };
}

function voegToe(uit: OpenPerZwaarte, item: EvidenceItem): void {
  const z: Zwaarte = zwaarteVanVereiste(item);
  uit[z].push({
    label: item.label,
    requirement_sleutel: requirementSleutel(
      item.stap_volgorde,
      item.requirement_type,
      item.documenttype,
      item.label
    ),
  });
}

/**
 * De openstaande (niet-vervulde) vereisten voor besluitmoment N, per zwaarte:
 * de unie van de vereisten op stap N zelf en de vereisten die via
 * `besluitmoment_stap = N` óók voor dit besluit tellen (§7 r441).
 *
 * DIT is de exacte §7-telling per besluitmoment. PR-D's signalering en de
 * statusstrip gebruiken de dossier-brede `openStaandeVereisten`; de PER-besluitmoment
 * weergave (de "0 openstaand"-val uit §7 r434) landt met de status-feitenmatrix in
 * P4 (#169, besluit 0193) en gebruikt dán deze functie. Ze is hier al gebouwd én
 * gepind (besluitmoment-telling.sanity.ts) zodat `besluitmoment_stap` end-to-end
 * werkt; ze is geen dode code maar het P4-aansluitpunt.
 */
export function openVoorBesluitmoment(
  evidence: EvidenceItem[],
  besluitmomentStap: number
): OpenPerZwaarte {
  const uit = leeg();
  for (const item of evidence) {
    if (item.vervuld) continue;
    if (item.stap_volgorde === besluitmomentStap || item.besluitmoment_stap === besluitmomentStap) {
      voegToe(uit, item);
    }
  }
  return uit;
}

/**
 * Alle openstaande vereisten van het dossier, per zwaarte. Dossierbreed — niet de
 * eis (die is besluitmoment-scoped, zie onder), maar het geheugen: de statusroute
 * leidt hieruit `open_elders` af (alleen een telling, informatief).
 */
export function openStaandeVereisten(evidence: EvidenceItem[]): OpenPerZwaarte {
  const uit = leeg();
  for (const item of evidence) {
    if (!item.vervuld) voegToe(uit, item);
  }
  return uit;
}

/** Valt dit item binnen de scope van één van de besluitmomenten (§7): op de stap
 *  zelf, of via `besluitmoment_stap` aan één van die stappen gekoppeld. */
function inBesluitmomentScope(item: EvidenceItem, besluitmomentStappen: number[]): boolean {
  return (
    besluitmomentStappen.includes(item.stap_volgorde) ||
    (item.besluitmoment_stap != null && besluitmomentStappen.includes(item.besluitmoment_stap))
  );
}

/**
 * De openstaande vereisten voor de besluitmomenten van dit besluit, per zwaarte —
 * de unie over meerdere besluitmoment-stappen (§7). DIT stuurt de motiveringseis en
 * de waarschuwing; de dossierbrede `openStaandeVereisten` niet (Q1, besluit 0193).
 * In het interim is `besluitmoment_stap` leeg, dus de unie valt samen met de eigen
 * stap — correct volgens §7, en de reden dat de eis dan zelden vuurt is eerlijk,
 * niet stuk. De gezaghebbende telling gebeurt in SQL (fn_besluit_status_omslag);
 * deze TS-kant is de UX-spiegel.
 */
export function openVoorBesluitmomenten(
  evidence: EvidenceItem[],
  besluitmomentStappen: number[]
): OpenPerZwaarte {
  const uit = leeg();
  for (const item of evidence) {
    if (item.vervuld) continue;
    if (inBesluitmomentScope(item, besluitmomentStappen)) voegToe(uit, item);
  }
  return uit;
}

/**
 * De openstaande vereisten ELDERS in het dossier (buiten de besluitmomenten), per
 * zwaarte. Niet-vorderend: de statusroute geeft hiervan alleen de telling mee als
 * `open_elders` — het geheugen dat we niet kwijt willen, zonder er een eis van te
 * maken (Q1).
 */
export function openElders(
  evidence: EvidenceItem[],
  besluitmomentStappen: number[]
): OpenPerZwaarte {
  const uit = leeg();
  for (const item of evidence) {
    if (item.vervuld) continue;
    if (!inBesluitmomentScope(item, besluitmomentStappen)) voegToe(uit, item);
  }
  return uit;
}

/** Het per-zwaarte-aantal (de vorm van `open_elders` in het event/­de respons). */
export type TellingPerZwaarte = { kritiek: number; vereist: number; optioneel: number };
export function tellPerZwaarte(open: OpenPerZwaarte): TellingPerZwaarte {
  return {
    kritiek: open.kritiek.length,
    vereist: open.vereist.length,
    optioneel: open.optioneel.length,
  };
}

/**
 * Het drieweg-signaal voor een besluitmoment (§7 r434, Q1) — het onderscheid dat de
 * vals-groen-val afvangt zolang de importvalidatie (fase C) er nog niet is:
 *   - `geen-vereisten`: aan het besluitmoment is niets gekoppeld → GEEN geruststelling.
 *   - `alle-vervuld`:   er zijn vereisten en alle zijn vervuld.
 *   - `open`:           er staat nog iets open (per zwaarte).
 * Een leeg besluitmoment mag niet als "0 openstaand / alles rond" gelezen worden.
 */
export type BesluitmomentSignaal =
  | { soort: "geen-vereisten" }
  | { soort: "alle-vervuld" }
  | { soort: "open"; open: OpenPerZwaarte };

export function besluitmomentSignaal(
  evidence: EvidenceItem[],
  besluitmomentStappen: number[]
): BesluitmomentSignaal {
  let aantalInScope = 0;
  for (const item of evidence) {
    if (inBesluitmomentScope(item, besluitmomentStappen)) aantalInScope++;
  }
  if (aantalInScope === 0) return { soort: "geen-vereisten" };
  const open = openVoorBesluitmomenten(evidence, besluitmomentStappen);
  // `open` bevat per definitie alleen niet-vervulde items, dus dit is "staat er íets
  // open" — óók een enkel openstaand OPTIONEEL. Bewust: een besluitmoment met alleen
  // een open optionele mag niet als 'alle-vervuld' (groen) lezen. De motiveringseis
  // (route) kijkt daarentegen alleen naar boven-optioneel; dat verschil is bedoeld.
  if (heeftOpenBovenOptioneel(open) || open.optioneel.length > 0) {
    return { soort: "open", open };
  }
  return { soort: "alle-vervuld" };
}

/** Staat er iets open bóven `optioneel`? Bepaalt of een besluit een motivering
 *  vereist en of het vastleggings-event geschreven wordt. */
export function heeftOpenBovenOptioneel(open: OpenPerZwaarte): boolean {
  return open.kritiek.length > 0 || open.vereist.length > 0;
}
