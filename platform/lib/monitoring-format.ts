// ============================================================================
//  monitoring-format.ts — pure weergaveformatters voor het monitoringdashboard
// ----------------------------------------------------------------------------
//  PURE module: geen server-only, geen React, geen Supabase. Alles hier is een
//  string-in/string-uit-functie zodat de begrijpelijkheidsregels (voorstel §4.1)
//  programmatisch na te rekenen zijn — zie monitoring-signalen.sanity.ts.
//
//  Waarom apart van de component: `beschrijfDrempels` droeg een stille bug
//  (beide takken gaven "vanaf", dus "aandacht vanaf 99,5%" bij een lager-is-
//  slechter-signaal terwijl aandacht ONDER 99,5% begint). Een formatter die in
//  een component leeft is niet te toetsen; hier wel.
// ============================================================================

import type { Eenheid, Richting } from "@/platform/lib/monitoring-signalen";

/** nl-NL, ten hoogste één decimaal. */
export function afgerond(waarde: number): string {
  return (Math.round(waarde * 10) / 10).toLocaleString("nl-NL");
}

/**
 * Milliseconden leesbaar maken tot in uren, ZONDER een nieuwe eenheidswaarde
 * (architectuurpunt 9: de CHECK op `eenheid` blijft ongewijzigd; de opslag blijft
 * numeriek in ms). Tiers: <1 s → ms, <1 min → seconden (1 decimaal), <1 u →
 * "m min s s", anders "u u m min". Grensgevallen in de sanity gepind.
 *   999 ms → "999 ms" · 1 s → "1 s" · 90 s → "1 min 30 s" · 60 min → "1 u" ·
 *   125 min → "2 u 5 min".
 */
export function formatteerTijdsduur(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const totaalSec = Math.round(ms / 1000);
  if (totaalSec < 60) return `${afgerond(ms / 1000)} s`;
  if (totaalSec < 3600) {
    const min = Math.floor(totaalSec / 60);
    const sec = totaalSec % 60;
    return sec > 0 ? `${min} min ${sec} s` : `${min} min`;
  }
  const totaalMin = Math.floor(totaalSec / 60);
  const uur = Math.floor(totaalMin / 60);
  const restMin = totaalMin % 60;
  return restMin > 0 ? `${uur} u ${restMin} min` : `${uur} u`;
}

/** Het kerngetal per eenheid. `onderdrukt` en een lege waarde spreken geen getal uit. */
export function formatteerWaarde(
  waarde: number | null,
  eenheid: Eenheid,
  onderdrukt: boolean
): string {
  if (onderdrukt) return "onderdrukt";
  if (waarde === null || !Number.isFinite(waarde)) return "—";
  switch (eenheid) {
    case "percentage":
      return `${afgerond(waarde)}%`;
    case "trend_percentage":
      return `${waarde > 0 ? "+" : ""}${afgerond(waarde)}%`;
    case "milliseconden":
      return formatteerTijdsduur(waarde);
    case "aantal":
    default:
      return String(Math.round(waarde));
  }
}

/** Een drempelwaarde leesbaar per eenheid; milliseconden gaan door de tijdsduurformatter. */
function formatteerDrempelwaarde(waarde: number, eenheid: Eenheid): string {
  if (eenheid === "milliseconden") return formatteerTijdsduur(waarde);
  if (eenheid === "percentage" || eenheid === "trend_percentage") return `${afgerond(waarde)}%`;
  return afgerond(waarde);
}

/**
 * Drempeltekst in WOORDEN, niet in een operator (voorstel §4.1 regel 5).
 * `lager_is_slechter` → "onder" (uptime: aandacht ONDER 99,5%), anders "vanaf".
 * De oude code gaf in beide takken "vanaf" en loog dus bij uptime.
 */
export function beschrijfDrempels(
  drempelOranje: number | null,
  drempelRood: number | null,
  richting: Richting,
  eenheid: Eenheid
): string {
  if (drempelOranje === null && drempelRood === null) return "niet ingesteld";
  const woord = richting === "lager_is_slechter" ? "onder" : "vanaf";
  const delen: string[] = [];
  if (drempelOranje !== null)
    delen.push(`aandacht ${woord} ${formatteerDrempelwaarde(drempelOranje, eenheid)}`);
  if (drempelRood !== null)
    delen.push(`verstoord ${woord} ${formatteerDrempelwaarde(drempelRood, eenheid)}`);
  return delen.join(", ");
}

/** Leesbaar meetvenster: "24 uur" / "3 dagen" / "2 uur" / "45 min". */
export function formatteerVenster(minuten: number): string {
  if (minuten % 1440 === 0) {
    const dagen = minuten / 1440;
    return dagen === 1 ? "24 uur" : `${dagen} dagen`;
  }
  if (minuten % 60 === 0) return `${minuten / 60} uur`;
  return `${minuten} min`;
}
