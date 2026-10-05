// ============================================================================
//  scripts/meting/548-generieke-pdf-meting.mts — vóór/na-meting #548.
// ----------------------------------------------------------------------------
//  Lokaal en reproduceerbaar: geen database, geen modelcalls, geen OCR. Meet
//  de extractie + chunkbouw van de checkout waarin het draait. Vóór/na = het
//  script draaien op een checkout van main én op de #548-branch:
//    • valse artikelkoppen: een artikel-unit waarvan de chunk met een kleine
//      letter "artikel" begint (afgebroken verwijzing, "artikel 102a, heeft …");
//    • afbrekingsresten: "woord-" + witruimte + kleine letter in chunktekst;
//    • drukvoeten in chunktekst (Kamerstuk-paginavoet, ISSN, kst-nummer);
//    • chunks, structuurlabels en de indexeringsversie;
//    • controlepunten: zinsnede → verwachte pagina en (optioneel) label.
//
//  Gebruik:
//    npx tsx scripts/meting/548-generieke-pdf-meting.mts <manifest.json>
//  Het manifest is een lijst van
//    { bestand, bestandstype?, documenttype?, subtype?, controles?: [{ zinsnede, pagina, label? }] }
//  Bestanden staan buiten de repo (openbare Kamerstukken) of zijn testfixtures.
//  Voorbeeld: scripts/meting/548-manifest.voorbeeld.json — kopieer het naar een
//  map met https://zoek.officielebekendmakingen.nl/kst-36067-90.pdf en
//  …/kst-36067-3.pdf en pas de relatieve paden naar de repo-fixtures aan.
//  Uitvoer: één JSON-regel per document.
// ============================================================================

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { extractTekst, type Bestandstype } from "../../core/lib/document-extractie";
import { bouwChunkRecordsZonderVerrijking, type ChunkRecord } from "../../core/lib/chunk-bouw";

interface Controle {
  zinsnede: string;
  pagina: number;
  label?: string;
}
interface ManifestRegel {
  bestand: string;
  bestandstype?: string;
  documenttype?: string;
  subtype?: string;
  controles?: Controle[];
}

const RE_AFBREKING = /[a-zà-ÿ]-\s+(?!(?:en|of|tot|noch|dan|als|naar|maar|respectievelijk)\b)[a-zà-ÿ]/g;
const RE_DRUKVOET = /(?:Tweede|Eerste) Kamer, vergaderjaar \d{4}|ISSN \d{4}|kst-\d+-\d+/g;

function meet(records: ChunkRecord[], controles: Controle[]) {
  // Een valse kop OPENT een nieuwe artikel-unit (ander label dan de vorige
  // chunk) met een kleine-letterverwijzing. Een vervolgchunk die midden in een
  // zin met "artikel …" begint en het lopende label erft, is geen kop.
  const valseKoppen = records.filter(
    (r, i) =>
      r.structuur_type === "artikel" &&
      /^\s*artikel\s/.test(r.tekst) &&
      r.structuur_label !== records[i - 1]?.structuur_label
  );
  const afbrekingen = records.reduce((n, r) => n + (r.tekst.match(RE_AFBREKING)?.length ?? 0), 0);
  const drukvoeten = records.reduce((n, r) => n + (r.tekst.match(RE_DRUKVOET)?.length ?? 0), 0);
  const labels = new Set(records.map((r) => r.structuur_label).filter(Boolean));
  const artikelLabels = [...labels].filter((l) => /Artikel/.test(l!));
  const uitkomsten = controles.map((c) => {
    const genormaliseerd = (t: string) => t.replace(/\s+/g, " ");
    const treffer = records.find((r) => genormaliseerd(r.tekst).includes(c.zinsnede));
    const paginaOk = treffer?.pagina === c.pagina;
    const labelOk = c.label === undefined || treffer?.structuur_label === c.label;
    return {
      zinsnede: c.zinsnede.slice(0, 50),
      gevonden: Boolean(treffer),
      pagina: treffer?.pagina ?? null,
      label: treffer?.structuur_label ?? null,
      ok: Boolean(treffer) && paginaOk && labelOk,
    };
  });
  return {
    chunks: records.length,
    valseArtikelkoppen: valseKoppen.length,
    valseVoorbeelden: valseKoppen.slice(0, 3).map((r) => `${r.structuur_label} (p. ${r.pagina})`),
    afbrekingsresten: afbrekingen,
    drukvoeten,
    labels: labels.size,
    artikelLabels: artikelLabels.slice(0, 12),
    controles: uitkomsten,
  };
}

const manifestPad = resolve(process.argv[2] ?? "");
const manifest = JSON.parse(readFileSync(manifestPad, "utf8")) as ManifestRegel[];
const basis = dirname(manifestPad);

for (const regel of manifest) {
  const buffer = readFileSync(resolve(basis, regel.bestand));
  const t0 = performance.now();
  const extractie = await extractTekst(buffer, (regel.bestandstype ?? "pdf") as Bestandstype);
  const t1 = performance.now();
  const records = bouwChunkRecordsZonderVerrijking({
    documentId: "meting",
    segmenten: extractie.segmenten,
    documenttype: regel.documenttype ?? null,
    wetsgeschiedenisSubtype: regel.subtype ?? null,
  });
  console.log(
    JSON.stringify({
      bestand: regel.bestand.split("/").pop(),
      documenttype: regel.documenttype ?? null,
      subtype: regel.subtype ?? null,
      paginas: extractie.aantalPaginas,
      tekens: extractie.tekst.length,
      extractieMs: Math.round(t1 - t0),
      indexeringVersie: records[0]?.indexering_versie ?? null,
      ...meet(records, regel.controles ?? []),
    })
  );
}
