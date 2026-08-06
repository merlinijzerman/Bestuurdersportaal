// ============================================================
//  antwoord-parser — de handgeschreven markdown-parser achter de AI-weergave
// ============================================================
// Deze module bevat de PURE parseerlogica die eerder in
// app/(dashboard)/ai/_components/AntwoordWeergave.tsx zat, verweven met JSX.
// De reden voor de extractie is drieledig:
//
//  1. TESTBAARHEID. De parser voedt sinds besluit 0079 twee schermen (/ai en de
//     inline agendapuntchat) en had geen enkele geautomatiseerde test. Een suite
//     op de gerenderde HTML zou bij elke opmaakwijziging omvallen; een suite op
//     een AST legt structuur en semantiek vast en overleeft styling.
//  2. ÉÉN INTERPRETATIE. De kopieerfunctie moet dezelfde tekst omzetten naar
//     text/html en text/plain. Zonder gedeelde parser ontstaan twee parsers die
//     uiteenlopen — met als zichtbaar gevolg dat wat je kopieert niet is wat je
//     ziet.
//  3. LAAGSCHEIDING. app/ mag core/ importeren, andersom niet (boundary T9).
//     De parser hoort dus hier, de rendering in het component.
//
// HARDE EIS BIJ DE EXTRACTIE: de uitvoer verandert niet. De AST bevat daarom
// ook de React-key-nummering (`k`) van de oude implementatie, zodat niet alleen
// de HTML maar ook het reconciliatiegedrag tijdens het streamen identiek blijft.
// Bekende eigenaardigheden (genummerde lijsten die altijd bij 1 beginnen,
// genegeerde uitlijningsdubbelepunten, platgeslagen nesting) zijn bewust
// bevroren en vastgelegd in antwoord-parser.sanity.ts — dat zijn bevindingen,
// geen bugs die hier stilletjes gerepareerd worden.

import { detecteerInstantieInTekst } from "./assistant-source";

// ── Inline ───────────────────────────────────────────────────────────────────

/**
 * Eén stuk platte tekst binnen een tekstsegment, na de inline-markdownsplitsing.
 * `k` is de index in de split-array; die voedt de React-key in de renderer.
 */
export type InlineStuk = {
  k: number;
  soort: "plat" | "vet" | "cursief" | "code";
  tekst: string;
};

/**
 * Eén segment van een regel, na splitsing op de citatiemarkers. Een `tekst`-deel
 * draagt zijn eigen inline-markdown; de markers zijn atomair.
 */
export type InlineDeel =
  | { k: number; soort: "tekst"; stukken: InlineStuk[] }
  | { k: number; soort: "bron"; nummer: number }
  | { k: number; soort: "kennis"; label: string; instantie: string | null }
  | { k: number; soort: "toelichting" }
  | { k: number; soort: "organisatieprofiel" };

// ── Blokken ──────────────────────────────────────────────────────────────────

export type Blok =
  | { soort: "alinea"; inline: InlineDeel[] }
  | { soort: "kop"; niveau: number; inline: InlineDeel[] }
  | { soort: "lijst"; geordend: boolean; items: InlineDeel[][] }
  | { soort: "tabel"; kop: InlineDeel[][]; rijen: InlineDeel[][][] };

// Regex pakt alle inline-markeringen in één keer:
// - [Bron 1], [Bron 12]
// - [Algemene kennis], [algemene kennis]
// - [Volgens wetgeving], [volgens wetgeving]
// - [Toelichting agendapunt] (ADR 0028 — ongevalideerde bestuurs-vrijetekst)
// - [Organisatieprofiel] (OP-4 — organisatiespecifieke context, geen fondsbron)
export const MARKER_REGEX =
  /(\[Bron \d+\]|\[Algemene kennis\]|\[Volgens wetgeving\]|\[Toelichting agendapunt\]|\[Organisatieprofiel\])/gi;

// ── Tabelherkenning ──────────────────────────────────────────────────────────
// Een tabel is een pipe-rij ( | a | b | ) gevolgd door een scheidingsrij
// ( |---|---| ). Zonder deze afhandeling toonde de AI-tabel als ruwe pipe-tekst.

