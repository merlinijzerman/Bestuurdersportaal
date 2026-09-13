// ============================================================================
//  #322 F4-T1 — Volgorde-gecodeerde projectie van een retrievaluitkomst.
// ----------------------------------------------------------------------------
//  WAAROM DIT BESTAAT (bevinding F4-T1, tweede ronde)
//
//  `normaliseerJson()` sorteert ELKE array recursief op genormaliseerde inhoud
//  (normaliseer.mjs §2). Dat is voor 380 snapshots precies goed — het maakt ze
//  onafhankelijk van de rijvolgorde die PostgREST toevallig teruggeeft. Maar
//  voor retrieval is de volgorde juist HET resultaat: de rangorde van de
//  kandidaten IS de ranking. Een w322-snapshot dat alleen door
//  `normaliseerJson()` gaat, is dus byte-identiek groen nadat de ranking is
//  omgedraaid. Empirisch vastgesteld op
//  `w322.zoeken.get.bestuurder.premiebeleid`: treffers omgekeerd → geen verschil.
//
//  De oplossing is NIET om de gedeelde normalisatie te versoepelen (dat raakt
//  alle bestaande snapshots), maar om de volgorde IN DE WAARDE te zetten. Elke
//  regel begint met haar nulgebaseerde positie; sorteren kan die positie dan
//  niet meer wegpoetsen, terwijl de projectie zelf sorteerstabiel blijft.
//
//  De projectie draagt uitsluitend structuur en identiteit — nooit brontekst.
//  Fragmenten gaan als sha256-prefix mee, zodat een gewijzigde passage zichtbaar
//  wordt zonder documentinhoud in een snapshot vast te leggen.
// ============================================================================
import { createHash } from "node:crypto";

const POSITIE_BREEDTE = 2;

/** "00", "01", … — lexicografisch sorteerbaar tot 100 elementen. */
function positie(i) {
  return String(i).padStart(POSITIE_BREEDTE, "0");
}

/** Korte, inhoudsvrije vingerafdruk van een passage. */
export function passageHash(tekst) {
  if (typeof tekst !== "string") return "geen";
  return createHash("sha256").update(tekst).digest("hex").slice(0, 12);
}

/**
 * Volgorde van `GET /api/zoeken`: de documentvolgorde (= relevantie van de
 * eerste treffer) en, per document, de trefferregels in hun eigen volgorde.
 * UUID's blijven staan; `normaliseerJson()` mapt ze daarna naar `<uuid:N>`.
 */
export function zoekVolgorde(body) {
  const resultaten = Array.isArray(body?.resultaten) ? body.resultaten : [];
  return {
    documenten: resultaten.map((r, i) => `${positie(i)} doc=${r?.document_id ?? "geen"} bib=${r?.bibliotheek ?? "geen"} status=${r?.documentstatus ?? "geen"}`),
    treffers: resultaten.flatMap((r, i) =>
      (Array.isArray(r?.treffers) ? r.treffers : []).map(
        (t, j) => `${positie(i)}.${positie(j)} doc=${r?.document_id ?? "geen"} pagina=${t?.pagina ?? "geen"} paragraaf=${t?.paragraaf ?? "geen"} lengte=${typeof t?.fragment === "string" ? t.fragment.length : -1} sha=${passageHash(t?.fragment)}`
      )
    ),
  };
}

/**
 * Volgorde binnen een `retrieval_meta`: de kandidaat-/selectievolgorde
 * (`chunks`), de volgorde van de bronversie-audit en die van de
 * retrievalpogingen. Dit zijn de drie arrays waarin de ranking zichtbaar is.
 */
export function metaVolgorde(meta) {
  if (!meta || typeof meta !== "object") return null;
  const chunks = Array.isArray(meta.chunks) ? meta.chunks : [];
  const audit = Array.isArray(meta.bronversie_audit) ? meta.bronversie_audit : [];
  const pogingen = Array.isArray(meta.retrieval_pogingen) ? meta.retrieval_pogingen : [];
  // `poging_herkomst` is een object met CHUNK-ID's als SLEUTEL, en `mapUuids()`
  // maskeert alleen string-waarden — geen sleutels. Onbewerkt zou dit blok dus
  // rauwe seed-UUID's in het snapshot zetten, die bij elke herseed omvallen.
  // De projectie zet de herkomst daarom om naar waarden, gekoppeld aan de
  // positie van de chunk in de kandidatenset.
  const herkomst = meta.poging_herkomst && typeof meta.poging_herkomst === "object" ? meta.poging_herkomst : null;
  return {
    chunks: chunks.map((c, i) => `${positie(i)} chunk=${c?.id ?? "geen"} doc=${c?.document_id ?? "geen"} rang=${c?.rang ?? "geen"} fts=${c?.fts_rang ?? "geen"} vec=${c?.vec_rang ?? "geen"}`),
    poging_herkomst: herkomst === null ? null : chunks.map((c, i) => `${positie(i)} chunk=${c?.id ?? "geen"} poging=${herkomst[c?.id] ?? "geen"}`),
    bronversie_audit: audit.map((b, i) => `${positie(i)} doc=${b?.document_id ?? "geen"} docid=${b?.document_identiteit ?? "geen"} passage=${b?.passage_identiteit ?? "geen"} citation=${b?.citation_id ?? "geen"} versie=${b?.versie?.soort ?? "geen"}:${b?.versie?.waarde ?? "geen"} bib=${b?.bibliotheek ?? "geen"} fonds=${b?.fonds_id ?? "geen"} docstatus=${b?.documentstatus ?? "geen"} bronstatus=${b?.bronstatus ?? "geen"} datum=${b?.documentdatum ?? "geen"}`),
    retrieval_pogingen: pogingen.map((p, i) => `${positie(i)} naam=${p?.naam ?? "geen"} rijen=${p?.rijen ?? "geen"} overgeslagen=${p?.overgeslagen === true}`),
  };
}
