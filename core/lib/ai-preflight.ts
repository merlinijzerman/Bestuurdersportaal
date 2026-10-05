// ============================================================================
//  ai-preflight.ts — de centrale AI-preflight vanuit de applicatielaag
// ----------------------------------------------------------------------------
//  Eén ingang naar `fn_ai_preflight` (tenantsessie) en `fn_ai_preflight_systeem`
//  (cron/worker/AQLab). De DATABASE beslist; dit bestand stelt alleen de vraag
//  en vertaalt het antwoord naar iets waar een route mee kan werken.
//
//  FAIL-CLOSED. Elke fout — RPC weg, netwerk stuk, onbegrijpelijk antwoord —
//  levert `toegestaan: false`. Een kostendragend pad mag NOOIT doorlopen omdat
//  de begrenzing zelf onbereikbaar was.
//
//  IDEMPOTENTIE (FR-2). De sleutel komt van een expliciete `Idempotency-Key`
//  per gebruikersactie; de UI genereert er één per klik. Server-side wordt hij
//  samengesteld tot `actietype:gebruikersleutel` en bewaard mét een
//  VINGERAFDRUK van de canonieke payload. Daardoor kan een sleutel niet worden
//  hergebruikt om het quotum te omzeilen: zelfde sleutel + andere inhoud wordt
//  geweigerd. Twee legitieme identieke vragen krijgen elk hun eigen sleutel en
//  tellen dus allebei — een tijdvenster-hash zou ze onterecht laten samenvallen.
//
//  Achtergrondwerk heeft geen client en dus geen header: daar is de sleutel de
//  jobidentiteit (`<job_id>:<stap>:<poging>`), van nature stabiel én per poging
//  uniek. Dat laatste is essentieel bij OCR: elke retry wordt door de provider
//  opnieuw gefactureerd en moet dus opnieuw reserveren.
//
//  Besluit 0180.
// ============================================================================

import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actietype, WeigerReden } from "./ai-quota-kern";
import { aiGeblokkeerd, duplicaatVerzoek, quotumBereikt } from "./api-errors";

/** Providers waarvoor een kill switch bestaat. */
export type Provider = "anthropic" | "mistral" | "openai";

/**
 * Uitkomst van de preflight.
 *
 *  `nieuw`                  — gereserveerd, ga door.
 *  `duplicaat_in_uitvoering`— zelfde actie loopt al; NIET nogmaals de provider bellen.
 *  `duplicaat_voltooid`     — al klaar; geef het vastgelegde resultaat terug.
 *  `sleutel_conflict`       — zelfde sleutel, andere inhoud: geweigerd.
 *  `geweigerd`              — quotum, kill switch of modelallowlist.
 *  `onbereikbaar`           — de begrenzing zelf faalde; fail-closed.
 */
export type PreflightUitkomst =
  | { uitkomst: "nieuw"; actieId: string | null; configVersie: number | null }
  | { uitkomst: "duplicaat_in_uitvoering"; actieId: string | null }
  | { uitkomst: "duplicaat_voltooid"; actieId: string | null; resultaatRef: string | null }
  | { uitkomst: "sleutel_conflict" }
  | { uitkomst: "geweigerd"; reden: WeigerReden; resetSeconden: number | null }
  | { uitkomst: "onbereikbaar" };

export function isToegestaan(u: PreflightUitkomst): u is Extract<PreflightUitkomst, { uitkomst: "nieuw" }> {
  return u.uitkomst === "nieuw";
}

/** Maakt van een willekeurige payload een stabiele, korte vingerafdruk. */
export function vingerafdruk(payload: unknown): string {
  return createHash("sha256").update(canoniek(payload)).digest("hex");
}

/**
 * Canonieke serialisatie: objectsleutels alfabetisch, zodat een andere
 * sleutelvolgorde in dezelfde request niet als "andere inhoud" telt en een
 * legitieme retry niet onterecht op `sleutel_conflict` stuit.
 */
function canoniek(waarde: unknown): string {
  if (waarde === null || typeof waarde !== "object") return JSON.stringify(waarde) ?? "null";
  if (Array.isArray(waarde)) return `[${waarde.map(canoniek).join(",")}]`;
  const obj = waarde as Record<string, unknown>;
  const sleutels = Object.keys(obj).sort();
  return `{${sleutels.map((k) => `${JSON.stringify(k)}:${canoniek(obj[k])}`).join(",")}}`;
}

