// ============================================================================
//  lib/pdf-bronblokken.ts — leesbare bronblokken uit PDF-tekstposities (#548).
// ----------------------------------------------------------------------------
//  PUUR: geen pdfjs-, Supabase- of modelimport. De invoer is per pagina de lijst
//  tekstitems met positie en lettergrootte; de uitvoer is per pagina een
//  TekstSegment waarin elke alinea, kop, tabel en voetnoot een eigen blok is
//  (blokken gescheiden door een witregel, een alinea staat op één regel).
//
//  WAAROM. De gedeelde extractie (document-extractie.ts) zet elke visuele
//  PDF-regel op een eigen regel en, door einde-regelmarkering plus Y-sprong,
//  vaak met een witregel ertussen. Daardoor is een afgebroken zinsregel als
//  "artikel 102a, heeft aangegeven …" niet te onderscheiden van een kop, werkt
//  het herstel van woordafbreking ("overdra-" + "gende") niet en staan
//  paginavoeten ("Tweede Kamer, vergaderjaar …, nr. 90 1", "ISSN …") midden in
//  de doorzoekbare tekst. Hier bouwen we eerst leesbare blokken op basis van de
//  layout (regelafstand, inspringing, lettergrootte) en pas dáárna draait de
//  structuurherkenning.
//
//  REIKWIJDTE. Alleen de generieke bibliotheek gebruikt dit (generieke-pdf-
//  extractie.ts). De fondsroute houdt de gedeelde extractie ongewijzigd.
//
//  CONSERVATIEF. Woordafbreking wordt alleen hersteld bij "letter-" aan het
//  regeleinde gevolgd door een kleine letter (en niet vóór een voegwoord als
//  "en"/"of": "pensioen- en" blijft staan). Kop- en voetregels verdwijnen alleen
//  in de paginamarge, en alleen als ze herhaald worden, een kaal paginanummer
//  zijn of een bekende drukvoet (Kamerstuk/ISSN). De paginanummers van de
//  blokken blijven die van de bronpagina.
// ============================================================================

import type { TekstSegment } from "./document-extractie";

/** Eén tekstitem zoals pdfjs het levert, teruggebracht tot wat we gebruiken. */
export interface PdfTekstItem {
  str: string;
  /** Linkerkant (pagina-coördinaten). */
  x: number;
  /** Basislijn (pagina-coördinaten; groter = hoger op de pagina). */
  y: number;
  fontSize: number;
  width: number;
}

export interface PdfPaginaInvoer {
  pagina: number;
  breedte: number;
  hoogte: number;
  items: PdfTekstItem[];
}

export type BronblokSoort =
  | "alinea"
  | "tabel"
  | "inhoudsopgave"
  | "voetnoot"
  | "kantlijn";

export interface Bronblok {
  pagina: number;
  soort: BronblokSoort;
  tekst: string;
}

export interface BronblokDiagnose {
  /** Verwijderde kop-/voetregels (cellen) in de paginamarge. */
  verwijderdeMargeregels: number;
  /** Herstelde woordafbrekingen (binnen en tussen pagina's). */
  hersteldeAfbrekingen: number;
  /** Verwijderde voetnootverwijzingen in superscript. */
  voetnootverwijzingen: number;
  /** Regels die als inhoudsopgave zijn herkend. */
  inhoudsopgaveRegels: number;
  /** Voorbeelden van verwijderde margeregels (genormaliseerd, uniek, max 10). */
  margevoorbeelden: string[];
}

export interface BronblokkenResultaat {
  segmenten: TekstSegment[];
  blokken: Bronblok[];
  diagnose: BronblokDiagnose;
}

// ── Regels ──────────────────────────────────────────────────────────────────

interface Cel {
  x: number;
  xEind: number;
  tekst: string;
  /** Superscript-voetnootnummer aan het begin van de cel (voetnoottekst). */
  voetnootNummer: string | null;
}

interface Regel {
  y: number;
  fs: number;
  cellen: Cel[];
}

/** Lettergrootte afgerond op 0,1 pt, voor modale bepalingen. */
function rond(n: number): number {
  return Math.round(n * 10) / 10;
}

