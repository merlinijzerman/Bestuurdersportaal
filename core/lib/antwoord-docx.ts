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
// De laag-niveau OOXML-mechaniek (esc/run/paragraaf/tabel/zip) én sinds B2
// (2026-08-10) de gedeelde stijllaag (accent, document-lettertype, echte lijsten)
// leven in `docx-primitieven.ts` — één gedeelde OOXML-laag, twee documenttypen
// (0079 naar de geest). Dit bestand houdt de parser-koppeling, het verplichte
// bureau-herkomstanker en de documentopbouw.
//
// ── Waarom de herkomstregel ook hier CONSTRUCTIE is (0098-patroon) ──────────
// Net als bouwKopie() zet deze module de bronnenlijst én de herkomstregel zélf;
// er is geen optieobject om ze weg te laten. `bouwDocxDocumentXml()` weigert
// (gooit) een document zonder het bureau-herkomstanker, en `bouwDocx()` bouwt de
// zip pas nadat dat anker aantoonbaar in de document-XML staat. Zo is de garantie
// uit ontwerp §6.4/§9 geen afspraak maar een controle op het moment van schrijven.

import {
  numeriekeKolommen,
  parseerBlokken,
  type Blok,
  type InlineDeel,
} from "./antwoord-parser";
import {
  bouwBronnenBlok,
  bronOrdinaal,
  herkomstRegel,
  HERKOMST_ANKER_BUREAU,
  type KopieBron,
  type KopieContext,
} from "./antwoord-klembord";
import {
  esc,
  run,
  paragraaf,
  tekstParagraaf,
  kopStijl,
  CONTENT_BREEDTE_DXA,
  kolomBreedtes,
  tabelCel,
  TBL_BORDERS,
  zipDocx,
  veiligeBestandsnaamKern,
  bouwStylesXml,
  maakNumberingXml,
  lijstItemParagraaf,
  BULLET_NUM_ID,
} from "./docx-primitieven";

/** Mutabele nummering-teller: elke geordende lijst krijgt een eigen numId zodat
 *  de nummering per lijst bij 1 herstart (numId 1 is de gedeelde bullet). */
interface NummerStaat {
  volgendeGeordendeNumId: number;
}

/** Telt de geordende lijsten in de AST; bepaalt hoeveel decimale nummer-
 *  definities `numbering.xml` moet bevatten (numId 2..N+1). Loopt in dezelfde
 *  volgorde als `bouwDocxDocumentXml`, zodat de numId's exact overeenkomen. */
export function telGeordendeLijsten(blokken: Blok[]): number {
  return blokken.filter((b) => b.soort === "lijst" && b.geordend).length;
}

/**
 * Inline-AST → een reeks runs. Citaties worden scriptie-stijl gerenderd (T5 A4):
 * een gekoppelde `[Bron N]` wordt een hooggeplaatst cijfer (superscript) waarvan
 * het getal het LIJSTNUMMER is uit de bronnenlijst achteraan — via de gedeelde
 * `bronOrdinaal`-map (0079: dezelfde interpretatie als het klembord). Een
 * dangling `[Bron N]` (geen match) krijgt geen ordinaal en blijft letterlijk,
 * zodat de waarschuwing onderaan klopt. De interne [Bron N]-koppeling en de
 * citaatvalidatie (op de ruwe modeltekst) blijven hierdoor ongemoeid.
 */
