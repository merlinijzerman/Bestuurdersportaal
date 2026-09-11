// ============================================================================
//  #367 — Providerneutrale bron-, passage-, versie- en citatie-identiteit.
// ----------------------------------------------------------------------------
//  Publieke identiteiten zijn afgeleide SHA-256-sleutels. Een Graph drive/item-
//  id, opslagpad of database-UUID verlaat de adaptergrens daardoor niet als
//  identiteit. Lengteprefixen maken de canonieke invoer ondubbelzinnig.
// ============================================================================
import { createHash } from "node:crypto";

function canoniek(delen: readonly string[]): string {
  return delen.map((deel) => `${Buffer.byteLength(deel, "utf8")}:${deel}`).join("|");
}

function sleutel(prefix: "doc" | "passage" | "citation" | "version", delen: readonly string[]): string {
  const digest = createHash("sha256").update(canoniek([`bestuurdersportaal:${prefix}:v1`, ...delen])).digest("hex");
  return `${prefix}_v1_${digest}`;
}

/** Adapterprivate bronreferenties erin; alleen de afgeleide sleutel eruit. */
export function maakDocumentIdentiteit(namespace: string, bronreferentie: string): string {
  return sleutel("doc", [namespace, bronreferentie]);
}

/** Stabiel zolang document en logische passage gelijk blijven. */
export function maakPassageIdentiteit(documentIdentiteit: string, passageSleutel: string): string {
  return sleutel("passage", [documentIdentiteit, passageSleutel]);
}

/** R1: volledige versie-identiteit over exact deze drie adapterprivate waarden. */
export function maakVolledigeVersieHash(
  documentReferentie: string,
  indexeringVersie: string,
  bestandHash: string
): string {
  return sleutel("version", [documentReferentie, indexeringVersie, bestandHash]);
}

/** Hernoemen/verplaatsen telt niet mee; bron, passage en versie wel. */
export function maakCitationId(
  documentIdentiteit: string,
  passageIdentiteit: string,
  versieSoort: string,
  versieWaarde: string
): string {
  return sleutel("citation", [documentIdentiteit, passageIdentiteit, versieSoort, versieWaarde]);
}
