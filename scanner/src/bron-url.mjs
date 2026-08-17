// ============================================================================
//  scanner/src/bron-url.mjs — harde allowlist voor de bron-URL van een scan.
// ----------------------------------------------------------------------------
//  De scanner haalt een door de aanroeper aangeleverde URL op. Dat is per
//  definitie een SSRF-oppervlak: een gestolen token of een fout in de
//  beheerworker mag de container niet naar interne, lokale of willekeurige
//  externe adressen laten grijpen. Vercel-containerimages ondersteunen (nog)
//  geen Secure Compute of Static IPs, dus er is geen netwerklaag die dit
//  achtervangt — deze module ís de poort.
//
//  Zuiver en synchroon: geen DNS, geen netwerk, geen I/O. Alles wat hier
//  faalt, faalt vóórdat er ook maar een socket opengaat. Getest in
//  test/bron-url.test.mjs.
//
//  Fail-closed: alleen een URL die élke controle doorstaat komt eruit. Er is
//  bewust geen "waarschuwing"-uitkomst.
// ============================================================================

/** Gesloten verzameling weigergronden. Nooit vrije tekst — dit gaat het
 *  auditspoor in en mag geen aanvallerinvoer bevatten. */
export const BRON_URL_FOUTCODES = /** @type {const} */ ([
  "url_onparseerbaar",
  "url_te_lang",
  "protocol_niet_https",
  "credentials_in_url",
  "fragment_in_url",
  "hostname_niet_toegestaan",
  "ip_literal",
  "poort_niet_toegestaan",
  "pad_niet_toegestaan",
  "objectsleutel_ongeldig",
]);

// De objectsleutel binnen de quarantainebucket is volledig deterministisch en
// wordt server-side gemunt: `<fonds-uuid>/<document-uuid>.<ext>` voor de
// tenant-upload, `generiek/<document-uuid>.<ext>` voor platformcuratie. Zie
// QUARANTAINE_PAD_PATROON in platform/lib/generiek-pipeline.ts — dit is
// dezelfde gedachte, hier toegepast op de scannerkant.
//
// Bewust een ALLOWLIST op de vorm in plaats van een blacklist op
// traversalpatronen. Een blacklist is hier aantoonbaar lek: de WHATWG-parser
// collapst `..`, `%2e%2e` en `.%2e` (die vangt de prefix-toets), en
// `..%2f`/`%5c` zijn met een decodeerstap te vangen — maar dubbel-encoded
// `%252e%252e` overleeft beide en behoudt de prefix. Met deze vormtoets faalt
// elke encodingtruc per constructie, omdat `%` simpelweg niet in het patroon zit.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const OBJECTSLEUTEL_PATROON = new RegExp(
  `^(?:${UUID}|generiek)\\/${UUID}\\.(?:pdf|docx|pptx|xlsx)$`
);

// Een signed URL van Supabase Storage is ruim onder deze grens; een langere
// invoer is per definitie geen legitiem pad en hoeft niet ontleed te worden.
const MAX_URL_LENGTE = 2048;

// Hostnames die als IP-literal moeten worden geweigerd. WHATWG-URL normaliseert
// IPv4 al (0x7f.1 → 127.0.0.1) en zet IPv6 tussen blokhaken, dus na parsing is
// deze toets betrouwbaar. Decimale/octale notaties komen er genormaliseerd uit.
const IPV4_PATROON = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * @param {string} hostname genormaliseerde hostname uit een geparste URL
 * @returns {boolean}
 */
function isIpLiteral(hostname) {
  // WHATWG-URL levert IPv6 als "[::1]" — inclusief blokhaken.
  if (hostname.startsWith("[")) return true;
  return IPV4_PATROON.test(hostname);
}

/**
 * Toetst een aangeleverde bron-URL tegen de allowlist.
 *
 * @param {unknown} ruw de URL zoals aangeleverd door de aanroeper
 * @param {{ supabaseHost: string, bucket: string }} config
 *   supabaseHost — exact het projecthostname, bv. "abc123.supabase.co"
 *   bucket       — exact de toegestane bucket, bv. "documenten-quarantaine"
 * @returns {{ ok: true, url: URL } | { ok: false, code: string }}
 */
export function beoordeelBronUrl(ruw, config) {
  if (typeof ruw !== "string" || ruw.length === 0) {
    return { ok: false, code: "url_onparseerbaar" };
  }
  if (ruw.length > MAX_URL_LENGTE) {
    return { ok: false, code: "url_te_lang" };
  }

  let url;
  try {
    url = new URL(ruw);
  } catch {
    return { ok: false, code: "url_onparseerbaar" };
  }

  // 1. Uitsluitend https. Plain HTTP is niet alleen onversleuteld maar ook het
  //    gangbare pad naar metadata-endpoints en interne diensten.
  if (url.protocol !== "https:") {
    return { ok: false, code: "protocol_niet_https" };
  }

  // 2. Geen credentials in de URL. `https://user:pass@host/` kan bij sommige
  //    parsers de host-interpretatie verschuiven en lekt bovendien geheimen
  //    naar logs van tussenliggende lagen.
  if (url.username !== "" || url.password !== "") {
    return { ok: false, code: "credentials_in_url" };
  }

  // 3. Geen fragment. Een fragment gaat nooit mee over de lijn maar kan wel
  //    een naïeve padvergelijking verderop misleiden.
  if (url.hash !== "") {
    return { ok: false, code: "fragment_in_url" };
  }

  // 4. Hostname exact gelijk aan het geconfigureerde Supabase-project.
  //    Bewust geen suffix-match: "kwaadaardig-abc123.supabase.co" en
  //    "abc123.supabase.co.aanvaller.nl" moeten beide sneuvelen.
  const host = url.hostname.toLowerCase();
  if (host !== config.supabaseHost.toLowerCase()) {
    return { ok: false, code: "hostname_niet_toegestaan" };
  }

  // 5. Geen IP-literal. Staat na de hostname-toets omdat een IP nooit gelijk
  //    kan zijn aan het geconfigureerde hostname — maar het blijft als
  //    zelfstandige controle staan zodat een misconfiguratie van
  //    `supabaseHost` (bv. per ongeluk een IP) hier alsnog vastloopt.
  if (isIpLiteral(host)) {
    return { ok: false, code: "ip_literal" };
  }

  // 6. Alleen de standaardpoort. WHATWG-URL maakt `url.port` leeg bij 443.
  if (url.port !== "") {
    return { ok: false, code: "poort_niet_toegestaan" };
  }

  // 7. Pad moet exact in de signed-object-zone van de quarantainebucket liggen.
  //    `url.pathname` is door de parser al genormaliseerd, dus een pad met
  //    `..` of `%2e%2e` is hier al buiten de prefix gecollapst en valt af.
  const vereistPrefix = `/storage/v1/object/sign/${config.bucket}/`;
  if (!url.pathname.startsWith(vereistPrefix)) {
    return { ok: false, code: "pad_niet_toegestaan" };
  }

  // 8. Wat ná de prefix komt moet exact de deterministische objectsleutel zijn.
  //    Dit sluit elke resterende encodingtruc uit: het patroon laat geen `%`,
  //    geen `\` en geen puntsegmenten toe, dus dubbel-encoded traversal
  //    (`%252e%252e`) en encoded slashes (`..%2f`) falen hier hoe dan ook.
  const objectsleutel = url.pathname.slice(vereistPrefix.length);
  if (!OBJECTSLEUTEL_PATROON.test(objectsleutel)) {
    return { ok: false, code: "objectsleutel_ongeldig" };
  }

  return { ok: true, url };
}
