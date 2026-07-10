// lib/aqlab/seed/canonical.ts
// -----------------------------------------------------------------------------
// Canonical-text-extractie + sha256 voor de Horizon-fixtures.
// Port van aqlab_seed_dryrun.py (extract_canonical/canonical/sha), zodat de TS-
// loader dezelfde reproduceerbare bronreferentie (content_hash) berekent.
//
// Conventie (seed-YAML content_hash_convention): sha256 over de "Volledige
// synthetische tekst"-blockquote, LF line-endings, trailing whitespace per
// regel verwijderd, exact één trailing newline, UTF-8. Zonder runtime-metadata.
// -----------------------------------------------------------------------------
import { createHash } from 'node:crypto';

/** Normaliseer de blockquote-regels naar canonieke tekst. */
function canonical(qlines: string[]): string {
  const out: string[] = [];
  for (let ln of qlines) {
    ln = ln.replace(/\s+$/, ''); // rstrip
    if (ln.startsWith('> ')) ln = ln.slice(2);
    else if (ln === '>') ln = '';
    out.push(ln.replace(/\s+$/, ''));
  }
  // strip('\n') + exact één trailing newline
  return out.join('\n').replace(/^\n+/, '').replace(/\n+$/, '') + '\n';
}

/** sha256-hex over UTF-8 tekst. */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Extraheer canonical_text per fixture-ID uit AQLAB-HORIZON-FIXTURES-v0.2.md.
 * FIX-10 (BRONSET-MEERVOUD) wordt in drie aparte canonical_texts gesplitst.
 */
export function extractCanonical(md: string): Record<string, string> {
  const texts: Record<string, string> = {};
  const headRe = /\n# FIX-\d+ ·[ ]*(.+)/g;
  const heads: { pos: number; idline: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headRe.exec(md)) !== null) {
    heads.push({ pos: m.index, idline: m[1].trim() });
  }
  const consistentieMark = md.indexOf('\n# Consistentienoot');

  for (let i = 0; i < heads.length; i++) {
    const start = heads[i].pos;
    const end = i + 1 < heads.length ? heads[i + 1].pos : consistentieMark !== -1 ? consistentieMark : md.length;
    const body = md.slice(start, end);
    const mm = /Volledige synthetische tekst[^\n]*\n+((?:>.*\n?)+)/.exec(body);
    if (!mm) continue;
    const ctext = canonical(mm[1].split('\n'));
    const idline = heads[i].idline;

    if (idline.includes('BRONSET-MEERVOUD')) {
      const parts = ctext
        .split(/(?=\*\*Bron [123] —)/)
        .filter((p) => p.trimStart().startsWith('**Bron'));
      parts.forEach((p, j) => {
        texts[`HORIZON-BRONSET-MEERVOUD-00${j + 1}`] = p.replace(/^\n+/, '').replace(/\n+$/, '') + '\n';
      });
    } else {
      texts[idline.split(/\s+/)[0]] = ctext;
    }
  }
  return texts;
}
