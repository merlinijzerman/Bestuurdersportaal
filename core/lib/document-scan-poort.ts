// Positief scanbewijs voor alle paden die originele documentbytes gebruiken.
// Bewust een pure helper: routes en workers delen exact dezelfde fail-closed
// interpretatie en de regressietest heeft geen server- of Supabase-context nodig.

const SHA256 = /^[a-f0-9]{64}$/;

export interface DocumentScanBewijs {
  bestand_hash: string | null;
  scan_resultaat: Record<string, unknown> | null;
}

export function heeftSchoonScanbewijs(document: DocumentScanBewijs): boolean {
  const hash = document.bestand_hash;
  const scan = document.scan_resultaat;
  if (!hash || !SHA256.test(hash) || !scan) return false;
  return scan.verdict === "clean" && scan.sha256 === hash;
}