/**
 * Leest de `Idempotency-Key` uit een request en maakt er een servergebonden
 * sleutel van. De header is VERPLICHT op kostendragende tenantroutes: zonder
 * sleutel is er geen bescherming tegen een dubbele reservering bij een retry.
 *
 * Retourneert `null` als de header ontbreekt of onbruikbaar is; de route
 * antwoordt dan met 400. Bewust geen stille fallback op een willekeurige uuid —
 * dat zou de bescherming onzichtbaar uitschakelen.
 */
export function sleutelUitRequest(request: Request, actietype: Actietype): string | null {
  const ruw = request.headers.get("Idempotency-Key")?.trim();
  if (!ruw) return null;
  // Begrensd en tekenbeperkt: de sleutel komt van een client en belandt in een
  // unieke index. Een uuid past ruim binnen deze grens.
  if (ruw.length < 8 || ruw.length > 200) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(ruw)) return null;
  return `${actietype}:${ruw}`;
}

/** Sleutel voor achtergrondwerk: stabiel per (job, stap) en uniek per poging. */
export function systeemSleutel(jobId: string, stap: string, poging: number): string {
  return `${stap}:${jobId}:${poging}`;
}

/** Sleutel voor een handmatig gestarte beheerhandeling zonder client-header. */
export function beheerSleutel(actietype: Actietype): string {
  return `${actietype}:${randomUUID()}`;
}

export type PreflightInvoer = {
  actietype: Actietype;
  /** Provider die geraakt wordt; null bij een puur voorbereidende dry-run. */
  provider?: Provider | null;
  model?: string | null;
  /** Aantal OCR-pagina's dat WERKELIJK aan de provider wordt aangeboden. */
  ocrPaginas?: number;
  idempotentie: string;
  vingerafdruk: string;
  /** Alleen toetsen, niets reserveren — voor "mag dit straks?"-vragen. */
  dryrun?: boolean;
};

/**
 * Preflight vanuit een tenantsessie. De client levert NOOIT een gebruiker- of
 * fonds-id: de RPC leidt die zelf af uit `auth.uid()` en `profielen`.
 *
 * @param supabase De RLS-client van de request (anon-key + cookies).
 */
export async function preflight(
  supabase: SupabaseClient,
  invoer: PreflightInvoer
): Promise<PreflightUitkomst> {
  return roep(supabase, "fn_ai_preflight", {
    p_actietype: invoer.actietype,
    p_provider: invoer.provider ?? null,
    p_model: invoer.model ?? null,
    p_ocr_paginas: invoer.ocrPaginas ?? 0,
    p_idempotentie: invoer.idempotentie,
    p_vingerafdruk: invoer.vingerafdruk,
    p_dryrun: invoer.dryrun ?? false,
  });
}

/**
 * Preflight voor achtergrondwerk zonder sessie (ingest-worker, generieke
 * curatie, AQLab). Vereist een service-role-client; het fonds komt van de
 * job-rij, niet van een gebruiker.
 *
 * `fondsId` is verplicht voor fondsgebonden actietypes en MOET null zijn voor
 * de platformbrede types — de RPC weigert beide fouten, zodat `fonds_id = null`
 * geen sluiproute wordt.
 */
export async function preflightSysteem(
  service: SupabaseClient,
  invoer: PreflightInvoer & { fondsId: string | null }
): Promise<PreflightUitkomst> {
  return roep(service, "fn_ai_preflight_systeem", {
    p_actietype: invoer.actietype,
    p_fonds_id: invoer.fondsId,
    p_provider: invoer.provider ?? null,
    p_model: invoer.model ?? null,
    p_ocr_paginas: invoer.ocrPaginas ?? 0,
    p_idempotentie: invoer.idempotentie,
    p_vingerafdruk: invoer.vingerafdruk,
    p_dryrun: invoer.dryrun ?? false,
  });
}

async function roep(
  client: SupabaseClient,
  functie: string,
  args: Record<string, unknown>
): Promise<PreflightUitkomst> {
  try {
    const { data, error } = await client.rpc(functie, args);
    if (error || !data || typeof data !== "object") {
      // FAIL-CLOSED. Niet loggen wát er misging richting de client; de
      // serverlog krijgt het wel, zodat een kapotte begrenzing zichtbaar is.
      console.error(`[ai-preflight] ${functie} onbereikbaar`, error?.message ?? "leeg antwoord");
      return { uitkomst: "onbereikbaar" };
    }
    return vertaal(data as Record<string, unknown>);
  } catch (e) {
    console.error(`[ai-preflight] ${functie} wierp een fout`, e instanceof Error ? e.message : e);
    return { uitkomst: "onbereikbaar" };
  }
}

