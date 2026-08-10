// ============================================================================
// docx-primitieven — gedeelde laag-niveau OOXML-bouwstenen (besluit 0079).
// ----------------------------------------------------------------------------
// Één OOXML-laag, meerdere documenttypen. Deze primitieven zijn uit
// `antwoord-docx.ts` (T2) getrokken zodat de afschrift-leeswijzer (T6) er ook
// op bouwt zonder een tweede renderer of een zware docx-dependency. De AI-
// antwoord-export blijft z'n eigen stijlen/herkomstanker houden; de afschrift-
// export brengt z'n eigen stijlen mee. Alleen de mechaniek is gedeeld.
//
// Een .docx is een zip van XML-parts; we bouwen die met het reeds aanwezige
// `jszip`.
//
// ── Gedeelde stijllaag (B2, 2026-08-10) ─────────────────────────────────────
// De AI-antwoord-export (antwoord-docx) leverde kale documenten: geen accent-
// kleur, geen document-lettertype (Word viel terug op zijn default) en nep-
// lijsten (letterlijke "• "/"1. " zonder numbering.xml). De opmaakbouwstenen
// staan daarom nu hier: `ACCENT_BESTUURSBLAUW`, `BODY_FONT`, `bouwStylesXml()`
// en `maakNumberingXml()`/`lijstItemParagraaf()`. Zo delen beide exportpaden
// dezelfde huisstijl in plaats van elk hun eigen kopie (afschrift-export kan
// `bouwStylesXml()` overnemen; dat is een no-op op de opmaak — zelfde accent).
// ============================================================================

import JSZip from "jszip";

// ── Huisstijl (gedeeld) ──────────────────────────────────────────────────────
/** D1-bestuursblauw (besluit 0101). Eén accentkleur voor titels, koppen en
 *  lijstmarkeringen in de Word-exports. Config-inhaakplek voor de portal-
 *  accentkleur (gelijk aan de afschrift-export, `afschrift-docx.ts` ACCENT). */
export const ACCENT_BESTUURSBLAUW = "1F3A5F";

/** Eén documentlettertype via `docDefaults`, zodat Word niet terugvalt op zijn
 *  eigen default (de grootste "generieke" factor in de kale export). */
export const BODY_FONT = "Calibri";

// ── XML-escaping ─────────────────────────────────────────────────────────────
// XML 1.0 verbiedt de meeste control-tekens; alleen TAB/LF/CR zijn toegestaan.
// Client-aangeleverde tekst kan een losse NUL/verticale tab bevatten die anders
// een niet-welgevormde document.xml oplevert en Word tot reparatie dwingt.
export function esc(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface RunOpts {
  vet?: boolean;
  cursief?: boolean;
  code?: boolean;
  superscript?: boolean;
  /** Hex zonder '#', bv. "555555". */
  kleur?: string;
  /** Tekengrootte in half-punten (bv. 20 = 10pt). */
  grootte?: number;
}

/** Eén tekstrun met optionele opmaak. `xml:space="preserve"` behoudt spaties. */
export function run(tekst: string, opts?: RunOpts): string {
  const rpr: string[] = [];
  if (opts?.vet) rpr.push("<w:b/>");
  if (opts?.cursief) rpr.push("<w:i/>");
  if (opts?.code) rpr.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>');
  if (opts?.superscript) rpr.push('<w:vertAlign w:val="superscript"/>');
  if (opts?.kleur) rpr.push(`<w:color w:val="${opts.kleur}"/>`);
  if (opts?.grootte) rpr.push(`<w:sz w:val="${opts.grootte}"/>`);
  const rprXml = rpr.length ? `<w:rPr>${rpr.join("")}</w:rPr>` : "";
  return `<w:r>${rprXml}<w:t xml:space="preserve">${esc(tekst)}</w:t></w:r>`;
}

export interface ParagraafOpts {
  stijl?: string;
  rechts?: boolean;
  midden?: boolean;
}

/** Een alinea/kop-paragraaf met een optionele stijl en uitlijning. */
export function paragraaf(inhoud: string, opts?: ParagraafOpts): string {
  const ppr: string[] = [];
  if (opts?.stijl) ppr.push(`<w:pStyle w:val="${opts.stijl}"/>`);
  if (opts?.rechts) ppr.push('<w:jc w:val="right"/>');
  if (opts?.midden) ppr.push('<w:jc w:val="center"/>');
  const pprXml = ppr.length ? `<w:pPr>${ppr.join("")}</w:pPr>` : "";
  return `<w:p>${pprXml}${inhoud}</w:p>`;
}

/** Paragraaf met volledig zelf-samengestelde pPr-inhoud (voor bv. arcering/randen). */
export function paragraafMetPpr(pprInner: string, inhoud: string): string {
  return `<w:p><w:pPr>${pprInner}</w:pPr>${inhoud}</w:p>`;
}

/** Platte-tekst-paragraaf (escapet zelf via run), voor bronnenlijst/herkomst. */
export function tekstParagraaf(
  tekst: string,
  opts?: { stijl?: string; cursief?: boolean }
): string {
  return paragraaf(run(tekst, { cursief: opts?.cursief }), { stijl: opts?.stijl });
}

/** Markdown-kopniveau → Word-stijl. Niveau 1 → Heading1, 2+ → Heading2. */
export function kopStijl(niveau: number): string {
  return niveau <= 1 ? "Heading1" : "Heading2";
}

// ── Lijsten (echte Word-nummering) ───────────────────────────────────────────
// Word-nummering vergt een `numbering.xml`-part; een lijst-item verwijst er via
// `w:numPr` naar. numId 1 = opsomming (bullet, gedeeld). Geordende lijsten
// krijgen elk een eigen numId (2, 3, …) zodat de nummering per lijst bij 1
// herstart (via `startOverride` in `maakNumberingXml`).
export const BULLET_NUM_ID = 1;

/** Eén lijst-item-paragraaf die naar de nummering (numId) verwijst. De inspring
 *  en de markering komen uit de `numbering.xml`-definitie. */
export function lijstItemParagraaf(inhoud: string, numId: number): string {
  return (
    `<w:p><w:pPr><w:spacing w:after="60"/>` +
    `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>` +
    `</w:pPr>${inhoud}</w:p>`
  );
}

/**
 * Bouwt het `numbering.xml`-part: één bullet-definitie (numId 1) plus `aantal-
 * Geordend` decimale definities (numId 2..N+1), elk met een `startOverride`
 * zodat iedere geordende lijst opnieuw bij 1 begint.
 */
export function maakNumberingXml(aantalGeordend: number): string {
  const geordend = Array.from({ length: Math.max(0, aantalGeordend) }, (_, i) =>
    `<w:num w:numId="${i + 2}"><w:abstractNumId w:val="1"/>` +
    `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`
  ).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/>` +
    `<w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/>` +
    `<w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr>` +
    `<w:rPr><w:rFonts w:ascii="${BODY_FONT}" w:hAnsi="${BODY_FONT}"/><w:color w:val="${ACCENT_BESTUURSBLAUW}"/></w:rPr>` +
    `</w:lvl></w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/>` +
    `<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>` +
    `<w:pPr><w:ind w:left="420" w:hanging="280"/></w:pPr>` +
    `<w:rPr><w:b/><w:color w:val="${ACCENT_BESTUURSBLAUW}"/></w:rPr>` +
    `</w:lvl></w:abstractNum>` +
    `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
    geordend +
    `</w:numbering>`
  );
}