function modus(waarden: number[], gewichten?: number[]): number | null {
  const telling = new Map<number, number>();
  waarden.forEach((w, i) => telling.set(w, (telling.get(w) ?? 0) + (gewichten?.[i] ?? 1)));
  let beste: number | null = null;
  let max = -1;
  for (const [w, n] of telling) {
    if (n > max || (n === max && beste !== null && w < beste)) {
      beste = w;
      max = n;
    }
  }
  return beste;
}

const RE_ALLEEN_WIT = /^\s*$/;
const RE_VOETNOOTMARKERING = /^[\d*†‡]{1,3}$/;

/**
 * Groepeert de items van één pagina tot visuele regels en die regels tot
 * cellen (een grote horizontale tussenruimte scheidt kolommen, kantlijn en
 * paginanummer). Superscript-voetnootverwijzingen binnen een regel vallen weg;
 * aan het begin van een regel worden ze het voetnootnummer.
 */
function bouwRegels(items: PdfTekstItem[], diagnose: BronblokDiagnose): Regel[] {
  const bruikbaar = items
    .filter((i) => i.str.length > 0 && Number.isFinite(i.x) && Number.isFinite(i.y))
    .map((i) => ({ ...i, fontSize: i.fontSize > 0 ? i.fontSize : 10 }));
  // Hoog → laag, links → rechts. Stabiel: pdfjs-volgorde blijft de tiebreak.
  const gesorteerd = bruikbaar
    .map((item, volgorde) => ({ item, volgorde }))
    .sort((a, b) => b.item.y - a.item.y || a.item.x - b.item.x || a.volgorde - b.volgorde)
    .map((v) => v.item);

  const groepen: { refY: number; refFs: number; items: PdfTekstItem[] }[] = [];
  for (const item of gesorteerd) {
    const groep = groepen.at(-1);
    if (groep && Math.abs(item.y - groep.refY) <= 0.5 * Math.max(groep.refFs, item.fontSize)) {
      groep.items.push(item);
      // De basislijn van de regel is die van het grootste (niet-superscript) item.
      if (item.fontSize > groep.refFs) {
        groep.refY = item.y;
        groep.refFs = item.fontSize;
      }
    } else {
      groepen.push({ refY: item.y, refFs: item.fontSize, items: [item] });
    }
  }

  const regels: Regel[] = [];
  for (const groep of groepen) {
    const fs = groep.refFs;
    const opX = [...groep.items].sort((a, b) => a.x - b.x);
    const cellen: Cel[] = [];
    let cel: Cel | null = null;
    let wachtendeSpatie = false;
    for (const item of opX) {
      const isSuperscript =
        item.fontSize < 0.8 * fs && item.y > groep.refY + 0.15 * fs && RE_VOETNOOTMARKERING.test(item.str.trim());
      if (RE_ALLEEN_WIT.test(item.str)) {
        wachtendeSpatie = true;
        continue;
      }
      const gat = cel ? item.x - cel.xEind : 0;
      if (!cel || gat > 2.2 * fs) {
        if (isSuperscript && !cel) {
          // Voetnootnummer aan het begin van een (voetnoot)regel.
          cel = { x: item.x, xEind: item.x + item.width, tekst: "", voetnootNummer: item.str.trim() };
          cellen.push(cel);
          wachtendeSpatie = false;
          continue;
        }
        if (isSuperscript) {
          diagnose.voetnootverwijzingen++;
          continue;
        }
        cel = { x: item.x, xEind: item.x + item.width, tekst: item.str, voetnootNummer: null };
        cellen.push(cel);
        wachtendeSpatie = false;
        continue;
      }
      if (isSuperscript) {
        if (cel.tekst === "" && cel.voetnootNummer) continue;
        diagnose.voetnootverwijzingen++;
        // De verwijzing neemt geen ruimte in de lopende tekst; een spatie
        // erna blijft wel nodig ("Goudswaard)¹ en" → "Goudswaard) en").
        cel.xEind = Math.max(cel.xEind, item.x + item.width);
        continue;
      }
      const spatie =
        cel.tekst !== "" &&
        (wachtendeSpatie || gat > 0.2 * fs) &&
        !cel.tekst.endsWith(" ") &&
        !item.str.startsWith(" ");
      cel.tekst += (spatie ? " " : "") + item.str;
      cel.xEind = Math.max(cel.xEind, item.x + item.width);
      wachtendeSpatie = false;
    }
    const opgeschoond = cellen
      .map((c) => ({ ...c, tekst: c.tekst.replace(/\s+/g, " ").trim() }))
      .filter((c) => c.tekst !== "" || c.voetnootNummer !== null);
    if (opgeschoond.length > 0) regels.push({ y: groep.refY, fs, cellen: opgeschoond });
  }
  return regels;
}

