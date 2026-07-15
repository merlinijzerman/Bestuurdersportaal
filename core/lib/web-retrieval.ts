// ============================================================================
//  lib/web-retrieval.ts — Scenario A orkestratie-glue (besluit 0072, Route 1).
// ----------------------------------------------------------------------------
//  Pure, DB-vrije laag tussen de Anthropic web_search-tool en het uniforme
//  bronmodel. Isoleert de API-VORM-aannames van de server-side web_search-tool op
//  ÉÉN get-teste plek (de geïnstalleerde SDK 0.39.0 typeert deze server-tool nog
//  niet; de API ondersteunt hem wel — daarom parsen we de responscontent
//  DEFENSIEF op runtime i.p.v. op SDK-types te leunen).
//
//  Verantwoordelijkheden:
//    • buildWebSearchTool     — tool-config voor de messages-call (allowed_domains
//                               = harde server-side domeinfilter; max_uses = cap).
//    • extractWebResultaten   — leest bevraagde + geciteerde webresultaten uit de
//                               content-blokken van het (afgeronde) antwoord.
//    • bouwWebbronnen         — HERVERIFIEERT elke citaat-URL tegen de whitelist
//                               (matchWhitelist), koppelt normgewicht + ophaaldatum,
//                               dedupliceert en weegt (bindend eerst). Niet-whitelist
//                               citaties vallen af (defense-in-depth, FR-1/anti-fabricage).
//
//  Testbaar via lib/web-retrieval.sanity.ts (fixtures, geen echte API-call).
// ============================================================================

import {
  matchWhitelist,
  actieveEntries,
  weegWebbronnen,
  type WhitelistEntry,
} from "./web-whitelist";
import { webBronNaarSource, type AssistantSourceWeb } from "./assistant-source";
import type { Normgewicht } from "./bronsoort";

/** Tool-versie van de Anthropic web_search server-tool (0019: basisvariant). */
export const WEB_SEARCH_TOOL_TYPE = "web_search_20250305";

/**
 * Bouw de web_search-tool-config. `allowed_domains` dwingt Anthropic server-side
 * af dat er alléén binnen de whitelist wordt gezocht (FR-1, vóór ophalen); onze
 * herverificatie in bouwWebbronnen is de tweede, harde gate. Retourtype bewust
 * een los record: de route cast dit naar de tools-parameter (SDK 0.39 typeert de
 * server-tool nog niet).
 */
export function buildWebSearchTool(
  allowedDomeinen: string[],
  maxUses: number
): Record<string, unknown> {
  return {
    type: WEB_SEARCH_TOOL_TYPE,
    name: "web_search",
    allowed_domains: allowedDomeinen,
    max_uses: Math.max(1, maxUses),
  };
}

export interface WebCitatie {
  url: string;
  titel: string | null;
  /** page_age uit het zoekresultaat, indien aanwezig (publicatie-ouderdom). */
  paginaDatum: string | null;
}

export interface WebResultaten {
  /** Alle door de tool BEVRAAGDE resultaten (web_search_tool_result-blokken). */
  bevraagd: WebCitatie[];
  /** De daadwerkelijk in het antwoord GECITEERDE bronnen (text.citations). */
  geciteerd: WebCitatie[];
  /** Foutcode van een mislukte zoekopdracht (time-out/te veel/…) of null. */
  foutcode: string | null;
}

