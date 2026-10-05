// ============================================================================
//  retrieval/document-sectie.ts — een HELE sectie uit een PDF/DOCX-document (#548).
// ----------------------------------------------------------------------------
//  PUUR (geen IO). Voor een expliciet verzoek als "geef het hele artikel 150r
//  van amendement 36 067 nr. 90" of "toon de volledige paragraaf 3.2 van het
//  beleggingsplan": herken het verzoek, kies het document, baken de sectie af
//  op de opgeslagen structuur (structuur_type/structuur_label) en controleer of
//  de tekst aantoonbaar volledig is. Alleen dan volgt een letterlijke weergave;
//  anders een duidelijke onvolledigheidsmelding met een link naar het origineel.
//
//  Geldt voor fonds- én generieke documenten (PDF en DOCX). PPTX-dia's en
//  XLSX-tabbladen zijn eigen eenheden en vallen erbuiten. Wetgeving met een
//  officiële BWB-link loopt eerst via de juridische paragraafroute
//  (juridische-sectie.ts); deze route is de algemene opvolger.
//
//  Volledigheid is alleen aantoonbaar voor een index met
//  BRONBLOKKEN_INDEXERING_VERSIE: die laat geen korte tekst weg, kent de
//  sectiekoppen ook over de paginagrens en heeft geen paginavoeten in de
//  tekst. Een oudere index (r1/NULL) — bestaande fondsdocumenten — krijgt
//  daarom nooit een letterlijke volledige weergave, alleen de melding plus
//  bronlink. Er wordt geen ontbrekende tekst gereconstrueerd.
// ============================================================================

import { BRONBLOKKEN_INDEXERING_VERSIE } from "../chunk-bouw";

export type Sectiesoort = "artikel" | "hoofdstuk" | "paragraaf";

export interface Sectieverzoek {
  soort: Sectiesoort;
  /** Genormaliseerd nummer: "150r", "3.2", "I". */
  nummer: string;
  /** Alleen bij een artikel: "A" in "artikel I, onderdeel A". */
  onderdeel: string | null;
  /** Woorden uit de vraag die het document aanduiden (titel/dossiernummer). */
  documenttermen: string[];
}

export interface SectieDocument {
  id: string;
  titel: string;
  bestandsnaam?: string | null;
  dossiernummer?: string | null;
}

export interface SectieChunk {
  id: string;
  chunk_index: number;
  pagina: number | null;
  structuur_type: string | null;
  structuur_label: string | null;
  indexering_versie: string | null;
  /** Alleen nodig voor de rijen binnen de sectie. */
  tekst?: string;
}

export type SectieReden =
  | "ok"
  | "niet_gevonden"
  | "meerdere"
  | "oude_index"
  | "ocr"
  | "onderbroken"
  | "geen_kop"
  | "te_groot";

export interface Sectiebereik {
  reden: SectieReden;
  /** Eerste en laatste chunk_index van de sectie (inclusief), indien gevonden. */
  van: number | null;
  tot: number | null;
  /** Label van de beginchunk, voor de weergave en de bronkaart. */
  label: string | null;
}

export interface AfgebakendeDocumentsectie {
  reden: SectieReden;
  volledig: boolean;
  label: string | null;
  tekst: string;
  rijen: SectieChunk[];
  beginPagina: number | null;
  eindPagina: number | null;
}

export const MAX_SECTIE_TEKENS = 60_000;
export const MAX_SECTIE_CHUNKS = 160;

// ── 1. Het verzoek ──────────────────────────────────────────────────────────

const RE_VOLLEDIG = /\b(?:hele|gehele|volledige|volledig|integrale|integraal|letterlijke|letterlijk|complete|compleet)\b/i;
const RE_EENHEID =
  /(?:\b(artikel|hoofdstuk|paragraaf|sectie)\s+|(§)\s*)(\d+[a-z]{0,2}(?:\.\d+[a-z]?)*|[IVXLC]+)\b(?:\s*,\s*onderdeel\s+([A-Z]{1,3}|\d+))?/i;

