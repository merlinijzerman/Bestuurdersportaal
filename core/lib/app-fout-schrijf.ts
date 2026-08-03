// ============================================================================
//  app-fout-schrijf.ts — het schrijfpad naar app_errors vanaf de GEDEELDE surface
// ----------------------------------------------------------------------------
//  Sinds variant C (besluit 0066) leeft SUPABASE_SERVICE_ROLE_KEY uitsluitend in
//  het beheer-project. De tenant- en publieke surface kunnen dus niet met een
//  service-role client naar `app_errors` schrijven, en mogen sowieso niet uit
//  `platform/*` importeren (eslint-boundary T9 + scripts/check-service-role-leak.sh).
//
//  Daarom loopt dit pad via de SECURITY DEFINER-RPC `fn_app_error_log` op de
//  gewone sessieclient — hetzelfde patroon als D1 (besluit 0065). De RPC leidt
//  `fonds_id` zelf af uit auth.uid(); wij sturen het niet mee en kunnen het dus
//  ook niet vervalsen.
//
//  ── DRIE HARDE EIGENSCHAPPEN ───────────────────────────────────────────────
//  1. NOOIT BLOKKEREND. Het wegschrijven gebeurt in `after()` (Next 15), dus ná
//     het versturen van de response. Een trage of stukke logger mag nooit een
//     trage of stukke request worden.
//  2. NOOIT WERPEND. Alles staat in try/catch. Een falende logger produceert één
//     console.warn en verder niets.
//  3. NOOIT RECURSIEF. Dit bestand roept `errorResponse` niet aan en logt zijn
//     eigen fout niet naar app_errors — anders vermenigvuldigt een DB-storing
//     zichzelf.
//
//  BEWUST GEACCEPTEERD (besluit 0005): een fout die optreedt TIJDENS een
//  DB-storing landt hier niet. `console.error` in de aanroeper blijft daarom
//  altijd het eerste spoor, en gaat vóór deze aanroep — niet erna.
//
//  BEWUST GEACCEPTEERD: paden zonder sessie (contactformulier, publieke
//  pagina's) loggen niet. `fn_app_error_log` is niet aan `anon` gegeven; dat zou
//  een internet-facing schrijfpad naar een platformtabel openen én gate H breken.
// ============================================================================

import "server-only";
import { after } from "next/server";
import { bouwAppFout, type AppFoutInvoer, type AppFoutRecord } from "./app-fout";
import { createServerSupabase } from "./supabase-server";

/**
 * Schrijft een foutregel naar `app_errors`. Fire-and-forget: geeft direct terug
 * en werpt nooit.
 *
 * Roep dit AAN NA de `console.error` van de aanroeper, niet ervoor — dan blijft
 * het Vercel-log het spoor dat er hoe dan ook is.
 */
export function logAppFout(invoer: AppFoutInvoer): void {
  let record: AppFoutRecord;
  try {
    record = bouwAppFout(invoer);
  } catch {
    // bouwAppFout is defensief geschreven en zou hier niet mogen komen; als het
    // toch gebeurt is stil doorgaan beter dan de request opblazen.
    return;
  }

  try {
    // after() draait ná de response, binnen dezelfde request-scope (cookies
    // blijven leesbaar). Buiten een request-scope werpt het — dan slaan we het
    // wegschrijven over. Een losse, niet-afgewachte promise zou op een
    // serverless runtime alsnog bevriezen; dat is schijnzekerheid.
    after(async () => {
      await schrijf(record);
    });
  } catch {
    // Geen request-scope (bv. een script of een test): stil overslaan.
  }
}

/**
 * Harde bovengrens op het wegschrijven. `after()`-werk telt mee in de levensduur
 * van de serverless-invocatie: een hangende verbinding vertraagt de RESPONSE
 * niet, maar houdt de functie wel vast tot maxDuration. Dat is nog steeds "een
 * trage logger die een trage invocatie wordt", en dat sluit dit bestand uit.
 */
const SCHRIJF_TIMEOUT_MS = 2000;

/**
 * Foutcodes die betekenen "deze aanroeper mag hier niet schrijven". Dat is geen
 * storing maar het BEDOELDE gedrag op ongeauthenticeerde paden (contactformulier,
 * publieke pagina's), waar fn_app_error_log bewust niet aan anon is gegeven. Een
 * verwachte weigering hoort geen operator-waarschuwing te produceren, anders
 * verzuipt de echte waarschuwing in de ruis.
 */
const VERWACHTE_WEIGERING = new Set(["42501", "PGRST301", "PGRST302"]);

async function schrijf(record: AppFoutRecord): Promise<void> {
  try {
    const supabase = await createServerSupabase();
    const { error } = await metTimeout(supabase.rpc("fn_app_error_log", {
      p_label: record.label,
      p_categorie: record.categorie,
      p_severity: record.severity,
      p_http_status: record.httpStatus,
      p_fouttype: record.fouttype,
      p_foutcode: record.foutcode,
      p_melding_kort: record.meldingKort,
      p_context_sleutels: record.contextSleutels,
      p_correlatie_id: record.correlatieId,
    }));

    if (error && !VERWACHTE_WEIGERING.has(error.code ?? "")) {
      // Eén regel, geen error-object: de RPC-fout kan zelf schemadetail dragen
      // en dit is een operator-log, geen debugsessie.
      console.warn(
        `[app-errors] wegschrijven mislukt voor "${record.label}" (${error.code ?? "geen code"})`
      );
    }
  } catch {
    console.warn(`[app-errors] wegschrijven mislukt voor "${record.label}"`);
  }
}

/** Verwerpt na SCHRIJF_TIMEOUT_MS; de catch in schrijf() vangt dat af. */
function metTimeout<T>(belofte: PromiseLike<T>): Promise<T> {
  return Promise.race([
    Promise.resolve(belofte),
    new Promise<T>((_, verwerp) =>
      setTimeout(() => verwerp(new Error("timeout")), SCHRIJF_TIMEOUT_MS)
    ),
  ]);
}