// ── Paginamarge: kop- en voetregels ─────────────────────────────────────────

/** Bekende drukvoeten van officiële publicaties (Kamerstukken, Staatsblad). */
const DRUKVOET_PATRONEN: RegExp[] = [
  /^kst-\d+-\d+(?:-\d+)?$/i,
  /^stb-\d{4}-\d+$/i,
  /^stcrt-\d{4}-\d+$/i,
  /^ISSN\s+\d{4}\s*-\s*\d{3}[\dX]$/i,
  /^[’']s-Gravenhage\s+\d{4}$/,
  /^(?:Tweede|Eerste)\s+Kamer,\s+vergaderjaar\s+\d{4}\s*[–-]\s*\d{4},\s+[\d ]+(?:\s*\([A-Z0-9]+\))?,\s+(?:nr\.|[A-Z]+)(?:\s+\d+)?(?:\s+\d+)?$/,
  /^(?:Staatsblad|Staatscourant)\s+\d{4}\s+(?:nr\.\s+)?\d+(?:\s+\d+)?$/,
];

// Kaal paginanummer: cijfers of kleine romeinse cijfers. Hoofdletter-romeins
// ("II") is in parlementaire stukken een onderdeelnummer, geen paginanummer.
const RE_PAGINANUMMER = /^(?:[-–]\s*)?(?:\d{1,4}|[ivxlc]{1,6})(?:\s*[-–])?$/;

function normaliseerMarge(tekst: string): string {
  return tekst.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
}

function inMarge(regel: Regel, hoogte: number): boolean {
  return regel.y < hoogte * 0.12 || regel.y > hoogte * 0.94;
}

// ── Classificatie ───────────────────────────────────────────────────────────

const RE_BLZ_KOP = /^(?:blz\.?|pag(?:ina)?\.?|bladzijde)$/i;

function isInhoudsopgaveRegel(regel: Regel, breedte: number): boolean {
  if (regel.cellen.length < 2) return false;
  const laatste = regel.cellen.at(-1)!;
  if (laatste.x < breedte * 0.7) return false;
  return /^\d{1,4}$/.test(laatste.tekst) || RE_BLZ_KOP.test(laatste.tekst);
}

const RE_LIJSTBEGIN = /^(?:\d+(?:\.\d+)*\.?|[a-z]\.|[a-z]\)|[IVX]+\.?|§|•|–|-|Artikel\s+\S|Hoofdstuk\s+\S|Paragraaf\s+\S|ARTIKEL\s+\S)(?:\s|$)/;
// Na "hoog- " volgt in een samentrekking een voegwoord ("hoog- en laag",
// "opbouw- als uitkeringsfase", "hoog- naar laag"): dan blijft het koppelteken.
const VOEGWOORDEN = new Set(["en", "of", "tot", "noch", "dan", "als", "naar", "maar", "respectievelijk", "c.q."]);

/**
 * Plakt een vervolgregel aan een lopende alinea. Woordafbreking ("overdra-" +
 * "gende") wordt hersteld als de regel eindigt op letter-koppelteken en de
 * vervolgregel met een kleine letter begint, tenzij het vervolgwoord een
 * voegwoord is ("pensioen- en …").
 */
function plak(huidig: string, vervolg: string, diagnose: BronblokDiagnose): string {
  if (/[A-Za-zÀ-ÿ]-$/.test(huidig)) {
    const eersteWoord = vervolg.split(/\s+/, 1)[0] ?? "";
    if (/^[a-zà-ÿ]/.test(vervolg) && !VOEGWOORDEN.has(eersteWoord.replace(/[.,;:]$/, ""))) {
      diagnose.hersteldeAfbrekingen++;
      return huidig.slice(0, -1) + vervolg;
    }
    // Hoofdletter ("Noord-" + "Holland") of voegwoord: koppelteken blijft,
    // geen spatie bij een hoofdletter, wel bij een voegwoord.
    return /^[A-ZÀ-Þ]/.test(vervolg) ? huidig + vervolg : `${huidig} ${vervolg}`;
  }
  return `${huidig} ${vervolg}`;
}