// ── Gedeelde stijl-XML (styles.xml) ──────────────────────────────────────────
/**
 * Bouwt de `styles.xml` met de gedeelde huisstijl: één document-lettertype via
 * `docDefaults`, en accentkleur op Title/Heading. Stijl-id's blijven identiek
 * (Normal/Title/Heading1/Heading2/Lijst/Herkomst) zodat bestaande verwijzingen
 * ongemoeid blijven. De `Lijst`-stijl draagt alleen nog spacing; de inspring
 * van echte lijsten komt uit `numbering.xml`.
 */
export function bouwStylesXml(): string {
  const F = BODY_FONT;
  const A = ACCENT_BESTUURSBLAUW;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:docDefaults><w:rPrDefault><w:rPr>` +
    `<w:rFonts w:ascii="${F}" w:hAnsi="${F}" w:cs="${F}"/>` +
    `<w:sz w:val="21"/><w:szCs w:val="21"/><w:color w:val="242830"/>` +
    `</w:rPr></w:rPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:color w:val="${A}"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="60"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:color w:val="${A}"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="200" w:after="40"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="${A}"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Lijst"><w:name w:val="Lijst"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40"/></w:pPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Herkomst"><w:name w:val="Herkomst"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240"/></w:pPr><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style>` +
    `</w:styles>`
  );
}

// ── Tabellen ─────────────────────────────────────────────────────────────────
// Bruikbare contentbreedte in DXA (twips): A4-pagina 11906 minus linker- en
// rechtermarge (elk 1417). Tabellen/kolommen worden hierop vastgezet zodat Word
// niets hoeft te schatten (T5 A1).
export const CONTENT_BREEDTE_DXA = 11906 - 1417 * 2; // = 9072

/** Kolombreedtes (DXA) die samen exact de contentbreedte vullen; rest bij de laatste. */
export function kolomBreedtes(aantal: number, totaalDxa: number = CONTENT_BREEDTE_DXA): number[] {
  if (aantal <= 0) return [];
  const basis = Math.floor(totaalDxa / aantal);
  const breedtes = Array<number>(aantal).fill(basis);
  breedtes[aantal - 1] = totaalDxa - basis * (aantal - 1);
  return breedtes;
}

/**
 * Eén tabelcel. `inhoudRuns` is al opgebouwde run-XML. Kopcellen krijgen een
 * grijze vulling én vette runs. De celbreedte (DXA) sluit aan op de tblGrid-
 * kolom (T5 A1). Rechtse uitlijning voor numerieke kolommen.
 */
export function tabelCel(
  inhoudRuns: string,
  opts: { rechts?: boolean; kop?: boolean; breedteDxa: number; vulling?: string }
): string {
  const pprXml = opts.rechts ? '<w:pPr><w:jc w:val="right"/></w:pPr>' : "";
  const fill = opts.vulling ?? (opts.kop ? "F2F4F9" : null);
  const shading = fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : "";
  const tcpr = `<w:tcPr><w:tcW w:w="${opts.breedteDxa}" w:type="dxa"/>${shading}</w:tcPr>`;
  // Kopcel: vet elke run door een rPr-prefix in te voegen.
  const inhoud = opts.kop
    ? inhoudRuns.replace(/<w:r>(?!<w:rPr>)/g, "<w:r><w:rPr><w:b/></w:rPr>")
    : inhoudRuns;
  const paragraafInhoud = inhoud || run("");
  return `<w:tc>${tcpr}<w:p>${pprXml}${paragraafInhoud}</w:p></w:tc>`;
}

// ── Gedeelde randen ──────────────────────────────────────────────────────────
export const TBL_BORDERS =
  "<w:tblBorders>" +
  ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((z) => `<w:${z} w:val="single" w:sz="4" w:space="0" w:color="C8CCD8"/>`)
    .join("") +
  "</w:tblBorders>";

/**
 * Bouwt een volledige tabel-XML uit rijen van reeds-opgebouwde run-XML-cellen.
 * `kopRij` markeert of de eerste rij een koprij is. Sluit af met een lege
 * alinea (Word vereist een paragraaf tussen een tabel en het sectie-einde).
 */
export function tabel(
  rijen: string[][],
  opts?: { kopRij?: boolean; breedtes?: number[]; rechtsKolommen?: boolean[]; totaalDxa?: number }
): string {
  const totaal = opts?.totaalDxa ?? CONTENT_BREEDTE_DXA;
  const kolommen = Math.max(1, ...rijen.map((r) => r.length));
  const breedtes = opts?.breedtes ?? kolomBreedtes(kolommen, totaal);
  const tblGrid = `<w:tblGrid>${breedtes.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`;
  const trs = rijen
    .map((rij, ri) => {
      const cellen = rij
        .map((cel, ci) =>
          tabelCel(cel, {
            kop: opts?.kopRij === true && ri === 0,
            rechts: opts?.rechtsKolommen?.[ci] ?? false,
            breedteDxa: breedtes[ci] ?? breedtes[0],
          })
        )
        .join("");
      return `<w:tr>${cellen}</w:tr>`;
    })
    .join("");
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${totaal}" w:type="dxa"/>${TBL_BORDERS}</w:tblPr>` +
    `${tblGrid}${trs}</w:tbl>` +
    paragraaf("")
  );
}

