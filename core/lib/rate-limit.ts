// ============================================================================
// Rate limiting helper — Security Route A WP2 (in-stack, Postgres)
// ----------------------------------------------------------------------------
// Roept de security-definer-functie `fn_rate_limit_check` in Postgres aan en
// geeft een nette beslissing terug. De functie is het enige schrijf-/leespad
// naar de teller-tabel; directe writes worden via RLS geweigerd, zodat een
// gebruiker zijn eigen teller niet kan resetten (zie de migratie
// 2026_06_10_rate_limiting.sql).
//
// De teller wordt in de DB op auth.uid() gesleuteld — we sturen bewust GEEN
// gebruiker-id mee vanuit de client, want dat zou te spoofen zijn.
//
// Centrale configuratie (één plek, zodat tuning eenvoudig is):
//   - chat            20 / 5 min   (uit SECURITY-ROUTE-A-PLAN.md)
//   - upload          10 / uur     (uit SECURITY-ROUTE-A-PLAN.md)
//   - voorbereiding   30 / uur     (AI-route, analoog begrensd)
//   - besluit_concept 30 / uur     (AI-route, analoog begrensd)
// ============================================================================

import type { createServerSupabase } from "@/core/lib/supabase-server";
import { logAppFout } from "@/core/lib/app-fout-schrijf";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabase>>;

/** Eén limiet-instelling: endpoint-sleutel, aantal toegestane requests, venster. */
export type Limiet = {
  /** Endpoint-sleutel waarop geteld wordt (per gebruiker apart geteld). */
  endpoint: string;
  /** Maximaal aantal toegestane requests binnen het venster. */
  limiet: number;
  /** Tijdvenster als Postgres-interval-literal (bv. "5 minutes", "1 hour"). */
  venster: string;
};

/**
 * Centrale limiet-configuratie. Wijzig hier om te tunen — de routes verwijzen
 * uitsluitend naar deze constanten.
 */
export const LIMIETEN = {
  chat: { endpoint: "chat", limiet: 20, venster: "5 minutes" },
  upload: { endpoint: "upload", limiet: 10, venster: "1 hour" },
  // T14 — Excel-upload stuurinformatie-invoer (parse-only; commit loopt via
  // het normale POST-schrijfpad). Ruim genoeg voor herhaald controleren.
  stuurinfo_upload: { endpoint: "stuurinfo_upload", limiet: 20, venster: "1 hour" },
  voorbereiding: { endpoint: "voorbereiding", limiet: 30, venster: "1 hour" },
  besluit_concept: { endpoint: "besluit_concept", limiet: 30, venster: "1 hour" },
  // T6 fase 2 — conceptleeswijzer voor het auditdossier-afschrift: één
  // Anthropic-call per aanroep op de feitenkaart. 20/uur is ruim voor
  // herhaald genereren/redigeren.
  afschrift_concept: { endpoint: "afschrift_concept", limiet: 20, venster: "1 hour" },

  // ── M-06 (review 2026-07-30) — dure routes die géén limiet hadden ────────
  // Elk van deze routes doet per aanroep externe modelcalls (embedding, OCR,
  // Haiku-prefix) en was onbeperkt herhaalbaar door een geauthenticeerde
  // gebruiker. Dat is kosten-DoS, en /api/zoeken is bovendien bereikbaar voor
  // élke bestuurder zónder rolcheck.
  //
  // Zoeken genereert bij hybride retrieval per query een embedding; 60 per
  // 5 minuten is ruim voor normaal doorzoeken en dempt scriptgebruik.
  zoeken: { endpoint: "zoeken", limiet: 60, venster: "5 minutes" },
  // Her-extract is de duurste route van de applicatie: storage-download +
  // eventueel volledige OCR + tientallen Haiku-calls + embeddings.
  her_extract: { endpoint: "her_extract", limiet: 10, venster: "1 hour" },
  // Backfills draaien in batches van 25; 60 per uur laat een volledige
  // inhaalslag toe zonder onbegrensd te kunnen stapelen.
  backfill: { endpoint: "backfill", limiet: 60, venster: "1 hour" },
  // Notulen-segmentatie doet een volledige documentextractie + LLM-call.
  segmenteer: { endpoint: "segmenteer", limiet: 20, venster: "1 hour" },
  // Bulk-metadata is begrensd op 200 documenten per call, maar niet op het
  // aantal calls.
  bulk_metadata: { endpoint: "bulk_metadata", limiet: 30, venster: "1 hour" },

  // ── Besluit 0180 (AI-begrenzing) — twee resterende gaten ─────────────────
  // Deze twee entries zijn NIEUW; er is geen bestaande drempel gewijzigd. Bij
  // de inventarisatie voor de AI-begrenzing bleken dit de laatste twee
  // kostendragende routes zonder enige burstlimiet.
  //
  // /api/vergelijk is daarvan verreweg de duurste: per aanroep N × Opus (één
  // per vergelijkdimensie) plus 2N Mistral-embeddings. Zonder deze limiet kan
  // één gebruiker zijn hele maandquotum in een minuut op de duurste route
  // verbranden — het maandquotum begrenst de HOEVEELHEID, niet het TEMPO.
  vergelijk: { endpoint: "vergelijk", limiet: 10, venster: "1 hour" },
  // Notulensegment bevestigen doet Mistral-embeddings over de segmentchunks.
  notulen_bevestig: { endpoint: "notulen_bevestig", limiet: 60, venster: "1 hour" },
} as const satisfies Record<string, Limiet>;