interface PaginaContext {
  breedte: number;
  hoogte: number;
  bodyFs: number;
  regelafstand: number;
  bodyLinks: number | null;
}

/** Bouwt de blokken van één pagina (marge al verwijderd). */
function bouwBlokken(
  pagina: number,
  regels: Regel[],
  ctx: PaginaContext,
  diagnose: BronblokDiagnose
): Bronblok[] {
  const blokken: Bronblok[] = [];

  // Voetnoten: kleine letter onder de laatste regel in hoofdtekstgrootte.
  const laagsteBody = regels
    .filter((r) => r.fs >= ctx.bodyFs * 0.9)
    .reduce((min, r) => Math.min(min, r.y), Number.POSITIVE_INFINITY);
  const isVoetnootRegel = (r: Regel) => r.fs < ctx.bodyFs * 0.85 && r.y < laagsteBody;

  // Inhoudsopgave: een aaneengesloten reeks regels tussen de eerste en laatste
  // regel met een paginaverwijzing rechts (max. twee vervolgregels ertussen).
  const tocIndex = regels
    .map((r, i) => (isInhoudsopgaveRegel(r, ctx.breedte) ? i : -1))
    .filter((i) => i >= 0);
  const inToc = new Set<number>();
  if (tocIndex.length >= 2) {
    let start = tocIndex[0];
    for (let k = 1; k <= tocIndex.length; k++) {
      const vorige = tocIndex[k - 1];
      const volgende = tocIndex[k];
      if (volgende === undefined || volgende - vorige > 3) {
        if (vorige > start) for (let i = start; i <= vorige; i++) inToc.add(i);
        if (volgende !== undefined) start = volgende;
      }
    }
  }

  // Voorbereiding per regel: kantlijncel afsplitsen ("36 067 | Wijziging van
  // …", "Nr. 90 | …": een cel ruim links van de hoofdtekstkolom op een regel
  // die ook hoofdtekst bevat).
  const voorbereid = regels.map((regel) => {
    const cellen = regel.cellen;
    if (ctx.bodyLinks !== null && cellen.length >= 2 && cellen[0].x < ctx.bodyLinks - 3 * regel.fs) {
      const rest = cellen.slice(1);
      if (Math.abs(rest[0].x - ctx.bodyLinks) <= 3 * regel.fs) {
        return { cellen: rest, kantlijn: cellen[0].tekst as string | null };
      }
    }
    return { cellen, kantlijn: null as string | null };
  });
  const isMeercellig = (i: number) =>
    i >= 0 && i < regels.length && !inToc.has(i) && !isVoetnootRegel(regels[i]) && voorbereid[i].cellen.length >= 2;
  // Twee regels liggen "dicht bij elkaar" binnen 2,6 regelafstanden.
  const dichtbij = (i: number, j: number) =>
    j >= 0 && j < regels.length && Math.abs(regels[i].y - regels[j].y) <= 2.6 * ctx.regelafstand;
  // Tabel = minstens twee meercellige regels dicht bij elkaar; een eencellige
  // regel dicht tussen twee tabelrijen is een afgebroken cel van die tabel.
  const isTabelrij = (i: number) =>
    isMeercellig(i) && [i - 2, i - 1, i + 1, i + 2].some((j) => isMeercellig(j) && dichtbij(i, j));
  const isTabelregel = (i: number) =>
    isTabelrij(i) ||
    (!inToc.has(i) && !isVoetnootRegel(regels[i]) && voorbereid[i].cellen.length === 1 &&
      isTabelrij(i - 1) && dichtbij(i, i - 1) &&
      [i + 1, i + 2].some((j) => isTabelrij(j) && dichtbij(i, j)));
  const kolomRechts = regels
    .filter((r) => Math.abs(r.fs - ctx.bodyFs) < 0.5)
    .reduce((max, r) => Math.max(max, r.cellen.at(-1)!.xEind), 0) || ctx.breedte;

  let alinea: { tekst: string; links: number; laatste: Regel } | null = null;
  let tabel: string[] | null = null;
  let toc: string[] | null = null;
  let tocLopend = "";
  let voetnoot: string | null = null;

  const sluitAlinea = () => {
    if (alinea && alinea.tekst.trim()) blokken.push({ pagina, soort: "alinea", tekst: alinea.tekst.trim() });
    alinea = null;
  };
  const sluitTabel = () => {
    if (tabel && tabel.length > 0) blokken.push({ pagina, soort: "tabel", tekst: tabel.join("\n") });
    tabel = null;
  };
  const sluitToc = () => {
    if (tocLopend.trim()) toc?.push(tocLopend.trim());
    if (toc && toc.length > 0) blokken.push({ pagina, soort: "inhoudsopgave", tekst: `Inhoudsopgave: ${toc.join("; ")}` });
    toc = null;
    tocLopend = "";
  };
  const sluitVoetnoot = () => {
    if (voetnoot && voetnoot.trim()) blokken.push({ pagina, soort: "voetnoot", tekst: voetnoot.trim() });
    voetnoot = null;
  };
  const sluitAlles = () => {
    sluitAlinea();
    sluitTabel();
    sluitToc();
    sluitVoetnoot();
  };

  regels.forEach((regel, index) => {
    // 1. Inhoudsopgave.
    if (inToc.has(index)) {
      sluitAlinea();
      sluitTabel();
      sluitVoetnoot();
      toc ??= [];
      diagnose.inhoudsopgaveRegels++;
      const laatste = regel.cellen.at(-1)!;
      const heeftVerwijzing = isInhoudsopgaveRegel(regel, ctx.breedte);
      const tekstCellen = heeftVerwijzing ? regel.cellen.slice(0, -1) : regel.cellen;
      const tekst = tekstCellen.map((c) => c.tekst).join(" ").trim();
      if (RE_BLZ_KOP.test(laatste.tekst)) return; // kopregel "Inhoudsopgave … blz."
      tocLopend = tocLopend ? plak(tocLopend, tekst, diagnose) : tekst;
      if (heeftVerwijzing) {
        toc.push(`${tocLopend} (blz. ${laatste.tekst})`);
        tocLopend = "";
      }
      return;
    }
    if (toc) sluitToc();

    // 2. Voetnoten onderaan de pagina.
    if (isVoetnootRegel(regel)) {
      sluitAlinea();
      sluitTabel();
      const eerste = regel.cellen[0];
      const tekst = regel.cellen.map((c) => c.tekst).join(" ").trim();
      if (eerste.voetnootNummer) {
        sluitVoetnoot();
        voetnoot = `[${eerste.voetnootNummer}] ${tekst}`;
      } else {
        voetnoot = voetnoot ? plak(voetnoot, tekst, diagnose) : tekst;
      }
      return;
    }
    sluitVoetnoot();

    // 3. Kantlijn (zie voorbereiding hierboven).
    const { cellen, kantlijn } = voorbereid[index];
    if (kantlijn) {
      sluitAlinea();
      sluitTabel();
      blokken.push({ pagina, soort: "kantlijn", tekst: kantlijn });
    }

    // 4. Tabelrij, of een eencellige vervolgregel binnen een tabel.
    if (isTabelregel(index)) {
      sluitAlinea();
      tabel ??= [];
      tabel.push(`| ${cellen.map((c) => c.tekst.replace(/\|/g, "/")).join(" | ")} |`);
      return;
    }
    sluitTabel();

    // 5. Lopende tekst: plak aan de alinea of begin een nieuwe.
    // Een losse regel met een gat (formule, uitgelijnd getal) is geen tabel:
    // de cellen vormen samen gewoon de regel.
    const cel: Cel = {
      x: cellen[0].x,
      xEind: cellen.at(-1)!.xEind,
      tekst: cellen.map((c) => c.tekst).join(" "),
      voetnootNummer: null,
    };
    const tekst = cel.tekst;
    if (alinea) {
      const vorige: Regel = alinea.laatste;
      const afstand = vorige.y - regel.y;
      const pitch = Math.abs(regel.fs - ctx.bodyFs) < 0.5 ? ctx.regelafstand : regel.fs * 1.2;
      const vorigeTekst = alinea.tekst;
      const vorigeCel = vorige.cellen.at(-1)!;
      const vorigeKort = vorigeCel.xEind < kolomRechts - 4 * vorige.fs;
      const zinEinde = /[.:;!?]$/.test(vorigeTekst);
      const lijstbegin = RE_LIJSTBEGIN.test(tekst);
      // Inspringing opent alleen een nieuwe alinea na een afgesloten zin of bij
      // een nieuw lijstitem ("b. …"); anders is het een hangende inspringing
      // van een opsommingsitem en loopt de alinea door.
      const ingesprongen = cel.x > alinea.links + 0.6 * regel.fs;
      const nieuw =
        afstand > pitch * 1.45 ||
        afstand < 0 ||
        Math.abs(regel.fs - vorige.fs) > 0.12 * vorige.fs ||
        (ingesprongen && (zinEinde || vorigeKort || lijstbegin)) ||
        (zinEinde && (vorigeKort || lijstbegin));
      if (!nieuw) {
        alinea.tekst = plak(alinea.tekst, tekst, diagnose);
        alinea.links = Math.min(alinea.links, cel.x);
        alinea.laatste = regel;
        return;
      }
      sluitAlinea();
    }
    alinea = { tekst, links: cel.x, laatste: regel };
  });
  sluitAlles();
  return blokken;
}