function vertaal(data: Record<string, unknown>): PreflightUitkomst {
  const uitkomst = String(data.uitkomst ?? "");
  const actieId = typeof data.actie_id === "string" ? data.actie_id : null;
  const configVersie = typeof data.config_versie === "number" ? data.config_versie : null;

  switch (uitkomst) {
    case "nieuw":
      return { uitkomst: "nieuw", actieId, configVersie };
    case "duplicaat_in_uitvoering":
      return { uitkomst: "duplicaat_in_uitvoering", actieId };
    case "duplicaat_voltooid":
      return {
        uitkomst: "duplicaat_voltooid",
        actieId,
        resultaatRef: typeof data.resultaat_ref === "string" ? data.resultaat_ref : null,
      };
    case "sleutel_conflict":
      return { uitkomst: "sleutel_conflict" };
    case "geweigerd":
      return {
        uitkomst: "geweigerd",
        reden: (data.reden as WeigerReden) ?? "onbekend_actietype",
        resetSeconden: typeof data.reset_seconden === "number" ? data.reset_seconden : null,
      };
    default:
      // Een antwoord dat we niet begrijpen is geen toestemming.
      console.error("[ai-preflight] onbegrepen antwoord", uitkomst);
      return { uitkomst: "onbereikbaar" };
  }
}

/**
 * Vertaalt een preflight-uitkomst naar het HTTP-contract (FR-7), of `null` als
 * de route gewoon door mag. Zo blijft elke route-integratie drie regels:
 *
 * ```ts
 * const pf = await preflight(supabase, { … });
 * const blokkade = preflightRespons("chat.POST", pf);
 * if (blokkade) return blokkade;
 * ```
 *
 * Het `duplicaat_voltooid`-geval komt hier NIET langs als blokkade: dat is geen
 * fout maar een kans om het al vastgelegde resultaat terug te geven zonder de
 * provider te bellen. Routes die zo'n artefact hebben, handelen dat zelf af;
 * routes die dat niet hebben (gestreamde antwoorden) krijgen een 409.
 */
export function preflightRespons(
  label: string,
  uitkomst: PreflightUitkomst
): NextResponse | null {
  switch (uitkomst.uitkomst) {
    case "nieuw":
      return null;

    case "duplicaat_in_uitvoering":
      return duplicaatVerzoek(label, false);

    case "duplicaat_voltooid":
      // Geen artefactafhandeling in deze route: dan is 409 het eerlijke antwoord.
      // Er gaat in geen geval een tweede providercall uit.
      return duplicaatVerzoek(label, false);

    case "sleutel_conflict":
      return duplicaatVerzoek(label, true);

    case "onbereikbaar":
      // FAIL-CLOSED: de begrenzing zelf is stuk, dus er gaat niets naar de provider.
      return aiGeblokkeerd(label, "preflight_onbereikbaar");

    case "geweigerd":
      switch (uitkomst.reden) {
        case "quotum_gebruiker":
          return quotumBereikt(label, "gebruiker", uitkomst.resetSeconden);
        case "quotum_fonds":
          return quotumBereikt(label, "fonds", uitkomst.resetSeconden);
        case "quotum_globaal":
          return quotumBereikt(label, "platform", uitkomst.resetSeconden);
        case "quotum_ocr":
          return quotumBereikt(label, "ocr", uitkomst.resetSeconden);
        default:
          // Kill switch, modelallowlist, onbekend actietype, ontbrekend fonds:
          // allemaal een gesaniteerde 503. Geen stille fallback naar een ruimer
          // of ander model — dat is expliciet verboden (FR-7).
          return aiGeblokkeerd(label, uitkomst.reden);
      }
  }
}

/**
 * Sluit een actie af. Het VERBRUIK wijzigt hierdoor niet — dat is al geboekt en
 * blijft meetellen, ook als de providercall faalde (FR-2, conservatief tellen).
 * Alleen de levenscyclus en een eventuele verwijzing naar het resultaat.
 *
 * Bewust "best effort": mislukt het afronden, dan verloopt de actie vanzelf via
 * haar lease. Een AI-antwoord dat de gebruiker al heeft, mag niet alsnog stuk
 * gaan op een administratieve schrijfactie.
 */
export async function rondAf(
  client: SupabaseClient,
  actieId: string | null,
  status: "voltooid" | "mislukt",
  resultaatRef?: string | null
): Promise<void> {
  if (!actieId) return;
  try {
    const { error } = await client.rpc("fn_ai_actie_afronden", {
      p_actie_id: actieId,
      p_status: status,
      p_resultaat_ref: resultaatRef ?? null,
    });
    if (error) console.error("[ai-preflight] afronden mislukt", error.message);
  } catch (e) {
    console.error("[ai-preflight] afronden mislukt", e instanceof Error ? e.message : e);
  }
}
