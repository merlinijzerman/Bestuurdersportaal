// lib/aqlab/diff.ts
// -----------------------------------------------------------------------------
// AQLab — pure woord-niveau tekst-diff (AQL-3, scherm 4 + scherm 6b). Geen lib,
// geen chart-dep. Levert segmenten voor de outputvergelijking (baseline vs
// challenger) en de iteratie-vergelijking (verboden-variatie-markering).
//
// Algoritme: LCS op woord-tokens (whitespace behouden als eigen token zodat de
// weergave leesbaar blijft). Puur → sanity-testbaar.
// -----------------------------------------------------------------------------

export type DiffType = "gelijk" | "toegevoegd" | "verwijderd";

export interface DiffSegment {
  type: DiffType;
  tekst: string;
}

/** Splitst op woorden én whitespace (beide als tokens) zodat reconstructie klopt. */
function tokeniseer(s: string): string[] {
  return s.match(/\s+|[^\s]+/g) ?? [];
}

/**
 * Woord-niveau diff van `oud` → `nieuw`. `verwijderd` = alleen in oud (baseline),
 * `toegevoegd` = alleen in nieuw (challenger), `gelijk` = in beide.
 */
export function woordDiff(oud: string, nieuw: string): DiffSegment[] {
  const a = tokeniseer(oud);
  const b = tokeniseer(nieuw);
  const n = a.length;
  const m = b.length;

  // LCS-lengtetabel (n+1)×(m+1).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ruw: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ruw.push({ type: "gelijk", tekst: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ruw.push({ type: "verwijderd", tekst: a[i] });
      i++;
    } else {
      ruw.push({ type: "toegevoegd", tekst: b[j] });
      j++;
    }
  }
  while (i < n) ruw.push({ type: "verwijderd", tekst: a[i++] });
  while (j < m) ruw.push({ type: "toegevoegd", tekst: b[j++] });

  // Aangrenzende segmenten van hetzelfde type samenvoegen (leesbaarheid).
  const uit: DiffSegment[] = [];
  for (const seg of ruw) {
    const laatste = uit[uit.length - 1];
    if (laatste && laatste.type === seg.type) laatste.tekst += seg.tekst;
    else uit.push({ ...seg });
  }
  return uit;
}

/** True als de diff inhoudelijke (niet louter witruimte) wijzigingen bevat. */
export function heeftVerschil(segmenten: DiffSegment[]): boolean {
  return segmenten.some((s) => s.type !== "gelijk" && s.tekst.trim().length > 0);
}