function leegDiagnose(): BronblokDiagnose {
  return {
    verwijderdeMargeregels: 0,
    hersteldeAfbrekingen: 0,
    voetnootverwijzingen: 0,
    inhoudsopgaveRegels: 0,
    margevoorbeelden: [],
  };
}

/**
 * Bouwt leesbare bronblokken voor alle pagina's van één PDF. Deterministisch.
 * Een pagina zonder tekst levert geen segment op (zoals de gedeelde extractie).
 */
export function bouwBronblokken(paginas: PdfPaginaInvoer[]): BronblokkenResultaat {
  const diagnose = leegDiagnose();
  const perPagina = paginas.map((p) => ({ invoer: p, regels: bouwRegels(p.items, diagnose) }));

  // Documentbrede maten: hoofdtekstgrootte (naar aantal tekens), regelafstand
  // en linkerkant van de hoofdtekstkolom.
  const fsWaarden: number[] = [];
  const fsGewicht: number[] = [];
  for (const { regels } of perPagina) {
    for (const r of regels) {
      fsWaarden.push(rond(r.fs));
      fsGewicht.push(r.cellen.reduce((n, c) => n + c.tekst.length, 0));
    }
  }
  const bodyFs = modus(fsWaarden, fsGewicht) ?? 10;
  const afstanden: number[] = [];
  const linkerkanten: number[] = [];
  for (const { regels } of perPagina) {
    for (let i = 0; i < regels.length; i++) {
      const r = regels[i];
      if (Math.abs(r.fs - bodyFs) >= 0.5) continue;
      linkerkanten.push(Math.round(r.cellen[0].x));
      const v = regels[i - 1];
      if (v && Math.abs(v.fs - bodyFs) < 0.5) {
        const d = rond(v.y - r.y);
        if (d >= bodyFs * 0.9 && d <= bodyFs * 2) afstanden.push(d);
      }
    }
  }
  const regelafstand = modus(afstanden) ?? bodyFs * 1.2;
  const bodyLinks = modus(linkerkanten);

  // Kop- en voetregels: herhaalde margecellen (na normalisatie van cijfers),
  // kale paginanummers en bekende drukvoeten.
  const drempel = Math.max(2, Math.ceil(paginas.length * 0.3));
  const telling = new Map<string, Set<number>>();
  for (const { invoer, regels } of perPagina) {
    for (const r of regels) {
      if (!inMarge(r, invoer.hoogte)) continue;
      for (const c of r.cellen) {
        const sleutel = normaliseerMarge(c.tekst);
        if (!telling.has(sleutel)) telling.set(sleutel, new Set());
        telling.get(sleutel)!.add(invoer.pagina);
      }
    }
  }
  const isMargecel = (c: Cel) => {
    const t = c.tekst.trim();
    if (RE_PAGINANUMMER.test(t)) return true;
    if (DRUKVOET_PATRONEN.some((re) => re.test(t))) return true;
    return paginas.length >= 2 && (telling.get(normaliseerMarge(t))?.size ?? 0) >= drempel;
  };

  const blokkenPerPagina: Bronblok[][] = perPagina.map(({ invoer, regels }) => {
    const zonderMarge: Regel[] = [];
    for (const r of regels) {
      if (!inMarge(r, invoer.hoogte)) {
        zonderMarge.push(r);
        continue;
      }
      const blijft = r.cellen.filter((c) => {
        if (!isMargecel(c)) return true;
        diagnose.verwijderdeMargeregels++;
        const voorbeeld = normaliseerMarge(c.tekst);
        if (diagnose.margevoorbeelden.length < 10 && !diagnose.margevoorbeelden.includes(voorbeeld)) {
          diagnose.margevoorbeelden.push(voorbeeld);
        }
        return false;
      });
      if (blijft.length > 0) zonderMarge.push({ ...r, cellen: blijft });
    }
    return bouwBlokken(
      invoer.pagina,
      zonderMarge,
      { breedte: invoer.breedte, hoogte: invoer.hoogte, bodyFs, regelafstand, bodyLinks },
      diagnose
    );
  });

  // Woordafbreking over een paginagrens: "pensioenuit-" (p. 2) + "voerders …"
  // (p. 3). Alleen het eerste woord verhuist; de rest blijft op zijn pagina.
  for (let i = 0; i + 1 < blokkenPerPagina.length; i++) {
    const huidige = blokkenPerPagina[i];
    const laatsteAlinea = [...huidige].reverse().find((b) => b.soort === "alinea");
    const volgende = blokkenPerPagina[i + 1].find((b) => b.soort === "alinea");
    if (!laatsteAlinea || !volgende || huidige.at(-1)?.soort === "tabel") continue;
    if (!/[A-Za-zÀ-ÿ]-$/.test(laatsteAlinea.tekst)) continue;
    const m = volgende.tekst.match(/^([a-zà-ÿ][^\s]*)\s*([\s\S]*)$/);
    if (!m || VOEGWOORDEN.has(m[1].replace(/[.,;:]$/, ""))) continue;
    laatsteAlinea.tekst = laatsteAlinea.tekst.slice(0, -1) + m[1];
    volgende.tekst = m[2];
    diagnose.hersteldeAfbrekingen++;
  }

  const blokken = blokkenPerPagina.flat().filter((b) => b.tekst.trim() !== "");
  const segmenten: TekstSegment[] = [];
  for (const { invoer } of perPagina) {
    const tekst = blokken
      .filter((b) => b.pagina === invoer.pagina)
      .map((b) => b.tekst)
      .join("\n\n");
    if (tekst.trim()) segmenten.push({ pagina: invoer.pagina, paragraaf: null, tekst });
  }
  return { segmenten, blokken, diagnose };
}