function tekst(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/**
 * Lees bevraagde + geciteerde webresultaten uit de content-blokken van een
 * afgerond Anthropic-antwoord. Defensief: onbekende/afwijkende vormen leveren
 * simpelweg minder resultaten, nooit een exceptie. Herkent:
 *   • text-blok met `citations[]` van type web_search_result_location (url/title)
 *   • web_search_tool_result-blok met `content[]` (url/title/page_age) of een
 *     `web_search_tool_result_error` (foutcode).
 */
export function extractWebResultaten(content: unknown): WebResultaten {
  const bevraagd: WebCitatie[] = [];
  const geciteerd: WebCitatie[] = [];
  let foutcode: string | null = null;

  if (!Array.isArray(content)) return { bevraagd, geciteerd, foutcode };

  for (const blok of content as Array<Record<string, unknown>>) {
    if (!blok || typeof blok !== "object") continue;
    const type = blok.type;

    // 1) Geciteerde bronnen: text-blok met citations.
    if (type === "text" && Array.isArray(blok.citations)) {
      for (const c of blok.citations as Array<Record<string, unknown>>) {
        const url = tekst(c?.url);
        if (!url) continue;
        geciteerd.push({ url, titel: tekst(c?.title), paginaDatum: null });
      }
    }

    // 2) Bevraagde bronnen / fout: web_search_tool_result-blok.
    if (type === "web_search_tool_result") {
      const inhoud = blok.content;
      if (Array.isArray(inhoud)) {
        for (const r of inhoud as Array<Record<string, unknown>>) {
          if (r?.type === "web_search_tool_result_error") {
            foutcode = tekst(r?.error_code) ?? "web_search_error";
            continue;
          }
          const url = tekst(r?.url);
          if (!url) continue;
          bevraagd.push({ url, titel: tekst(r?.title), paginaDatum: tekst(r?.page_age) });
        }
      } else if (inhoud && typeof inhoud === "object") {
        const err = inhoud as Record<string, unknown>;
        if (err.type === "web_search_tool_result_error") {
          foutcode = tekst(err.error_code) ?? "web_search_error";
        }
      }
    }
  }

  return { bevraagd, geciteerd, foutcode };
}

/**
 * Herverifieer de geciteerde bronnen tegen de whitelist en bouw de uniforme
 * webbronnen. Elke citaat-URL moet matchen op een ACTIEVE whitelist-entry
 * (matchWhitelist dwingt matchtype/padprefix af); niet-matchende of onveilige
 * URL's vallen af (FR-1 / anti-fabricage). Resultaat is gededupliceerd op URL en
 * gewogen op normgewicht (bindend eerst, FR-3). `ophaaldatum` = ISO-tijdstip van
 * het ophalen (door de route aangeleverd, FR-2).
 */
export function bouwWebbronnen(
  geciteerd: WebCitatie[],
  whitelist: WhitelistEntry[],
  ophaaldatum: string
): AssistantSourceWeb[] {
  const actief = actieveEntries(whitelist);
  const perUrl = new Map<string, AssistantSourceWeb>();

  for (const c of geciteerd) {
    if (perUrl.has(c.url)) continue;
    const match = matchWhitelist(c.url, actief);
    if (!match) continue; // niet-whitelist → geen bron (defense-in-depth)
    const bron = webBronNaarSource({
      url: c.url,
      titel: c.titel,
      datum: c.paginaDatum,
      normgewicht: match.normgewicht,
      ophaaldatum,
    });
    if (bron) perUrl.set(c.url, bron);
  }

  return weegWebbronnen(
    [...perUrl.values()],
    (b) => (b.normgewicht ?? null) as Normgewicht | null
  );
}

// ── Gating: mag voor deze vraag live web-retrieval draaien? ─────────────────

export type WebGateReden =
  | "ok"
  | "vlag_uit"
  | "geen_whitelist"
  | "scope_actief"
  | "geen_extern_signaal"
  | "pii_geblokkeerd";

export interface WebGateResultaat {
  mag: boolean;
  reden: WebGateReden;
}

export interface WebGateInput {
  /** env WEB_RETRIEVAL_ACTIEF — de harde Scenario A-hoofdschakelaar. */
  vlagAan: boolean;
  /** Aantal ACTIEVE whitelist-entries. */
  aantalActieveEntries: number;
  /** Vraag over een specifiek stuk/agendapunt → geen web (strikt intern). */
  scopeActief: boolean;
  /** Bronsoortprofiel (lib/weeg-bronsoort): alleen bij extern/gecombineerd signaal. */
  bronsoortprofiel: "fonds" | "generiek" | "gecombineerd";
  /** Bevat de vraag persoons-/fondsgegevens (lib/pii-gate)? */
  bevatPii: boolean;
}

/**
 * Deterministische gating (FR-1/FR-9). Web-retrieval draait alleen als: de vlag
 * aan staat, er ≥1 actieve whitelist-entry is, er geen document-/agendapuntscope
 * actief is, de vraag een extern (generiek/gecombineerd) signaal draagt, én de
 * PII-gate slaagt. Anders terugval op het bestaande RAG/modelkennis-pad (FR-4).
 * De reden wordt gelogd (retrieval_meta.web).
 */
export function beoordeelWebGate(input: WebGateInput): WebGateResultaat {
  if (!input.vlagAan) return { mag: false, reden: "vlag_uit" };
  if (input.aantalActieveEntries <= 0) return { mag: false, reden: "geen_whitelist" };
  if (input.scopeActief) return { mag: false, reden: "scope_actief" };
  if (input.bronsoortprofiel === "fonds")
    return { mag: false, reden: "geen_extern_signaal" };
  if (input.bevatPii) return { mag: false, reden: "pii_geblokkeerd" };
  return { mag: true, reden: "ok" };
}

/** Unieke, genormaliseerde domeinen die de tool bevroeg (voor het auditspoor). */
export function bevraagdeDomeinen(bevraagd: WebCitatie[]): string[] {
  const set = new Set<string>();
  for (const c of bevraagd) {
    try {
      set.add(new URL(c.url).hostname.replace(/^www\./, "").toLowerCase());
    } catch {
      /* skip */
    }
  }
  return [...set];
}