function inlineRuns(delen: InlineDeel[], ordinaal: Map<number, number>): string {
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
        case "bron": {
          const nr = ordinaal.get(d.nummer);
          return nr ? run(String(nr), { superscript: true }) : run(`[Bron ${d.nummer}]`);
        }
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

function blokNaarXml(blok: Blok, ordinaal: Map<number, number>, num: NummerStaat): string {
  switch (blok.soort) {
    case "alinea":
      return paragraaf(inlineRuns(blok.inline, ordinaal));
    case "kop":
      return paragraaf(inlineRuns(blok.inline, ordinaal), { stijl: kopStijl(blok.niveau) });
    case "lijst": {
      // Echte Word-nummering via numbering.xml (B2): bullets delen numId 1;
      // elke geordende lijst krijgt een eigen numId zodat hij bij 1 herstart.
      const numId = blok.geordend ? num.volgendeGeordendeNumId++ : BULLET_NUM_ID;
      return blok.items
        .map((it) => lijstItemParagraaf(inlineRuns(it, ordinaal), numId))
        .join("");
    }
    case "tabel": {
      const numeriek = numeriekeKolommen(blok);
      // T5 A1: expliciete tabelbreedte + tblGrid met vaste kolombreedtes (DXA).
      // Zonder tblGrid is de OOXML ongeldig; Word repareert dan stil en de
      // kolombreedtes blijven onbepaald. We tellen de kolommen op de breedste rij.
      const kolommen = Math.max(
        blok.kop.length,
        ...blok.rijen.map((r) => r.length),
        1,
      );
      const breedtes = kolomBreedtes(kolommen);
      const tblGrid = `<w:tblGrid>${breedtes
        .map((w) => `<w:gridCol w:w="${w}"/>`)
        .join("")}</w:tblGrid>`;
      const cel = (c: InlineDeel[], ci: number, kop: boolean) =>
        tabelCel(inlineRuns(c, ordinaal), {
          rechts: numeriek[ci],
          kop,
          breedteDxa: breedtes[ci] ?? breedtes[0],
        });
      const kopRij = `<w:tr>${blok.kop.map((c, ci) => cel(c, ci, true)).join("")}</w:tr>`;
      const rijen = blok.rijen
        .map((rij) => `<w:tr>${rij.map((c, ci) => cel(c, ci, false)).join("")}</w:tr>`)
        .join("");
      return (
        `<w:tbl><w:tblPr><w:tblW w:w="${CONTENT_BREEDTE_DXA}" w:type="dxa"/>${TBL_BORDERS}</w:tblPr>` +
        `${tblGrid}${kopRij}${rijen}</w:tbl>` +
        // Een lege alinea ná de tabel: Word vereist een paragraaf tussen een tabel
        // en het sectie-einde/een volgende tabel, anders opent het bestand met een
        // reparatievraag.
        paragraaf("")
      );
    }
  }
}

// ── Documentspecifieke sectie ─────────────────────────────────────────────────
// De stijlen (Title/Heading/Lijst/Herkomst + document-lettertype + accent) komen
// sinds B2 uit de gedeelde `bouwStylesXml()` in docx-primitieven.

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
  const ordinaal = bronOrdinaal(blokken, alleBronnen);
  const herkomst = herkomstRegel(ctx, bron.regels.length > 0);

  const delen: string[] = [];
  const num: NummerStaat = { volgendeGeordendeNumId: 2 };

  // 1. Titel + datum. De titel is de ENIGE titel: de producerende taak levert het
  // stuk zonder eigen titelregel (T5 A3/A5), zodat er geen tweede titel ontstaat.
  delen.push(paragraaf(run(ctx.titel), { stijl: "Title" }));
  delen.push(tekstParagraaf(ctx.datum));

  // 2. De inhoud (koppen, alinea's, echte lijsten, echte tabellen).
  for (const b of blokken) delen.push(blokNaarXml(b, ordinaal, num));

  // 3. Bronnenlijst (of de mededeling dat er geen bronnen zijn). Bewust een
  // eenvoudige, platte genummerde lijst (geen numbering.xml): de bronregels zijn
  // altijd 1..N en dragen geen inhoudelijke opsomming.
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
  return `${veiligeBestandsnaamKern(titel)}.docx`;
}

/**
 * Bouwt de volledige .docx als bytes. Parseert de antwoordtekst met dezelfde
 * parser als de weergave (géén tweede renderer), bouwt de document-XML (die de
 * herkomst-sluis passeert), stelt de gedeelde stijlen en de nummering samen en
 * zipt de OOXML-parts met de gedeelde zip-helper.
 */
export async function bouwDocx(
  antwoord: string,
  alleBronnen: KopieBron[],
  ctx: DocxStukContext
): Promise<DocxPayload> {
  const blokken = parseerBlokken(antwoord);
  const documentXml = bouwDocxDocumentXml(blokken, alleBronnen, ctx);
  const numberingXml = maakNumberingXml(telGeordendeLijsten(blokken));
  const bytes = await zipDocx(documentXml, bouwStylesXml(), numberingXml);
  return {
    bytes,
    bestandsnaam: docxBestandsnaam(ctx.titel),
  } as DocxPayload;
}
