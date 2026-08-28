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
 * Alle openstaande vereisten van het dossier, per zwaarte — de basis voor de
 * §4.4-signalering bij een besluitovergang (de statusroute schrijft hiermee het
 * `besluit_genomen_met_openstaande_vereisten`-event en de waarschuwing).
 */
export function openStaandeVereisten(evidence: EvidenceItem[]): OpenPerZwaarte {
  const uit = leeg();
  for (const item of evidence) {
    if (!item.vervuld) voegToe(uit, item);
  }
  return uit;
}

/** Staat er iets open bóven `optioneel`? Bepaalt of een besluit een motivering
 *  vereist en of het vastleggings-event geschreven wordt. */
export function heeftOpenBovenOptioneel(open: OpenPerZwaarte): boolean {
  return open.kritiek.length > 0 || open.vereist.length > 0;
}
