// ============================================================
//  antwoord-docx — Word-export (.docx) van een AI-resultaat (T2, ontwerp §9)
// ============================================================
// De bureau-stand levert concepttekst; dit is het uitvoerformaat waarin dat stuk
// het portaal verlaat. HARDE ONTWERPEIS (besluit 0079, ontwerp §9): GÉÉN tweede
// renderer. De export loopt over DEZELFDE AST als de weergave (antwoord-parser)
// en hergebruikt DEZELFDE bronnenlijst- en herkomst-constructie als het klembord
// (antwoord-klembord). Alleen het uitvoerformaat verschilt: WordprocessingML in
// plaats van text/html.
//
// Een .docx is een zip van XML-parts. We bouwen die met de reeds aanwezige
// dependency `jszip` — geen nieuwe runtime-dep, geen zware docx-library.
//
// ── Waarom de herkomstregel ook hier CONSTRUCTIE is (0098-patroon) ──────────
// Net als bouwKopie() zet deze module de bronnenlijst én de herkomstregel zélf;
// er is geen optieobject om ze weg te laten. `bouwDocxDocumentXml()` weigert
// (gooit) een document zonder het bureau-herkomstanker, en `bouwDocx()` bouwt de
// zip pas nadat dat anker aantoonbaar in de document-XML staat. Zo is de garantie
// uit ontwerp §6.4/§9 geen afspraak maar een controle op het moment van schrijven.

import JSZip from "jszip";
import {
  numeriekeKolommen,
  parseerBlokken,
  type Blok,
  type InlineDeel,
} from "./antwoord-parser";
import {
  bouwBronnenBlok,
  herkomstRegel,
  HERKOMST_ANKER_BUREAU,
  type KopieBron,
  type KopieContext,
} from "./antwoord-klembord";

// ── XML-escaping ─────────────────────────────────────────────────────────────

