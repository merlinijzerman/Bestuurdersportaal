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
//    Headers     → alleen content-type en content-disposition; x-request-id en
//                  date uitgesloten.
//
//  Elke uitbreiding van deze regels hoort een BESLUIT:-comment bij issue #88.
//  Voeg NOOIT een regel toe alleen om een diff weg te poetsen.
// ============================================================================

const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
// ISO-8601 met optionele fractie/zone; ook de spatie-variant (Postgres) toegestaan.
const TS_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g;

const HEADER_WHITELIST = ["content-type", "content-disposition"];

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

/** Filter + normaliseer headers tot de vergeleken deelverzameling. */
export function normaliseerHeaders(headers) {
  const out = {};
  for (const naam of HEADER_WHITELIST) {
    const waarde = headers.get(naam);
    if (waarde != null) out[naam] = waarde.replace(TS_RE, "<ts>").replace(UUID_RE, "<uuid>");
  }
  return out;
}

/** Alleen het pad van een (signed) redirect-URL — token/expiry weg. */
export function locatiePad(location) {
  if (!location) return null;
  try {
    return new URL(location, "http://x").pathname;
  } catch {
    return location.split("?")[0];
  }
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
