// ============================================================================
//  W1 — Normalisatielaag (§2 van het ticket + BESLUIT #88).
// ----------------------------------------------------------------------------
//  Zet een respons om in een stabiele, canonieke vorm zodat twee runs op
//  ongewijzigde code byte-identieke snapshots geven. Bronnen van variatie en
//  hun behandeling:
//
//    UUID's      → stabiele mapping per snapshot: <uuid:1>, <uuid:2>, … in
//                  volgorde van eerste voorkomen in de canonieke traversal.
//    Timestamps  → <ts> (ISO-8601).
//    Array-orde  → arrays worden gesorteerd op hun genormaliseerde inhoud
//                  (UUID's gemaskeerd), zodat een DB-volgorde zonder ORDER BY
//                  niet als verschil telt.
//    Headers     → alleen content-type en content-disposition; per scenario uit
//                  te breiden via `headersExtra`. x-request-id en date uit.
//    Datums      → in HEADERS ook de kale kalenderdatum (YYYY-MM-DD) → <datum>.
//                  Alleen in headers, nooit in bodies.
//
//  Elke uitbreiding van deze regels hoort een BESLUIT:-comment bij issue #88.
//  Voeg NOOIT een regel toe alleen om een diff weg te poetsen.
// ============================================================================

const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
// ISO-8601 met optionele fractie/zone; ook de spatie-variant (Postgres) toegestaan.
const TS_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g;

// BESLUIT (W5, #101): `x-content-type-options` NIET in de globale whitelist.
//
// Het W5-ticket vraagt die header voor de downloadroutes te karakteriseren.
// Gemeten vóór het overnemen: `nosniff` komt uit `securityHeaders` in
// `next.config.ts` en staat daarmee op ELKE respons van de applicatie. Globaal
// toevoegen wijzigde alle 335 bestaande snapshots tegelijk — een re-record van
// de hele suite die over de wrapper niets bewijst, want de route zet de header
// niet.
//
// Wat hij wél kan: een route MAG de globale header overschrijven. Voor de vier
// downloadroutes is dat het interessante geval. De whitelist is daarom per
// scenario uit te breiden (`headersExtra`), zodat precies die routes de header
// in hun snapshot dragen en de overige 335 onaangeroerd blijven.
//
// De bronzijde is al bewaakt: `WP3-10` in tests/cross-tenant/wp3-malwarescan.test.ts
// eist de letterlijke nosniff-regel in app/api/documents/[id]/bestand/route.ts.
const HEADER_WHITELIST = ["content-type", "content-disposition"];

// BESLUIT (W5, #101): kale kalenderdatum → <datum>, UITSLUITEND in headers.
// `auditdossier` en `stuk-export` zetten een YYYY-MM-DD-stempel in de
// content-disposition-bestandsnaam. TS_RE vangt die niet (geen tijddeel), dus
// zonder deze regel verloopt elk downloadsnapshot om middernacht — een rode CI
// die niets over de code zegt. Bewust NIET op bodies: daar zou hij echte
// verschillen kunnen maskeren, en een body met een datum erin karakteriseren we
// via `verwacht: "bestand"` (lengte i.p.v. hash), niet via normalisatie.
const DATUM_RE = /\d{4}-\d{2}-\d{2}/g;

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// 1. Vervang timestamps in alle strings.
function vervangTimestamps(node) {
  if (typeof node === "string") return node.replace(TS_RE, "<ts>");
  if (Array.isArray(node)) return node.map(vervangTimestamps);
  if (isObject(node)) {
    const out = {};
    for (const k of Object.keys(node)) out[k] = vervangTimestamps(node[k]);
    return out;
  }
  return node;
}

// Maskeer UUID's voor een orde-onafhankelijke sorteersleutel.
function maskeerUuids(node) {
  if (typeof node === "string") return node.replace(UUID_RE, "<uuid>");
  if (Array.isArray(node)) return node.map(maskeerUuids);
  if (isObject(node)) {
    const out = {};
    for (const k of Object.keys(node).sort()) out[k] = maskeerUuids(node[k]);
    return out;
  }
  return node;
}

function sorteersleutel(node) {
  return JSON.stringify(maskeerUuids(node));
}