// ── OCR-uitvoer ─────────────────────────────────────────────────────────────

/**
 * OCR (Mistral) levert per pagina al doorlopende markdown. Hier alleen de
 * conservatieve nabewerking: bekende drukvoeten en kale paginanummers als
 * eigen regel weg, en woordafbreking over een regelgrens herstellen.
 */
export function schoonOcrSegmenten(segmenten: TekstSegment[]): {
  segmenten: TekstSegment[];
  diagnose: BronblokDiagnose;
} {
  const diagnose = leegDiagnose();
  const uit = segmenten
    .map((s) => {
      const regels = s.tekst.split("\n").filter((regel) => {
        const t = regel.trim();
        const weg = t !== "" && (RE_PAGINANUMMER.test(t) || DRUKVOET_PATRONEN.some((re) => re.test(t)));
        if (weg) diagnose.verwijderdeMargeregels++;
        return !weg;
      });
      const tekst = regels.join("\n").replace(/([A-Za-zÀ-ÿ])-\n(?=([a-zà-ÿ]+))/g, (heel, letter, woord) => {
        if (VOEGWOORDEN.has(woord)) return heel;
        diagnose.hersteldeAfbrekingen++;
        return letter;
      });
      return { ...s, tekst: tekst.trim() };
    })
    .filter((s) => s.tekst !== "");
  return { segmenten: uit, diagnose };
}
