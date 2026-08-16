// ============================================================================
//  ai-begrenzing-invoer.ts — pure invoervalidatie voor de beheeracties (0180)
// ----------------------------------------------------------------------------
//  Los van de server-acties zodat de regels programmatisch na te rekenen zijn
//  (`ai-begrenzing-invoer.sanity.ts`). Zelfde opzet als licentie-invoer.ts.
//
//  DIT IS DE VRIENDELIJKE VOORCHECK, NIET DE POORT. De echte afdwinging zit in
//  de database: CHECK-constraints op reden en venster, en de RPC's die dezelfde
//  regels nog eens toetsen. Deze laag bestaat om een beheerder een leesbare
//  melding te geven in plaats van een constraintviolatie — nooit om de
//  DB-controle te vervangen.
// ============================================================================

import { QUOTA_SLEUTELS, SWITCH_SLEUTELS, type QuotaSleutel } from "@/core/lib/ai-quota-kern";

/** Minimale lengte van een verplichte reden. Spiegelt de CHECK in de migratie. */
export const MIN_REDEN = 10;

/**
 * Bovengrens als typefout-vangnet. Een quotum van tien miljoen is in deze
 * context geen bedoelde instelling maar een misplaatste nul. Spiegelt de
 * controle in fn_ai_quota_wijzigen.
 */
export const MAX_QUOTUM = 1_000_000;

export type Uitkomst<T> = { ok: true; waarde: T } | { ok: false; melding: string };

export function isSchakelaar(s: string): boolean {
  return (SWITCH_SLEUTELS as readonly string[]).includes(s);
}

export function isQuotumSleutel(s: string): s is QuotaSleutel {
  return (QUOTA_SLEUTELS as readonly string[]).includes(s);
}

/** Verplichte reden: aanwezig én betekenisvol lang. */
export function valideerReden(ruw: unknown, waarvoor: string): Uitkomst<string> {
  const reden = (ruw ?? "").toString().trim();
  if (reden.length < MIN_REDEN) {
    return {
      ok: false,
      melding: `Geef een reden van minimaal ${MIN_REDEN} tekens voor ${waarvoor} — die komt in het auditspoor.`,
    };
  }
  return { ok: true, waarde: reden };
}

/**
 * Quotumwaarde. Accepteert een komma als decimaalteken maar eist een GEHEEL
 * getal: een half AI-actiequotum bestaat niet.
 */
export function valideerQuotum(ruw: unknown): Uitkomst<number> {
  const tekst = (ruw ?? "").toString().trim().replace(",", ".");
  if (tekst === "") return { ok: false, melding: "Vul een waarde in." };
  const waarde = Number(tekst);
  if (!Number.isFinite(waarde) || !Number.isInteger(waarde)) {
    return { ok: false, melding: "Geef een geheel getal." };
  }
  if (waarde < 0) {
    return { ok: false, melding: "Een quotum kan niet negatief zijn. Nul betekent volledig dicht." };
  }
  if (waarde > MAX_QUOTUM) {
    return {
      ok: false,
      melding: `Dit quotum (${waarde}) is onrealistisch hoog; controleer de invoer.`,
    };
  }
  return { ok: true, waarde };
}

export type AllowlistInvoer = {
  provider: string;
  model: string;
  actief: boolean;
  vensterStart: string | null;
  vensterEind: string | null;
  reden: string | null;
};

/**
 * Modelallowlist. Een venster is heel of niet, loopt vooruit in de tijd, en
 * vereist een reden — een tijdelijke uitzondering zonder motivering is niet
 * auditbaar en hoort niet te bestaan.
 */
export function valideerAllowlist(invoer: {
  provider: unknown;
  model: unknown;
  actief: unknown;
  vensterStart: unknown;
  vensterEind: unknown;
  reden: unknown;
}): Uitkomst<AllowlistInvoer> {
  const provider = (invoer.provider ?? "").toString().trim();
  if (!["anthropic", "mistral", "openai"].includes(provider)) {
    return { ok: false, melding: "Onbekende provider." };
  }
  const model = (invoer.model ?? "").toString().trim();
  if (model === "") return { ok: false, melding: "Geef een model-id op." };
  if (model.length > 200) return { ok: false, melding: "Model-id is te lang." };

  const start = (invoer.vensterStart ?? "").toString().trim() || null;
  const eind = (invoer.vensterEind ?? "").toString().trim() || null;
  if (Boolean(start) !== Boolean(eind)) {
    return { ok: false, melding: "Een tijdelijk venster vereist zowel een begin- als een eindtijd." };
  }

  let redenUit: string | null = (invoer.reden ?? "").toString().trim() || null;

  if (start && eind) {
    const s = new Date(start).getTime();
    const e = new Date(eind).getTime();
    if (Number.isNaN(s) || Number.isNaN(e)) {
      return { ok: false, melding: "Ongeldige begin- of eindtijd." };
    }
    if (e <= s) {
      return { ok: false, melding: "De eindtijd van het venster moet ná de begintijd liggen." };
    }
    const r = valideerReden(redenUit, "een tijdelijk modelvenster");
    if (!r.ok) return r;
    redenUit = r.waarde;
  }

  return {
    ok: true,
    waarde: {
      provider,
      model,
      actief: Boolean(invoer.actief),
      vensterStart: start,
      vensterEind: eind,
      reden: redenUit,
    },
  };
}