export function splitCellen(r: string): string[] {
  return r
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function isTabelRij(r: string): boolean {
  return /^\s*\|.*\|\s*$/.test(r);
}

export function isScheiding(r: string): boolean {
  if (!isTabelRij(r)) return false;
  const cellen = splitCellen(r);
  return cellen.length > 0 && cellen.every((c) => /^:?-{1,}:?$/.test(c));
}

/**
 * Index in de bronnenlijst voor een `[Bron N]`-marker, of `null` als er geen
 * bron bij hoort (dangling verwijzing — de renderer markeert die zichtbaar).
 * `[Bron 0]` levert index -1 en dus `null`; dat is het bestaande gedrag.
 */
export function bronIndexVoor(nummer: number, aantalBronnen: number): number | null {
  const idx = nummer - 1;
  if (idx < 0 || idx >= aantalBronnen) return null;
  return idx;
}

// ── Kolomuitlijning ──────────────────────────────────────────────────────────
// Een kolom met uitsluitend datums, bedragen, percentages of een duur ("6 weken")
// wordt rechts uitgelijnd met tabulaire cijfers. De regel is DETERMINISTISCH op
// de celinhoud — geen modelbeslissing en geen promptinstructie, zodat dezelfde
// tabel altijd dezelfde uitlijning krijgt.
//
// NB: markdown-uitlijningsdubbelepunten (|---:|) worden bewust NIET gebruikt;
// de parser bewaart die niet en het model zet ze onbetrouwbaar.

const MAANDEN =
  "januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december|jan|feb|mrt|apr|jun|jul|aug|sept|sep|okt|nov|dec";

/** Celinhouden die de kolom niet breken maar ook niet numeriek maken. */
const NEUTRALE_CEL = /^(|-|–|—|n\.v\.t\.|nvt|n\/a|onbekend|pm|p\.m\.)$/i;

const NUMERIEKE_PATRONEN: RegExp[] = [
  // Datum: 18-09-2026, 18/09/2026, 2026-09-18, 18 september 2026, sep 2026
  /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/,
  /^\d{4}-\d{2}-\d{2}$/,
  new RegExp(`^\\d{1,2}\\s(${MAANDEN})\\.?\\s\\d{4}$`, "i"),
  new RegExp(`^(${MAANDEN})\\.?\\s\\d{4}$`, "i"),
  // Kwartaal/jaar: Q3 2026, 2026 Q3, 2026, 2026/2027
  /^(Q[1-4]|K[1-4])\s?\d{4}$/i,
  /^\d{4}\s?(Q[1-4]|K[1-4])$/i,
  /^\d{4}(\/\d{4})?$/,
  // Bedrag: € 1.250.000, € 1.250,-, -1.250,50, $ 12,5 mln, 3,4 mld, 1.250 euro
  /^[€$£]\s?-?\d{1,3}(\.\d{3})*(,(\d+|-))?(\s?(mln|mld|miljoen|miljard|k))?$/i,
  /^-?\d{1,3}(\.\d{3})*(,\d+)?\s?(mln|mld|miljoen|miljard|euro)$/i,
  // Percentage: 4,2%, -0.5 %, ± 3%
  /^[+-±]?\s?\d{1,3}([.,]\d+)?\s?%$/,
  // Kaal getal, met of zonder duizendscheiding: 12, 1.250, 1.250,50, 0,75
  /^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/,
  /^[+-]?\d+([.,]\d+)?$/,
  // Duur: 6 weken, 1 dag, 3 maanden, 2 kwartalen
  /^\d+([.,]\d+)?\s?(dag|dagen|week|weken|maand|maanden|kwartaal|kwartalen|jaar|jaren)$/i,
];

/** Is één celwaarde een datum, bedrag, percentage, getal of duur? */
export function isNumeriekeCel(waarde: string): boolean {
  const v = waarde.trim();
  if (!v) return false;
  return NUMERIEKE_PATRONEN.some((p) => p.test(v));
}

/**
 * Krijgt een kolom rechtse uitlijning? Ja als ALLE niet-neutrale bodycellen
 * numeriek zijn én er minstens één numerieke cel is. Lege cellen en streepjes
 * ("-", "n.v.t.") breken de kolom niet; een kolom die alleen daaruit bestaat
 * krijgt geen uitlijning.
 */
export function kolomIsNumeriek(cellen: string[]): boolean {
  let numeriek = 0;
  for (const cel of cellen) {
    const v = cel.trim();
    if (NEUTRALE_CEL.test(v)) continue;
    if (!isNumeriekeCel(v)) return false;
    numeriek++;
  }
  return numeriek > 0;
}

/** Platte tekst van een inline-AST; markers tellen als hun letterlijke notatie. */
export function celTekst(delen: InlineDeel[]): string {
  return delen
    .map((d) => {
      switch (d.soort) {
        case "tekst":
          return d.stukken.map((s) => s.tekst).join("");
        case "bron":
          return `[Bron ${d.nummer}]`;
        case "kennis":
          return `[${d.label}]`;
        case "toelichting":
          return "[Toelichting agendapunt]";
        case "organisatieprofiel":
          return "[Organisatieprofiel]";
      }
    })
    .join("");
}

/**
 * Per kolomindex: moet die rechts worden uitgelijnd? Gebaseerd op de bodyrijen;
 * de kopcel volgt de kolom (zoals in de stuurinformatie-tabellen).
 */
export function numeriekeKolommen(tabel: Extract<Blok, { soort: "tabel" }>): boolean[] {
  const aantal = Math.max(
    tabel.kop.length,
    ...tabel.rijen.map((r) => r.length),
    0,
  );
  const uit: boolean[] = [];
  for (let c = 0; c < aantal; c++) {
    const kolom = tabel.rijen
      .filter((r) => c < r.length)
      .map((r) => celTekst(r[c]));
    uit.push(kolomIsNumeriek(kolom));
  }
  return uit;
}

/**
 * Inline-markdown voor een tekstsegment zonder citatiemarkers. Subset: **vet**,
 * *cursief* / _cursief_, `code`. Vet wordt vóór cursief gematcht zodat ** niet
 * per ongeluk als twee losse * wordt gelezen.
 */
export function parseerInlineStukken(tekst: string): InlineStuk[] {
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  const uit: InlineStuk[] = [];
  tekst.split(regex).forEach((stuk, k) => {
    if (!stuk) return;
    if (/^\*\*[^*]+\*\*$/.test(stuk)) {
      uit.push({ k, soort: "vet", tekst: stuk.slice(2, -2) });
      return;
    }
    if (/^`[^`]+`$/.test(stuk)) {
      uit.push({ k, soort: "code", tekst: stuk.slice(1, -1) });
      return;
    }
    if (/^\*[^*]+\*$/.test(stuk) || /^_[^_]+_$/.test(stuk)) {
      uit.push({ k, soort: "cursief", tekst: stuk.slice(1, -1) });
      return;
    }
    uit.push({ k, soort: "plat", tekst: stuk });
  });
  return uit;
}

/**
 * Splitst één regel (of tabelcel) in citatiemarkers en tekstsegmenten.
 * De instantiedetectie bij [Algemene kennis]/[Volgens wetgeving] kijkt bewust
 * naar de HELE regel, niet naar het segment — zo is inline zichtbaar waaraan de
 * algemene kennis wordt toegeschreven (increment I-3).
 */
export function parseerInline(regel: string): InlineDeel[] {
  if (!regel) return [];
  // Reset regex state per call (g-flag is stateful op het Regexp-object)
  const regex = new RegExp(MARKER_REGEX.source, "gi");
  const uit: InlineDeel[] = [];
  regel.split(regex).forEach((deel, k) => {
    if (!deel) return;

    const bronMatch = deel.match(/^\[Bron (\d+)\]$/i);
    if (bronMatch) {
      uit.push({ k, soort: "bron", nummer: parseInt(bronMatch[1], 10) });
      return;
    }
    if (/^\[algemene kennis\]$/i.test(deel)) {
      uit.push({
        k,
        soort: "kennis",
        label: "Algemene kennis",
        instantie: detecteerInstantieInTekst(regel),
      });
      return;
    }
    if (/^\[volgens wetgeving\]$/i.test(deel)) {
      uit.push({
        k,
        soort: "kennis",
        label: "Volgens wetgeving",
        instantie: detecteerInstantieInTekst(regel),
      });
      return;
    }
    if (/^\[toelichting agendapunt\]$/i.test(deel)) {
      uit.push({ k, soort: "toelichting" });
      return;
    }
    if (/^\[organisatieprofiel\]$/i.test(deel)) {
      uit.push({ k, soort: "organisatieprofiel" });
      return;
    }
    uit.push({ k, soort: "tekst", stukken: parseerInlineStukken(deel) });
  });
  return uit;
}

/**
 * Blokniveau-parser: koppen (#..), opsommingen (- / *), genummerde lijsten (1.),
 * markdown-pipe-tabellen en alinea's. Bestand tegen half-gestreamde (nog niet
 * gesloten) markdown: een tabel zonder scheidingsregel blijft gewone tekst tot
 * die regel binnenkomt, en een afgekapte regel gooit nooit.
 */
export function parseerBlokken(tekst: string): Blok[] {
  const regels = tekst.split("\n");
  const blokken: Blok[] = [];
  let lijstType: "ul" | "ol" | null = null;
  let lijstItems: string[] = [];

  const sluitLijst = () => {
    if (!lijstType) return;
    blokken.push({
      soort: "lijst",
      geordend: lijstType === "ol",
      items: lijstItems.map((it) => parseerInline(it)),
    });
    lijstType = null;
    lijstItems = [];
  };

  for (let i = 0; i < regels.length; i++) {
    const regel = regels[i];

    // Tabelblok: kop + scheiding + alle aansluitende pipe-rijen als één tabel.
    if (isTabelRij(regel) && i + 1 < regels.length && isScheiding(regels[i + 1])) {
      sluitLijst();
      const kopCellen = splitCellen(regel);
      const rijen: string[][] = [];
      let j = i + 2;
      while (j < regels.length && isTabelRij(regels[j]) && !isScheiding(regels[j])) {
        rijen.push(splitCellen(regels[j]));
        j++;
      }
      blokken.push({
        soort: "tabel",
        kop: kopCellen.map((c) => parseerInline(c)),
        rijen: rijen.map((rij) => rij.map((c) => parseerInline(c))),
      });
      i = j - 1; // de for-lus verhoogt i weer
      continue;
    }

    // Thematic break (---, ***, ___): een markdown-scheidingslijn. De parser
    // kende die niet, waardoor een losse '---' als letterlijke alinea in scherm,
    // klembord én Word-export belandde (T5 A2). Een scheidingslijn draagt geen
    // inhoud; we slaan hem over (en sluiten een lopende lijst netjes af). Bewust
    // de niet-gespatieerde vorm: '- - -' zou botsen met een opsommingsteken.
    // De tabel-scheidingsrij (|---|---|) is hierboven al afgehandeld en bevat
    // pipes, dus die matcht deze test niet.
    if (/^\s*([-*_])\1{2,}\s*$/.test(regel)) {
      sluitLijst();
      continue;
    }

    const ul = regel.match(/^\s*[-*]\s+(.*)$/);
    const ol = regel.match(/^\s*\d+\.\s+(.*)$/);
    const kop = regel.match(/^(#{1,6})\s+(.*)$/);

    if (ul) {
      if (lijstType !== "ul") sluitLijst();
      lijstType = "ul";
      lijstItems.push(ul[1]);
      continue;
    }
    if (ol) {
      if (lijstType !== "ol") sluitLijst();
      lijstType = "ol";
      lijstItems.push(ol[1]);
      continue;
    }

    sluitLijst();

    if (kop) {
      blokken.push({
        soort: "kop",
        niveau: kop[1].length,
        inline: parseerInline(kop[2]),
      });
      continue;
    }
    if (!regel.trim()) continue; // lege regel = alinea-scheiding (spacing via mt)

    blokken.push({ soort: "alinea", inline: parseerInline(regel) });
  }
  sluitLijst();
  return blokken;
}
