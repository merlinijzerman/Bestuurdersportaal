// ============================================================================
//  #356 (G-13) — De STRIKTE afronding van een AI-actie.
// ----------------------------------------------------------------------------
//  Eigen module, en dat is geen cosmetica: `ai-preflight.ts` trekt via zijn
//  importketen `server-only` binnen, waardoor die module niet hermetisch te
//  testen is. Juist déze functie — het laatste spoor van een afgebroken beurt —
//  verdient een test die zonder Next-runtime draait.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { AFRONDING_TIMEOUT_MS } from "./generatie-budget";

/**
 * STRIKTE afronding voor het afbreekpad (#356).
 *
 * `rondAf` is bewust best-effort: een antwoord dat de bestuurder al heeft, mag
 * niet stuk gaan op een administratieve schrijfactie. Op het AFBREEKpad geldt
 * het omgekeerde — daar ís geen antwoord, en de enige waarde die de beurt nog
 * oplevert is het spoor dat zegt waaróm hij stopte. Mislukt dat stil, dan is
 * een providerstoring achteraf niet te onderscheiden van een weggelopen
 * gebruiker.
 *
 * Twee dingen die `rondAf` niet doet en deze variant wel:
 *
 *  1. de teruggegeven `error` telt als mislukking (rondAf logt hem alleen en
 *     retourneert `void`, dus de aanroeper kan er niets mee);
 *  2. `data === false` telt óók als mislukking. `fn_ai_actie_afronden` doet
 *     `get diagnostics v_n = row_count; return v_n = 1` — `false` betekent dat
 *     er NIETS is bijgewerkt (de status was geen `in_uitvoering`, of de sessie
 *     is niet de eigenaar van de actie). Zo'n RPC "slaagt" en laat de
 *     levenscyclus toch open staan.
 *
 * De aanroep is zelf begrensd: een vastlopende RPC mag de marge die voor audit
 * en afronding is gereserveerd niet opeten.
 */
export async function rondAfStrikt(
  client: SupabaseClient,
  actieId: string | null,
  status: "voltooid" | "mislukt",
  resultaatRef?: string | null,
  grensMs = AFRONDING_TIMEOUT_MS
): Promise<boolean> {
  if (!actieId) return false;

  // De RPC wordt WERKELIJK afgebroken, niet alleen weg-geraced: een
  // `Promise.race` laat de onderliggende call gewoon doorlopen en dan houdt hij
  // de invocatie alsnog bezig tot het platform de functie doodt — precies wat de
  // afrondmarge moet voorkomen. Dezelfde les als bij de reranker in PR-B.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), grensMs);
  (timer as unknown as { unref?: () => void }).unref?.();

  try {
    const { data, error } = await client
      .rpc("fn_ai_actie_afronden", {
        p_actie_id: actieId,
        p_status: status,
        p_resultaat_ref: resultaatRef ?? null,
      })
      .abortSignal(ctrl.signal);

    if (error) {
      console.error("[ai-preflight] strikte afronding: RPC-fout", error.message);
      return false;
    }
    // FAIL-CLOSED op de retourwaarde. `fn_ai_actie_afronden` doet
    // `get diagnostics v_n = row_count; return v_n = 1`, dus alleen `true`
    // betekent dat er werkelijk een rij is bijgewerkt. `false` betekent: geen
    // rij (status was geen `in_uitvoering`, of de sessie is niet de eigenaar).
    // `null` of iets anders betekent dat we het NIET WETEN — en niet-weten is
    // hier geen succes.
    if (data !== true) {
      console.error(
        "[ai-preflight] strikte afronding: geen bevestigde bijwerking",
        actieId,
        `data=${JSON.stringify(data)}`
      );
      return false;
    }
    return true;
  } catch (e) {
    // Ook een afgebroken of gegooide RPC is een mislukte afronding — nooit een
    // nieuwe fout, want de aanroeper zit al op een foutpad en zijn
    // oorspronkelijke afbreekreden mag niet worden overschreven.
    console.error(
      "[ai-preflight] strikte afronding: afgebroken of gefaald",
      actieId,
      e instanceof Error ? e.message : e
    );
    return false;
  } finally {
    clearTimeout(timer);
  }
}