const STOPWOORDEN = new Set([
  "geef", "toon", "laat", "zien", "hele", "gehele", "volledige", "volledig", "integrale", "integraal",
  "letterlijke", "letterlijk", "complete", "compleet", "tekst", "van", "het", "de", "een", "uit", "in",
  "op", "aan", "mij", "me", "ons", "graag", "kun", "kunt", "je", "jij", "u", "wil", "wilt", "willen",
  "alsjeblieft", "aub", "svp", "document", "stuk", "bestand", "pdf", "docx", "bij", "over", "met",
  "die", "dat", "deze", "dit", "staat", "staan", "onderdeel", "weergave", "weergeven", "citeer",
]);

function normaliseerWoord(w: string): string {
  return w.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Herkent een expliciet verzoek om een hele sectie; anders null. */
export function bepaalSectieverzoek(vraag: string): Sectieverzoek | null {
  if (!RE_VOLLEDIG.test(vraag)) return null;
  const m = RE_EENHEID.exec(vraag);
  if (!m) return null;
  const woord = (m[1] ?? m[2] ?? "").toLowerCase();
  const soort: Sectiesoort =
    woord === "artikel" ? "artikel" : woord === "hoofdstuk" ? "hoofdstuk" : "paragraaf";
  const nummer = m[3];
  // Een romeins "nummer" bij hoofdstuk/paragraaf is ongebruikelijk; bij een
  // artikel ("Artikel I") juist niet.
  const nummerNorm = /^[IVXLC]+$/i.test(nummer) ? nummer.toUpperCase() : nummer.toLowerCase();
  const rest = vraag.slice(0, m.index) + " " + vraag.slice(m.index + m[0].length);
  const termen = [
    ...new Set(
      (rest.match(/[\p{L}\p{N}][\p{L}\p{N}.\-]*/gu) ?? [])
        .map((w) => normaliseerWoord(w.replace(/[.\-]+$/, "")))
        .filter((w) => w.length >= 2 && !STOPWOORDEN.has(w))
        .filter((w) => w.length >= 4 || /\d/.test(w))
    ),
  ];
  return {
    soort,
    nummer: nummerNorm,
    onderdeel: soort === "artikel" && m[4] ? m[4].toUpperCase() : null,
    documenttermen: termen,
  };
}

// ── 2. Het document ─────────────────────────────────────────────────────────

function documentWoorden(d: SectieDocument): Set<string> {
  const bron = [d.titel, d.bestandsnaam ?? "", d.dossiernummer ?? ""].join(" ");
  const woorden = (bron.match(/[\p{L}\p{N}]+/gu) ?? []).map(normaliseerWoord);
  // "36 067" / "36067" en "nr. 90" vergelijkbaar maken.
  const cijfers = (bron.match(/\d[\d ]*\d|\d/g) ?? []).map((c) => c.replace(/\s+/g, ""));
  return new Set([...woorden, ...cijfers]);
}

export type Documentkeuze =
  | { soort: "gekozen"; document: SectieDocument }
  | { soort: "dubbelzinnig"; kandidaten: SectieDocument[] }
  | { soort: "geen" };

/**
 * Kiest het document op de termen uit de vraag. Een term telt als hij (of zijn
 * cijferreeks zonder spaties) in titel, bestandsnaam of dossiernummer staat.
 * Minimaal twee treffers, of één treffer als de vraag maar één term heeft.
 * Gelijke topscores = dubbelzinnig (de gebruiker moet kiezen; nooit gokken).
 */
export function kiesSectiedocument(verzoek: Sectieverzoek, documenten: SectieDocument[]): Documentkeuze {
  const termen = verzoek.documenttermen.map((t) => t.replace(/\s+/g, ""));
  if (termen.length === 0) return { soort: "geen" };
  const minimaal = termen.length === 1 ? 1 : 2;
  const gescoord = documenten
    .map((d) => {
      const woorden = documentWoorden(d);
      const score = termen.filter((t) => woorden.has(t)).length;
      return { d, score };
    })
    .filter((g) => g.score >= minimaal)
    .sort((a, b) => b.score - a.score);
  if (gescoord.length === 0) return { soort: "geen" };
  const top = gescoord.filter((g) => g.score === gescoord[0].score);
  if (top.length > 1) return { soort: "dubbelzinnig", kandidaten: top.slice(0, 5).map((g) => g.d) };
  return { soort: "gekozen", document: top[0].d };
}

// ── 3. Labels en afbakening ─────────────────────────────────────────────────

export interface Labelinfo {
  /** Parlementair deel ("Algemeen deel", "Amendement — wijziging") of null. */
  deel: string | null;
  /**
   * "kop": een andere kop met een label dat geen sectienummer draagt
   * (wijzigingsonderdeel van een amendement, markdownkop uit OCR). Sluit elke
   * sectie af. null: lopende tekst, tabel, definitie, besluit — hoort bij de
   * sectie waarin het staat.
   */
  soort: Sectiesoort | "genummerd" | "deel" | "kop" | null;
  nummer: string | null;
  onderdeel: string | null;
}

const DEELLABELS = new Set([
  "Algemeen deel",
  "Artikelsgewijze toelichting",
  "Amendement — wijziging",
  "Amendement — toelichting",
]);

function normNummer(n: string): string {
  return /^[IVXLC]+$/i.test(n) ? n.toUpperCase() : n.toLowerCase().replace(/\.$/, "");
}

/** Ontleedt een structuur_label tot (deel, soort, nummer). Puur. */
export function ontleedLabel(label: string | null, structuurType: string | null = null): Labelinfo {
  if (!label) return { deel: null, soort: null, nummer: null, onderdeel: null };
  if (DEELLABELS.has(label)) return { deel: label, soort: "deel", nummer: null, onderdeel: null };
  // Parlementaire labels: "<deel> — <eenheid>"; het deel kan zelf " — " bevatten.
  let deel: string | null = null;
  let eenheid = label;
  for (const d of DEELLABELS) {
    if (label.startsWith(`${d} — `)) {
      deel = d;
      eenheid = label.slice(d.length + 3);
      break;
    }
  }
  const art = /^Artikel\s+(\S+?)(?:,\s*onderdeel\s+(\S+))?$/i.exec(eenheid);
  if (art) return { deel, soort: "artikel", nummer: normNummer(art[1]), onderdeel: art[2]?.toUpperCase() ?? null };
  const hfd = /^Hoofdstuk\s+(\S+)$/i.exec(eenheid);
  if (hfd) return { deel, soort: "hoofdstuk", nummer: normNummer(hfd[1]), onderdeel: null };
  const par = /^(?:§\s*|Paragraaf\s+)(\S+)$/i.exec(eenheid);
  if (par) return { deel, soort: "paragraaf", nummer: normNummer(par[1]), onderdeel: null };
  const gen = /^(\d+(?:\.\d+)*)$/.exec(eenheid);
  if (gen) return { deel, soort: "genummerd", nummer: gen[1], onderdeel: null };
  if (structuurType === "kop") return { deel, soort: "kop", nummer: null, onderdeel: null };
  return { deel, soort: null, nummer: null, onderdeel: null };
}

function isBeginVan(info: Labelinfo, v: Sectieverzoek): boolean {
  if (info.nummer === null) return false;
  if (v.soort === "artikel") {
    return info.soort === "artikel" && info.nummer === v.nummer && (v.onderdeel === null || info.onderdeel === v.onderdeel);
  }
  if (v.soort === "hoofdstuk") {
    return (info.soort === "hoofdstuk" && info.nummer === v.nummer) ||
      (info.soort === "genummerd" && info.nummer === v.nummer && !v.nummer.includes("."));
  }
  return (info.soort === "paragraaf" || info.soort === "genummerd") && info.nummer === v.nummer;
}

/**
 * Hoort een chunk met dit label nog bij de lopende sectie? Een chunk zonder
 * herkenbaar sectielabel (lopende tekst, tabel, definitie, besluit) hoort bij
 * de sectie waarin hij staat. Een ander deel sluit elke sectie af.
 */
function hoortBij(info: Labelinfo, begin: Labelinfo, v: Sectieverzoek): boolean {
  if (info.soort === "deel" || info.soort === "kop") return false;
  if (info.deel !== begin.deel && (info.deel !== null || info.soort !== null)) return false;
  if (info.soort === null) return true;
  const n = info.nummer ?? "";
  if (v.soort === "artikel") {
    return info.soort === "artikel" && n === v.nummer && (v.onderdeel === null || info.onderdeel === v.onderdeel);
  }
  if (v.soort === "hoofdstuk") {
    if (info.soort === "hoofdstuk") return n === v.nummer;
    if (info.soort === "genummerd") return n === v.nummer || n.startsWith(`${v.nummer}.`);
    // §-koppen en artikelen binnen een hoofdstuk horen erbij (regelingen nummeren
    // paragrafen vaak per hoofdstuk opnieuw: "§ 1" sluit hoofdstuk 2 niet af).
    if (info.soort === "paragraaf") return !n.includes(".") || n === v.nummer || n.startsWith(`${v.nummer}.`);
    return true;
  }
  // paragraaf
  if (info.soort === "hoofdstuk") return false;
  if (info.soort === "paragraaf" || info.soort === "genummerd") return n === v.nummer || n.startsWith(`${v.nummer}.`);
  return true; // artikelen binnen een paragraaf
}

/**
 * Bakent de sectie af op de metadata van ALLE chunks van het document
 * (geordend op chunk_index). Controleert ook de indexversie, de aaneen-
 * geslotenheid en de omvang. Geeft het bereik; de tekst volgt na het ophalen.
 */
export function bakenDocumentsectieAf(
  verzoek: Sectieverzoek,
  chunks: SectieChunk[],
  opties: { ocrToegepast?: boolean | null } = {}
): Sectiebereik {
  const geordend = [...chunks].sort((a, b) => a.chunk_index - b.chunk_index);
  const infos = geordend.map((c) => ontleedLabel(c.structuur_label, c.structuur_type));

  // Begin: de eerste chunk van een aaneengesloten reeks met het gevraagde label.
  const beginnen: number[] = [];
  for (let i = 0; i < geordend.length; i++) {
    if (isBeginVan(infos[i], verzoek) && !(i > 0 && isBeginVan(infos[i - 1], verzoek) && geordend[i - 1].structuur_label === geordend[i].structuur_label)) {
      beginnen.push(i);
    }
  }
  if (beginnen.length === 0) return { reden: "niet_gevonden", van: null, tot: null, label: null };

  // Een sectie kan uit meerdere units met hetzelfde label bestaan (bv. een
  // tabel of vervolgpagina ertussen). Alleen beginnen die NIET binnen de
  // vorige sectie vallen, tellen als een tweede sectie.
  const eersteIdx = beginnen[0];
  const begin = infos[eersteIdx];
  let eind = eersteIdx;
  while (eind + 1 < geordend.length && hoortBij(infos[eind + 1], begin, verzoek)) eind++;
  const label = geordend[eersteIdx].structuur_label;
  const bereik = { van: geordend[eersteIdx].chunk_index, tot: geordend[eind].chunk_index, label };
  if (beginnen.some((b) => b > eind)) return { reden: "meerdere", ...bereik };

  // Volledigheid: alleen een bronblokken-index; geen OCR-tekst.
  if (geordend.some((c) => c.indexering_versie !== BRONBLOKKEN_INDEXERING_VERSIE)) {
    return { reden: "oude_index", ...bereik };
  }
  if (opties.ocrToegepast) return { reden: "ocr", ...bereik };
  // Aaneengesloten 0..n-1: er ontbreekt geen chunk (bv. door een filter).
  if (geordend.some((c, i) => c.chunk_index !== i)) return { reden: "onderbroken", ...bereik };
  if (eind - eersteIdx + 1 > MAX_SECTIE_CHUNKS) return { reden: "te_groot", ...bereik };
  return { reden: "ok", ...bereik };
}

/**
 * Overlap van de lengtechunker (maakChunks, alineaModus): de chunk begint met
 * de laatste woorden van de vorige chunk, dan "\n" (vervolg van dezelfde
 * alinea) of "\n\n" (nieuwe alinea). Geeft de tekst zonder overlap en of de
 * chunk een alinea voortzet; null als er geen (aantoonbare) overlap is.
 */
export function zonderOverlap(vorige: string, volgende: string): { rest: string; vervolgAlinea: boolean } | null {
  const regeleinde = volgende.indexOf("\n");
  if (regeleinde <= 0) return null;
  const kop = volgende.slice(0, regeleinde).trim().split(/\s+/);
  const staart = vorige.trim().split(/\s+/).slice(-kop.length);
  if (kop.length === 0 || kop.join(" ") !== staart.join(" ")) return null;
  const vervolgAlinea = volgende.charAt(regeleinde + 1) !== "\n";
  return { rest: volgende.slice(regeleinde + (vervolgAlinea ? 1 : 2)), vervolgAlinea };
}

/**
 * Stelt de sectietekst samen uit de chunks van het bereik (met tekst), in
 * bronvolgorde, zonder de overlap tussen opeenvolgende chunks van dezelfde unit
 * op dezelfde pagina. Een paginawissel krijgt een locatiemarkering.
 */
export function stelSectieSamen(
  bereik: Sectiebereik,
  rijen: SectieChunk[]
): AfgebakendeDocumentsectie {
  const geordend = [...rijen].sort((a, b) => a.chunk_index - b.chunk_index);
  const leeg: AfgebakendeDocumentsectie = {
    reden: bereik.reden,
    volledig: false,
    label: bereik.label,
    tekst: "",
    rijen: geordend,
    beginPagina: geordend[0]?.pagina ?? null,
    eindPagina: geordend.at(-1)?.pagina ?? null,
  };
  if (bereik.reden !== "ok") return leeg;
  if (bereik.van === null || bereik.tot === null) return { ...leeg, reden: "niet_gevonden" };
  const verwacht = bereik.tot - bereik.van + 1;
  if (geordend.length !== verwacht || geordend.some((r, i) => r.chunk_index !== bereik.van! + i || typeof r.tekst !== "string")) {
    return { ...leeg, reden: "onderbroken" };
  }
  // De eerste chunk moet met de kop zelf beginnen (niet met een vervolgregel).
  const info = ontleedLabel(geordend[0].structuur_label, geordend[0].structuur_type);
  const eersteRegel = (geordend[0].tekst ?? "").trimStart().split("\n", 1)[0].toLowerCase();
  const nummer = info.nummer ?? "";
  if (!nummer || !eersteRegel.includes(nummer.toLowerCase())) return { ...leeg, reden: "geen_kop" };

  let tekst = "";
  for (let i = 0; i < geordend.length; i++) {
    const r = geordend[i];
    const v = geordend[i - 1];
    let stuk = (r.tekst ?? "").trim();
    let scheiding = "\n\n";
    if (v && v.pagina === r.pagina && v.structuur_label === r.structuur_label && v.structuur_type === r.structuur_type) {
      const o = zonderOverlap(v.tekst ?? "", r.tekst ?? "");
      if (o) {
        stuk = o.rest.trim();
        if (o.vervolgAlinea) scheiding = " ";
      }
    }
    if (v && r.pagina !== null && v.pagina !== r.pagina) tekst += `\n\n*[pagina ${r.pagina}]*`;
    tekst += (tekst ? scheiding : "") + stuk;
  }
  if (tekst.length > MAX_SECTIE_TEKENS) return { ...leeg, reden: "te_groot" };
  return { ...leeg, reden: "ok", volledig: true, tekst };
}

// ── 4. Weergave ─────────────────────────────────────────────────────────────

const UITLEG: Record<Exclude<SectieReden, "ok">, string> = {
  niet_gevonden: "ik vind in de opgeslagen structuur geen sectie met dit nummer",
  meerdere: "dit nummer komt in het document op meer dan één plek als sectie voor",
  oude_index:
    "dit document is geïndexeerd vóór de verbeterde verwerking, waardoor ik niet kan aantonen dat de opgeslagen tekst de sectie volledig en zonder paginaopmaak bevat",
  ocr: "de tekst komt uit tekstherkenning (OCR) van een scan en is niet letterlijk te controleren",
  onderbroken: "er ontbreken passages tussen het begin en het einde",
  geen_kop: "het begin van de sectie is in de opgeslagen tekst niet eenduidig te vinden",
  te_groot: "de sectie is te lang om hier volledig en gecontroleerd te tonen",
};

export function sectieNaam(verzoek: Sectieverzoek): string {
  const nummer = verzoek.onderdeel ? `${verzoek.nummer}, onderdeel ${verzoek.onderdeel}` : verzoek.nummer;
  return verzoek.soort === "artikel"
    ? `Artikel ${nummer}`
    : verzoek.soort === "hoofdstuk"
      ? `Hoofdstuk ${nummer}`
      : `Paragraaf ${nummer}`;
}

export function origineelLink(documentId: string, pagina: number | null): string {
  return `/api/documents/${documentId}/bestand${pagina ? `#page=${pagina}` : ""}`;
}

function locatie(sectie: AfgebakendeDocumentsectie): string {
  const { beginPagina: b, eindPagina: e } = sectie;
  if (b === null) return sectie.label ? `sectie “${sectie.label}”` : "het document";
  return b === e || e === null ? `pagina ${b}` : `pagina ${b}–${e}`;
}

/** Het antwoord: letterlijke tekst met locatie, of een eerlijke melding plus link. */
export function geefDocumentsectieWeer(
  verzoek: Sectieverzoek,
  document: { id: string; titel: string },
  sectie: AfgebakendeDocumentsectie
): string {
  const naam = sectieNaam(verzoek);
  const link = origineelLink(document.id, sectie.beginPagina);
  if (!sectie.volledig || sectie.reden !== "ok") {
    const uitleg = UITLEG[sectie.reden === "ok" ? "onderbroken" : sectie.reden];
    const gevonden = sectie.reden === "niet_gevonden"
      ? `Ik heb ${naam} niet gevonden in “${document.titel}”`
      : `Ik heb ${naam} gevonden in “${document.titel}” (${locatie(sectie)})`;
    return `${gevonden}, maar ik kan de sectie niet betrouwbaar volledig en letterlijk weergeven: ${uitleg}. Lees de tekst in het [origineel](${link}).`;
  }
  return (
    `**${naam}** — “${document.titel}” (${locatie(sectie)}). Volledige tekst zoals opgeslagen, in bronvolgorde.\n\n` +
    `${sectie.tekst}\n\n[Open het origineel](${link})`
  );
}

export function geefDubbelzinnigWeer(verzoek: Sectieverzoek, kandidaten: SectieDocument[]): string {
  const lijst = kandidaten.map((d) => `- ${d.titel}`).join("\n");
  return `Ik weet niet zeker uit welk document u ${sectieNaam(verzoek)} volledig wilt zien. Deze documenten passen even goed:\n\n${lijst}\n\nNoem de titel (of het dossiernummer) iets preciezer.`;
}