// XML 1.0 verbiedt de meeste control-tekens; alleen TAB (\t), LF (\n) en CR (\r)
// zijn toegestaan. De antwoordtekst en het onderwerp zijn client-aangeleverd, dus
// één losse NUL of verticale tab zou anders een niet-welgevormde document.xml
// opleveren en Word tot een reparatievraag dwingen. We strippen ze vóór het escapen.
function esc(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Eén tekstrun met optionele vet/cursief. `xml:space="preserve"` behoudt spaties. */
function run(tekst: string, opts?: { vet?: boolean; cursief?: boolean; code?: boolean }): string {
  const rpr: string[] = [];
  if (opts?.vet) rpr.push("<w:b/>");
  if (opts?.cursief) rpr.push("<w:i/>");
  if (opts?.code) rpr.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>');
  const rprXml = rpr.length ? `<w:rPr>${rpr.join("")}</w:rPr>` : "";
  return `<w:r>${rprXml}<w:t xml:space="preserve">${esc(tekst)}</w:t></w:r>`;
}

/**
 * Inline-AST → een reeks runs. De citatiemarkers worden als LETTERLIJKE TEKST
 * meegeschreven ("[Bron 3]"), niet als opmaakobject — in Word moet zichtbaar
 * blijven waar een bewering vandaan komt (conform 0098 en de klembord-export).
 */
function inlineRuns(delen: InlineDeel[]): string {
  return delen
    .map((d) => {
      switch (d.soort) {
        case "tekst":
          return d.stukken
            .map((s) =>
              run(s.tekst, {
                vet: s.soort === "vet",
                cursief: s.soort === "cursief",
                code: s.soort === "code",
              })
            )
            .join("");
        case "bron":
          return run(`[Bron ${d.nummer}]`);
        case "kennis":
          return run(`[${d.label}]`);
        case "toelichting":
          return run("[Toelichting agendapunt]");
        case "organisatieprofiel":
          return run("[Organisatieprofiel]");
      }
    })
    .join("");
}

/** Een alinea/kop-paragraaf met een optionele stijl en uitlijning. */
function paragraaf(
  inhoud: string,
  opts?: { stijl?: string; rechts?: boolean }
): string {
  const ppr: string[] = [];
  if (opts?.stijl) ppr.push(`<w:pStyle w:val="${opts.stijl}"/>`);
  if (opts?.rechts) ppr.push('<w:jc w:val="right"/>');
  const pprXml = ppr.length ? `<w:pPr>${ppr.join("")}</w:pPr>` : "";
  return `<w:p>${pprXml}${inhoud}</w:p>`;
}

/** Platte-tekst-paragraaf (escapet zelf), voor bronnenlijst/herkomst. */
function tekstParagraaf(tekst: string, opts?: { stijl?: string; cursief?: boolean }): string {
  return paragraaf(run(tekst, { cursief: opts?.cursief }), { stijl: opts?.stijl });
}

// Markdown-kopniveau → Word-stijl. Niveau 1 → Heading1, 2+ → Heading2 (dieper
// nesten kent de bureau-stand niet).
function kopStijl(niveau: number): string {
  return niveau <= 1 ? "Heading1" : "Heading2";
}

function blokNaarXml(blok: Blok): string {
  switch (blok.soort) {
    case "alinea":
      return paragraaf(inlineRuns(blok.inline));
    case "kop":
      return paragraaf(inlineRuns(blok.inline), { stijl: kopStijl(blok.niveau) });
    case "lijst":
      // Word-nummering vergt een numbering.xml-part; voor de bureau-stand volstaat
      // een leesbaar prefix per item (bullet of nummer) in een eigen paragraaf.
      return blok.items
        .map((it, i) => {
          const prefix = blok.geordend ? `${i + 1}. ` : "• ";
          return paragraaf(run(prefix) + inlineRuns(it), { stijl: "Lijst" });
        })
        .join("");
    case "tabel": {
      const numeriek = numeriekeKolommen(blok);
      const kopRij = `<w:tr>${blok.kop
        .map((c, ci) => tabelCel(inlineRuns(c), numeriek[ci], true))
        .join("")}</w:tr>`;
      const rijen = blok.rijen
        .map(
          (rij) =>
            `<w:tr>${rij
              .map((c, ci) => tabelCel(inlineRuns(c), numeriek[ci], false))
              .join("")}</w:tr>`
        )
        .join("");
      return (
        `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${TBL_BORDERS}</w:tblPr>` +
        `${kopRij}${rijen}</w:tbl>` +
        // Een lege alinea ná de tabel: Word vereist een paragraaf tussen een tabel
        // en het sectie-einde/een volgende tabel, anders opent het bestand met een
        // reparatievraag.
        paragraaf("")
      );
    }
  }
}

/**
 * Eén tabelcel. Rechtse uitlijning volgt de deterministische kolomdetectie uit de
 * parser (numeriekeKolommen). Kopcellen krijgen een grijze vulling én vette runs.
 */
function tabelCel(runs: string, rechts: boolean, kop: boolean): string {
  const pprXml = rechts ? '<w:pPr><w:jc w:val="right"/></w:pPr>' : "";
  const shading = kop ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F4F9"/>' : "";
  const tcpr = `<w:tcPr><w:tcW w:w="0" w:type="auto"/>${shading}</w:tcPr>`;
  // Kopcel: vet elke run door een rPr-prefix in te voegen (de runs bevatten nog
  // geen rPr aan het begin; celinhoud is platte/gemarkeerde tekst).
  const inhoud = kop ? runs.replace(/<w:r>(?!<w:rPr>)/g, "<w:r><w:rPr><w:b/></w:rPr>") : runs;
  const paragraafInhoud = inhoud || run("");
  return `<w:tc>${tcpr}<w:p>${pprXml}${paragraafInhoud}</w:p></w:tc>`;
}

// ── OOXML-parts ──────────────────────────────────────────────────────────────

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const TBL_BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((z) => `<w:${z} w:val="single" w:sz="4" w:space="0" w:color="C8CCD8"/>`)
    .join('') +
  '</w:tblBorders>';

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="60"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="200" w:after="40"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Lijst"><w:name w:val="Lijst"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/><w:spacing w:after="40"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Herkomst"><w:name w:val="Herkomst"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240"/></w:pPr><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style>
</w:styles>`;

const SECT_PR =
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
  '<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/></w:sectPr>';

// ── Documentopbouw ───────────────────────────────────────────────────────────

export interface DocxStukContext extends KopieContext {
  /** Titel bovenaan het document (bv. de stuksoort + onderwerp). */
  titel: string;
}

/**
 * Bouwt de body-XML van het document (zonder zip). Puur en testbaar: neemt de
 * AST-blokken en de bronnen, produceert de WordprocessingML-body. Weigert (gooit)
 * wanneer het bureau-herkomstanker onverhoopt niet in het resultaat staat — de
 * schrijffunctie mag nooit een document zonder herkomst afgeven (ontwerp §6.4/§9).
 *
 * `ctx.surface` moet `"bureau"` zijn; alleen dan levert herkomstRegel de
 * §6.4-variant met het anker waarop hier wordt gecontroleerd.
 */
export function bouwDocxDocumentXml(
  blokken: Blok[],
  alleBronnen: KopieBron[],
  ctx: DocxStukContext
): string {
  const bron = bouwBronnenBlok(blokken, alleBronnen);
  const herkomst = herkomstRegel(ctx, bron.regels.length > 0);

  const delen: string[] = [];

  // 1. Titel + datum.
  delen.push(paragraaf(run(ctx.titel), { stijl: "Title" }));
  delen.push(tekstParagraaf(ctx.datum));

  // 2. De inhoud (koppen, alinea's, lijsten, echte tabellen).
  for (const b of blokken) delen.push(blokNaarXml(b));

  // 3. Bronnenlijst (of de mededeling dat er geen bronnen zijn).
  if (bron.kop) {
    delen.push(paragraaf(run(bron.kop), { stijl: "Heading2" }));
    bron.regels.forEach((r, i) =>
      delen.push(paragraaf(run(`${i + 1}. `) + run(r), { stijl: "Lijst" }))
    );
  } else if (bron.mededeling) {
    delen.push(tekstParagraaf(bron.mededeling));
  }
  if (bron.waarschuwing) {
    delen.push(paragraaf(run(bron.waarschuwing, { vet: true })));
  }

  // 4. De verplichte herkomstregel (bureau-variant).
  delen.push(tekstParagraaf(herkomst, { stijl: "Herkomst", cursief: true }));

  const body = `${delen.join("")}${SECT_PR}`;
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body}</w:body></w:document>`;

  // Laatste sluis: geen document zonder herkomst de deur uit (0098-patroon).
  if (!documentXml.includes(esc(HERKOMST_ANKER_BUREAU)) && !documentXml.includes(HERKOMST_ANKER_BUREAU)) {
    throw new Error("antwoord-docx: herkomstregel ontbreekt — export geweigerd");
  }

  return documentXml;
}

