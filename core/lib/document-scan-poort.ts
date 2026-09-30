// Positief scanbewijs voor alle paden die originele documentbytes gebruiken.
// Bewust een pure helper: routes en workers delen exact dezelfde fail-closed
// interpretatie en de regressietest heeft geen server- of Supabase-context nodig.

const SHA256 = /^[a-f0-9]{64}$/;

export interface DocumentScanBewijs {
  bestand_hash: string | null;
  scan_resultaat: Record<string, unknown> | null;
}

export interface DocumentBeschikbaarheid extends DocumentScanBewijs {
  actief: boolean;
  opslag_pad: string | null;
  geindexeerd: boolean;
  documentdatum?: string | null;
}

export function heeftSchoonScanbewijs(document: DocumentScanBewijs): boolean {
  const hash = document.bestand_hash;
  const scan = document.scan_resultaat;
  if (!hash || !SHA256.test(hash) || !scan) return false;
  return scan.verdict === "clean" && scan.sha256 === hash;
}

/**
 * De serverwaarheid voor het tonen/downloaden van een origineel. Een schoon,
 * hash-gebonden verdict is voldoende: AI-extractie mag daarna nog bezig zijn of
 * zelfs mislukken zonder een aantoonbaar veilig origineel opnieuw te blokkeren.
 */
export function isOrigineelBeschikbaar(
  document: DocumentBeschikbaarheid,
  malwareScanAan: boolean
): boolean {
  if (!document.actief || !document.opslag_pad) return false;
  return !malwareScanAan || heeftSchoonScanbewijs(document);
}

/**
 * Conservatieve UI-projectie voor documentgerichte AI. De centrale retrieval-
 * poort controleert het versiebewijs nogmaals per passage; deze projectie zorgt
 * dat de knop niet al wordt aangeboden als het document aantoonbaar niet aan de
 * minimale voorwaarden voldoet.
 */
export function isAiContextBeschikbaar(
  document: DocumentBeschikbaarheid,
  malwareScanAan: boolean
): boolean {
  if (!document.actief || !document.geindexeerd) return false;
  if (malwareScanAan && !heeftSchoonScanbewijs(document)) return false;
  return (
    (typeof document.bestand_hash === "string" && SHA256.test(document.bestand_hash)) ||
    (typeof document.documentdatum === "string" && document.documentdatum.length > 0)
  );
}

/** WP3 staat aan: uitsluitend de exacte waarde "true" (zoals overal elders). */
export function isMalwarescanAan(): boolean {
  return process.env.WP3_MALWARESCAN_AAN === "true";
}

/**
 * Leespoort voor afgeleide inhoud (chunks) onder WP3. Een chunk mag alleen naar
 * een model of gebruiker als zijn document een schoon, hash-gebonden scanbewijs
 * heeft. Bewust fail-closed: ontbreken de velden in de select, dan valt de chunk
 * af. Zonder WP3 is dit een no-op (gedrag van vóór de malwarescan).
 */
export function handhaafScanbewijs<
  T extends { documenten: { bestand_hash?: string | null; scan_resultaat?: Record<string, unknown> | null } }
>(chunks: readonly T[], malwareScanAan: boolean): { chunks: T[]; gedropt: number } {
  if (!malwareScanAan) return { chunks: [...chunks], gedropt: 0 };
  const behouden = chunks.filter((c) =>
    heeftSchoonScanbewijs({
      bestand_hash: c.documenten?.bestand_hash ?? null,
      scan_resultaat: c.documenten?.scan_resultaat ?? null,
    })
  );
  return { chunks: behouden, gedropt: chunks.length - behouden.length };
}
