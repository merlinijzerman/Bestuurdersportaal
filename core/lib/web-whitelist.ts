// ============================================================================
//  lib/web-whitelist.ts — Scenario A live web-retrieval (besluit 0072).
// ----------------------------------------------------------------------------
//  Pure, DB-vrije helpers rond de gezaghebbende-bronnen-whitelist:
//    • matchWhitelist   — herverificatie: matcht een opgehaalde URL tegen de
//                         whitelist (dwingt matchtype/padprefix af, koppelt het
//                         normgewicht). DIT is de harde gate (defense-in-depth
//                         náást de allowed_domains die Anthropic al afdwingt).
//    • allowedDomeinenUit — bouwt de allowed_domains-array voor de web_search-
//                         tool uit de ACTIEVE whitelist-entries.
//    • weegWebbronnen   — ordent webbronnen op normgewicht (bindend > … >
//                         informatief); spiegelt lib/weeg-bronsoort.ts.
//    • domeinvalidatie  — formaat + look-alike-waarschuwing voor het beheerscherm.
//
//  ANTI-FABRICAGE (KERNBESLUIT, lib/assistant-source.ts): een webbron telt alleen
//  als hij daadwerkelijk is opgehaald ÉN tegen de whitelist herverifieerbaar is.
//  matchWhitelist geeft null bij een onveilige/niet-whitelist-URL → die bron
//  verschijnt nooit in het antwoord.
//
//  Testbaar via lib/web-whitelist.sanity.ts (geen DB, geen fetch).
// ============================================================================

import { isVeiligeUrl, type Normgewicht } from "./bronsoort";

export type WhitelistMatchtype = "domein" | "domein_subdomeinen" | "padprefix";
export type WhitelistStatus = "actief" | "inactief" | "in_review";

/** Eén whitelist-entry (spiegelt public.bron_whitelist; DB-vrij). */
export interface WhitelistEntry {
  id: string;
  domein: string;
  matchtype: WhitelistMatchtype;
  pad: string | null;
  normgewicht: Normgewicht;
  categorie: string | null;
  tier: string | null;
  status: WhitelistStatus;
  toelichting: string;
  review_datum?: string | null;
}

/** Genormaliseerd hostdomein: lowercase, zonder poort, zonder leidende www. */
export function normaliseerDomein(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
}

/** Tweede-niveau-label (benadering zonder Public Suffix List): het label vóór het
 *  laatste (TLD) label. `belastingdienst.nl` → "belastingdienst";
 *  `toezicht.dnb.nl` → "dnb". Puur voor de look-alike-heuristiek. */
function tweedeNiveauLabel(domein: string): string {
  const delen = normaliseerDomein(domein).split(".").filter(Boolean);
  if (delen.length < 2) return delen[0] ?? "";
  return delen[delen.length - 2];
}

/** Specificiteit voor tie-breaking bij meerdere matches (hoger = specifieker). */
const MATCH_SPECIFICITEIT: Record<WhitelistMatchtype, number> = {
  padprefix: 3,
  domein: 2,
  domein_subdomeinen: 1,
};

// Normgewicht-rang: lager = zwaarder/eerder. Spiegelt de weegvolgorde uit FR-3.
const NORMGEWICHT_RANG: Record<Normgewicht, number> = {
  bindend: 0,
  toezichtverwachting: 1,
  sector_guidance: 2,
  informatief: 3,
  onbekend: 4,
};

/** Matcht één entry tegen een genormaliseerd host + pathname. */
function entryMatcht(entry: WhitelistEntry, host: string, pathname: string): boolean {
  const domein = normaliseerDomein(entry.domein);
  const isZelfdeDomein = host === domein;
  const isSubdomein = host.endsWith("." + domein);

  switch (entry.matchtype) {
    case "domein":
      return isZelfdeDomein;
    case "domein_subdomeinen":
      return isZelfdeDomein || isSubdomein;
    case "padprefix": {
      // Strikt: exact domein (of subdomein) ÉN het pad valt binnen de prefix.
      if (!(isZelfdeDomein || isSubdomein)) return false;
      const prefix = (entry.pad ?? "").trim();
      if (!prefix) return false;
      // Normaliseer de afsluitende slash en match uitsluitend een volledig
      // padsegment. Een prefix `/pensioen` mag dus wel `/pensioen/regeling`
      // toelaten, maar nooit `/pensioen-malware`. De eerdere laatste
      // `pathname.startsWith(p)` maakte die grens alsnog ongedaan.
      const metSlash = prefix.startsWith("/") ? prefix : "/" + prefix;
      const p = metSlash.length > 1 ? metSlash.replace(/\/+$/, "") : metSlash;
      return p === "/" || pathname === p || pathname.startsWith(p + "/");
    }
    default:
      return false;
  }
}

export interface WhitelistMatch {
  entry: WhitelistEntry;
  normgewicht: Normgewicht;
}

/**
 * Herverifieer een opgehaalde URL tegen de whitelist. Geeft de MEEST SPECIFIEKE
 * matchende entry (padprefix > domein > domein+subdomeinen; bij gelijke
 * specificiteit het zwaarste normgewicht) of null als de URL onveilig is óf op
 * geen enkele entry matcht. Overweegt uitsluitend entries die de aanroeper
 * meegeeft — het retrievalpad geeft alleen ACTIEVE entries mee (AC-B6).
 */