// 2. Sorteer arrays recursief op genormaliseerde inhoud.
function sorteerArrays(node) {
  if (Array.isArray(node)) {
    const kinderen = node.map(sorteerArrays);
    return kinderen
      .map((el) => ({ el, key: sorteersleutel(el) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((x) => x.el);
  }
  if (isObject(node)) {
    const out = {};
    for (const k of Object.keys(node)) out[k] = sorteerArrays(node[k]);
    return out;
  }
  return node;
}

// 3. Map UUID's naar <uuid:N> in canonieke traversal (objectsleutels gesorteerd,
//    arrays al gesorteerd). Registreren en vervangen in één canonieke volgorde.
function mapUuids(node, mapping) {
  if (typeof node === "string") {
    return node.replace(UUID_RE, (m) => {
      const sleutel = m.toLowerCase();
      if (!mapping.has(sleutel)) mapping.set(sleutel, `<uuid:${mapping.size + 1}>`);
      return mapping.get(sleutel);
    });
  }
  if (Array.isArray(node)) return node.map((el) => mapUuids(el, mapping));
  if (isObject(node)) {
    const out = {};
    for (const k of Object.keys(node).sort()) out[k] = mapUuids(node[k], mapping);
    return out;
  }
  return node;
}

/** Normaliseer een geparste JSON-body naar canonieke vorm. */
export function normaliseerJson(body) {
  const stap1 = vervangTimestamps(body);
  const stap2 = sorteerArrays(stap1);
  const stap3 = mapUuids(stap2, new Map());
  return stap3;
}

/** Filter + normaliseer headers tot de vergeleken deelverzameling.
 *  `extra` breidt de whitelist uit voor één scenario (zie het BESLUIT hierboven). */
export function normaliseerHeaders(headers, extra = []) {
  const out = {};
  for (const naam of [...HEADER_WHITELIST, ...extra]) {
    const waarde = headers.get(naam);
    if (waarde != null)
      out[naam] = waarde
        .replace(TS_RE, "<ts>")
        .replace(DATUM_RE, "<datum>")
        .replace(UUID_RE, "<uuid>");
  }
  return out;
}

/**
 * De VORM van een (signed) redirect-URL: origin + padpatroon + geredigeerde
 * queryparameters. Nooit het token zelf — dat verschilt per run en leeft 60s.
 *
 * BESLUIT (W5, #101): dit verving `locatiePad()`, dat alleen het PAD teruggaf.
 * Daarmee stond er niets in het snapshot over WAARHEEN de 307 wijst: een
 * redirect naar een vreemde host met hetzelfde pad was byte-identiek groen. Voor
 * de enige 307-route van het platform (het afschrift met stemgedrag) is precies
 * die host het punt. `supabaseOrigin` wordt tot `<supabase>` genormaliseerd —
 * dat maakt de assertie "hij wijst naar ONZE storage" omgevingsonafhankelijk,
 * terwijl elke andere host letterlijk in het snapshot verschijnt en dus rood
 * wordt. Het bestaande snapshot `afschrift-download.get.bestuurder.307` is
 * hiervoor opnieuw opgenomen op ONGEWIJZIGDE routecode.
 */
export function locatieVorm(location, supabaseOrigin) {
  if (!location) return null;
  let url;
  try {
    url = new URL(location, "http://onbekend.invalid");
  } catch {
    return location.split("?")[0];
  }
  let origin = url.origin;
  if (supabaseOrigin) {
    try {
      if (origin === new URL(supabaseOrigin).origin) origin = "<supabase>";
    } catch {
      /* onbruikbare env: laat de letterlijke origin staan */
    }
  }
  if (origin === "http://onbekend.invalid") origin = ""; // relatieve redirect
  const pad = url.pathname.replace(UUID_RE, "<uuid>");
  const namen = [...url.searchParams.keys()].sort();
  const query = namen.length ? `?${namen.map((n) => `${n}=<geredigeerd>`).join("&")}` : "";
  return `${origin}${pad}${query}`;
}

/** Canonieke, stabiel gesorteerde JSON-serialisatie voor snapshot + diff. */
export function stabielJson(node) {
  return JSON.stringify(sorteerObjectSleutels(node), null, 2) + "\n";
}

function sorteerObjectSleutels(node) {
  if (Array.isArray(node)) return node.map(sorteerObjectSleutels);
  if (isObject(node)) {
    const out = {};
    for (const k of Object.keys(node).sort()) out[k] = sorteerObjectSleutels(node[k]);
    return out;
  }
  return node;
}