/** De limietnamen uit het benoemde register — de enige echte declaratiewaarden
 *  voor `RouteSpecV1.rateLimit`. Hier gedefinieerd (niet in ratelimit-enforce.ts)
 *  zodat dié module met een pure type-import server-loos blijft. */
export type LimietNaam = keyof typeof LIMIETEN;

export type LimietBeslissing = {
  /** Of het request door mag. */
  toegestaan: boolean;
  /** Resterend budget binnen het venster (>= 0). */
  resterend: number;
  /** Wanneer er weer ruimte komt. Null als onbekend (bv. bij fail-open). */
  resetAt: Date | null;
};

type RpcResultaat = {
  toegestaan: boolean;
  resterend: number;
  reset_at: string | null;
};

/**
 * Controleer en registreer een request tegen de rate-limit-teller.
 *
 * Hergebruikt de meegegeven (geauthenticeerde) Supabase-client uit de route, zodat
 * de functie in de DB de juiste auth.uid() ziet.
 *
 * **Fail-open (default)**: faalt de DB-call, dan laten we het request bewust toe
 * en loggen we de fout. Een rate-limiter mag de hele applicatie niet platleggen
 * bij een tijdelijke DB-storing (conform de risicotabel in
 * SECURITY-ROUTE-A-PLAN.md).
 *
 * **Fail-closed (`opties.failClosed`)** — H-12 (review 2026-07-30): voor routes
 * die per aanroep KOSTEN maken bij een externe provider is fail-open de
 * verkeerde keuze. Juist tijdens een DB-storing (of een aanval die er een
 * veroorzaakt) verdwijnt dan de enige rem op het aantal modelaanroepen. Het
 * verschil in schade is asymmetrisch: bij fail-open loopt de rekening door bij
 * Anthropic/Mistral, bij fail-closed ziet de gebruiker tijdelijk een nette
 * foutmelding op één functie. Gebruik dit voor chat, zoeken, her-extract,
 * backfills en segmentatie; laat het uit voor niet-kostende routes.
 */
export async function controleerLimiet(
  supabase: SupabaseClient,
  sleutel: Limiet,
  opties: { failClosed?: boolean } = {}
): Promise<LimietBeslissing> {
  const { data, error } = await supabase.rpc("fn_rate_limit_check", {
    p_endpoint: sleutel.endpoint,
    p_limiet: sleutel.limiet,
    p_venster: sleutel.venster,
  });

  if (error || !data) {
    // P5: een mislukte limietcheck is severity HOOG, ongeacht de tak. Dit is
    // precies het moment waarop de compensating control onder besluit 0005
    // wegvalt — fail-open laat de rem los, fail-closed breekt een functie. Beide
    // horen zichtbaar te zijn op het dashboard (signaal 5), niet alleen in een
    // Vercel-logregel waar niemand naar kijkt.
    const logFout = (tak: string) =>
      logAppFout({
        label: `rate-limit.${sleutel.endpoint}`,
        error: error ?? new Error("lege respons van fn_rate_limit_check"),
        categorie: "rate_limiting",
        severity: "hoog",
        context: { tak, endpoint: sleutel.endpoint },
      });

    if (opties.failClosed) {
      console.error(
        `[rate-limit:${sleutel.endpoint}] check mislukt — FAIL-CLOSED (kostendragende route)`,
        error
      );
      logFout("fail_closed");
      return { toegestaan: false, resterend: 0, resetAt: null };
    }
    // Fail-open: toelaten, maar wel signaleren in de server-logs.
    console.error(`[rate-limit:${sleutel.endpoint}] check mislukt — fail-open`, error);
    logFout("fail_open");
    return { toegestaan: true, resterend: sleutel.limiet, resetAt: null };
  }

  const res = data as RpcResultaat;
  return {
    toegestaan: res.toegestaan,
    resterend: res.resterend,
    resetAt: res.reset_at ? new Date(res.reset_at) : null,
  };
}