export function matchWhitelist(
  url: string,
  entries: WhitelistEntry[]
): WhitelistMatch | null {
  if (!isVeiligeUrl(url)) return null;
  let host = "";
  let pathname = "/";
  try {
    const u = new URL(url);
    host = normaliseerDomein(u.hostname);
    pathname = u.pathname || "/";
  } catch {
    return null;
  }

  const kandidaten = entries
    .filter((e) => entryMatcht(e, host, pathname))
    .sort((a, b) => {
      const spec = MATCH_SPECIFICITEIT[b.matchtype] - MATCH_SPECIFICITEIT[a.matchtype];
      if (spec !== 0) return spec;
      return NORMGEWICHT_RANG[a.normgewicht] - NORMGEWICHT_RANG[b.normgewicht];
    });

  const beste = kandidaten[0];
  return beste ? { entry: beste, normgewicht: beste.normgewicht } : null;
}

/**
 * Bouw de allowed_domains-array voor de Anthropic web_search-tool uit ACTIEVE
 * entries. Best-effort pre-filter (Anthropic dwingt dit server-side af); de harde
 * gate blijft matchWhitelist op de teruggekomen citaties. Voor padprefix geven we
 * `domein/pad` mee; voor domein(+subdomeinen) het kale domein.
 */
export function allowedDomeinenUit(entries: WhitelistEntry[]): string[] {
  const out = new Set<string>();
  for (const e of entries) {
    if (e.status !== "actief") continue;
    const domein = normaliseerDomein(e.domein);
    if (!domein) continue;
    if (e.matchtype === "padprefix" && e.pad) {
      const p = e.pad.startsWith("/") ? e.pad : "/" + e.pad;
      out.add(domein + p);
    } else {
      out.add(domein);
    }
  }
  return [...out];
}

/** Alleen de actieve entries (retrievalpad + allowed_domains). */
export function actieveEntries(entries: WhitelistEntry[]): WhitelistEntry[] {
  return entries.filter((e) => e.status === "actief");
}

/**
 * Herorden webbronnen zodat het zwaarste normgewicht vooraan komt (bindend >
 * toezichtverwachting > sector_guidance > informatief > onbekend), met een
 * STABIELE sortering binnen een normgewichtgroep. Spiegelt weegBronsoort: geen
 * uitsluiting, alleen ordening — een lager gewogen webbron blijft beschikbaar
 * maar wordt nooit als bindende basis vooropgesteld (FR-3 / AC-4).
 */
export function weegWebbronnen<T>(
  items: T[],
  normgewichtVan: (item: T) => Normgewicht | null | undefined
): T[] {
  return items
    .map((item, index) => ({
      item,
      index,
      rang: NORMGEWICHT_RANG[normgewichtVan(item) ?? "onbekend"] ?? NORMGEWICHT_RANG.onbekend,
    }))
    .sort((a, b) => a.rang - b.rang || a.index - b.index)
    .map((x) => x.item);
}

// ── Domeinvalidatie voor het beheerscherm ───────────────────────────────────

/** Geldig domeinformaat: labels (a-z 0-9 -), ≥1 punt, geen scheme/pad/spatie. */
export function isGeldigDomein(domein: unknown): domein is string {
  if (typeof domein !== "string") return false;
  const d = domein.trim().toLowerCase();
  if (!d || d.length > 253) return false;
  if (/[\s/:@?#]/.test(d)) return false; // geen scheme/pad/poort/query
  // labels gescheiden door punten; elk label 1-63 tekens, geen leidend/sluitend '-'.
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d);
}

export interface LookAlikeUitkomst {
  verdacht: boolean;
  /** Het gezaghebbende domein waarop deze invoer verdacht lijkt, of null. */
  lijktOp: string | null;
}

/**
 * Waarschuw voor look-alike-domeinen (bv. `belastingdienst-nl.com` naast het
 * echte `belastingdienst.nl`). Heuristiek: het tweede-niveau-label van de invoer
 * bevat het tweede-niveau-label van een vertrouwd domein, terwijl de invoer niet
 * exact dat domein is en er ook geen subdomein van is. Harde validatie blijft
 * (isGeldigDomein); dit is een compenserende control, geen blokkade.
 */
export function detecteerLookAlike(
  domein: string,
  vertrouwd: string[]
): LookAlikeUitkomst {
  const d = normaliseerDomein(domein);
  const kern = tweedeNiveauLabel(d);
  if (!kern) return { verdacht: false, lijktOp: null };

  for (const t of vertrouwd) {
    const td = normaliseerDomein(t);
    if (d === td || d.endsWith("." + td)) return { verdacht: false, lijktOp: null }; // legitiem (zelf of subdomein)
    const tKern = tweedeNiveauLabel(td);
    if (!tKern || tKern.length < 4) continue; // te korte kern → geen betrouwbaar signaal
    // Verdacht als de invoer-kern het vertrouwde merk-label bevat maar het volledige
    // domein afwijkt (andere TLD, koppelteken-truc, extra label).
    if (kern.includes(tKern) && d !== td) {
      return { verdacht: true, lijktOp: td };
    }
  }
  return { verdacht: false, lijktOp: null };
}