/** Merkteken zodat een DocxPayload alleen door bouwDocx() gemaakt kan worden. */
declare const docxMerk: unique symbol;

export interface DocxPayload {
  bytes: Uint8Array;
  /** Bestandsnaam-suggestie (zonder pad), al opgeschoond. */
  bestandsnaam: string;
  readonly [docxMerk]: true;
}

/** Maakt een veilige .docx-bestandsnaam uit de titel. */
export function docxBestandsnaam(titel: string): string {
  const kern =
    titel
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9 _-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "stuk";
  return `${kern}.docx`;
}

/**
 * Bouwt de volledige .docx als bytes. Parseert de antwoordtekst met dezelfde
 * parser als de weergave (géén tweede renderer), bouwt de document-XML (die de
 * herkomst-sluis passeert) en zipt de OOXML-parts met jszip.
 */
export async function bouwDocx(
  antwoord: string,
  alleBronnen: KopieBron[],
  ctx: DocxStukContext
): Promise<DocxPayload> {
  const blokken = parseerBlokken(antwoord);
  const documentXml = bouwDocxDocumentXml(blokken, alleBronnen, ctx);

  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", RELS);
  zip.file("word/document.xml", documentXml);
  zip.file("word/_rels/document.xml.rels", DOC_RELS);
  zip.file("word/styles.xml", STYLES);

  const bytes = await zip.generateAsync({
    type: "uint8array",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  return {
    bytes,
    bestandsnaam: docxBestandsnaam(ctx.titel),
  } as DocxPayload;
}