// ── Zip-assemblage ───────────────────────────────────────────────────────────

export const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

export const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

export const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

// Content-type-override en relationship voor het optionele numbering-part. Los
// gehouden zodat de basis-constanten (die de afschrift-export importeert)
// ongewijzigd blijven; ze worden alleen ingevoegd wanneer er nummering is.
const NUMBERING_CT_OVERRIDE =
  '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>';
const NUMBERING_REL =
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>';

/**
 * Pakt de OOXML-parts (met de meegegeven styles + document-XML) tot .docx-bytes.
 * Wanneer `numberingXml` is meegegeven, wordt het `numbering.xml`-part toegevoegd
 * en worden de content-types/relationships daarvoor uitgebreid (de basis-
 * constanten blijven ongemoeid, zodat de afschrift-export niet meebeweegt).
 */
export async function zipDocx(
  documentXml: string,
  stylesXml: string,
  numberingXml?: string
): Promise<Uint8Array> {
  const zip = new JSZip();
  const contentTypes = numberingXml
    ? CONTENT_TYPES.replace("</Types>", `${NUMBERING_CT_OVERRIDE}</Types>`)
    : CONTENT_TYPES;
  const docRels = numberingXml
    ? DOC_RELS.replace("</Relationships>", `${NUMBERING_REL}</Relationships>`)
    : DOC_RELS;
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", RELS);
  zip.file("word/document.xml", documentXml);
  zip.file("word/_rels/document.xml.rels", docRels);
  zip.file("word/styles.xml", stylesXml);
  if (numberingXml) zip.file("word/numbering.xml", numberingXml);
  return zip.generateAsync({
    type: "uint8array",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

/** Maakt een veilige bestandsnaam-kern uit een titel (zonder extensie). */
export function veiligeBestandsnaamKern(titel: string, max: number = 80): string {
  return (
    titel
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9 _-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, max) || "stuk"
  );
}
