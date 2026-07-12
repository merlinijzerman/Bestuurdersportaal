// ============================================================
//  lib/chunking.ts — pure chunk-helpers voor de RAG-pipeline.
//
//  Geen Supabase- of extractie-runtime-imports, zodat dit zuiver en
//  deterministisch te testen is (zelfde principe als lib/stemming.ts en
//  lib/rag-select.ts). Wordt door lib/rag.ts (re-export) en de upload-route
//  gebruikt.
// ============================================================

import type { TekstSegment } from "./document-extractie";

// R1.1 — het soort documentstructuur waar een chunk uit komt. "tekst" = lopende
// tekst zonder herkende structuur (gedraagt zich als de oude lengte-chunking).
export type StructuurType =
  | "artikel"
  | "paragraaf"
  | "definitie"
  | "besluit"
  | "tabel"
  | "kop"
  | "tekst";

// Eén chunk met herkomst-locatie, klaar voor opslag in document_chunks.
// R1.1 voegt structuur-metadata toe BOVENOP pagina/paragraaf (beide optioneel,
// zodat bestaande lezers van tekst/pagina/paragraaf ongemoeid blijven).
export interface ChunkMetLocatie {
  tekst: string;
  pagina: number | null;
  paragraaf: string | null;
  structuur_type?: StructuurType;
  structuur_label?: string | null;
}

// Eén structuur-unit: een aaneengesloten blok tekst tussen twee structuurgrenzen
// (kop/§/artikel/definitie/besluit/tabel). Chunks lopen NOOIT over een unitgrens.
export interface StructuurUnit {
  type: StructuurType;
  label: string | null;
  tekst: string;
}

// Verwerk geëxtraheerde tekst in chunks voor RAG-opslag.
//
// Strategie — drie niveaus van splitsing, in afnemende kwaliteit:
//   1. Paragrafen (\n{2,})   → ideaal, behoudt semantische blokken
//   2. Zinnen (. / ? / !)    → fallback als een paragraaf > chunkGrootte is
//   3. Woorden (spaties)     → laatste redmiddel; voorkomt afkappen midden-woord
//
// Tussen chunks houden we een kleine overlap aan zodat zoek-hits aan de rand
// van een chunk nog context meekrijgen.
export function maakChunks(
  tekst: string,
  chunkGrootte = 800,
  overlap = 100
): string[] {
  // Stap 1: splits op paragraaf-grenzen.
  const alineas = tekst.split(/\n{2,}/).map((a) => a.trim()).filter(Boolean);

  // Stap 2: splits te grote alinea's verder op zinsgrenzen, en zinnen die
  // nog steeds te groot zijn op woordgrenzen. Resultaat: een lijst van
  // "atomen" die elk binnen chunkGrootte passen.
  const atomen: string[] = [];
  for (const alinea of alineas) {
    if (alinea.length <= chunkGrootte) {
      atomen.push(alinea);
    } else {
      atomen.push(...splitsOpZinnen(alinea, chunkGrootte));
    }
  }

  // Stap 3: pak atomen samen tot chunks die ongeveer chunkGrootte groot zijn.
  const chunks: string[] = [];
  let huidig = "";
  for (const atoom of atomen) {
    if ((huidig + "\n\n" + atoom).length > chunkGrootte && huidig) {
      chunks.push(huidig.trim());
      // Overlap: pak laatste paar woorden van de vorige chunk mee als context.
      const woorden = huidig.split(/\s+/);
      const overlapWoorden = Math.max(1, Math.floor(overlap / 6));
      huidig = woorden.slice(-overlapWoorden).join(" ") + "\n\n" + atoom;
    } else {
      huidig = huidig ? huidig + "\n\n" + atoom : atoom;
    }
  }

  if (huidig.trim()) {
    chunks.push(huidig.trim());
  }

  return chunks.filter((c) => c.length > 50); // Filter te kleine chunks
}

// Chunk per segment en tag elke chunk met de pagina/paragraaf van dat segment.
// Een chunk loopt dus nooit over een paginagrens heen — minder vloeiend, maar
// exact wat je wilt voor een betrouwbare bronvermelding ("pag. X" / "Tabblad: Y").
//
// R1.1 — binnen elk segment splitsen we eerst op DOCUMENTSTRUCTUUR (kop/§/artikel/
// definitie/besluit/tabel) en chunken we pas BINNEN een structuur-unit. Een chunk
// loopt daardoor nooit over een structuurgrens (en de overlap blijft binnen de
// unit). Elke chunk erft de structuur-metadata van zijn unit. Documenten zonder
// herkenbare structuur leveren één "tekst"-unit op → identiek aan de oude
// lengte-chunking.
export function maakChunksUitSegmenten(
  segmenten: TekstSegment[],
  chunkGrootte = 800,
  overlap = 100
): ChunkMetLocatie[] {
  const result: ChunkMetLocatie[] = [];
  for (const seg of segmenten) {
    for (const unit of splitsInStructuurUnits(seg.tekst)) {
      for (const tekst of chunkUnit(unit, chunkGrootte, overlap)) {
        result.push({
          tekst,
          pagina: seg.pagina,
          paragraaf: seg.paragraaf,
          structuur_type: unit.type,
          structuur_label: unit.label,
        });
      }
    }
  }
  return result;
}

// Chunk de tekst van één structuur-unit. Past de unit binnen één chunk, dan houden
// we hem heel — ook onder de 50-tekens-ondergrens van maakChunks, zodat een korte
// definitie/artikel/besluit niet wegvalt. Past hij niet, dan splitsen we hem met
// de lengte-chunker (overlap blijft dus binnen de unit, nooit over de grens).
function chunkUnit(
  unit: StructuurUnit,
  chunkGrootte: number,
  overlap: number
): string[] {
  const tekst = unit.tekst.trim();
  if (!tekst) return [];
  // Tabellen nooit op zinsgrens knippen; alleen bij extreme lengte op woorden.
  if (unit.type === "tabel") {
    return tekst.length <= chunkGrootte
      ? [tekst]
      : splitsOpWoorden(tekst, chunkGrootte);
  }
  if (tekst.length <= chunkGrootte) {
    // Structuur-units met een herkende grens houden we heel (geen 50-char-filter);
    // pure "tekst"-units volgen de bestaande filtering via maakChunks.
    if (unit.type !== "tekst") return [tekst];
    return maakChunks(tekst, chunkGrootte, overlap);
  }
  return maakChunks(tekst, chunkGrootte, overlap);
}

// ── R1.1 — structuurdetectie ─────────────────────────────────────
// Splits een segmenttekst in structuur-units op regelniveau. Een nieuwe unit
// begint bij een herkende structuurgrens; tussenliggende regels horen bij de
// lopende unit. Conservatief afgesteld op Nederlandse bestuurs-/pensioendocumenten
// om valse grenzen (en dus over-fragmentatie) te vermijden.
export function splitsInStructuurUnits(tekst: string): StructuurUnit[] {
  const regels = tekst.split("\n");
  const units: StructuurUnit[] = [];
  let huidig: StructuurUnit | null = null;
  let inDefinitieSectie = false;

  for (const ruw of regels) {
    const regel = ruw;
    const grens = detecteerGrens(regel.trim(), inDefinitieSectie);
    // Een tabelregel die direct op een tabel-unit volgt, hoort bij die unit.
    const isVervolgTabel =
      grens?.type === "tabel" && huidig !== null && huidig.type === "tabel";
    if (grens && !isVervolgTabel) {
      // Nieuwe structuur-unit; sluit de lopende af.
      if (huidig) units.push(huidig);
      huidig = { type: grens.type, label: grens.label, tekst: regel };
    } else if (huidig) {
      huidig.tekst += "\n" + regel;
    } else {
      huidig = { type: "tekst", label: null, tekst: regel };
    }
    if (grens) {
      // Definitie-sectie-vlag: aan bij een definitie-kop, uit bij een hogere grens.
      if (grens.opentDefinitieSectie) inDefinitieSectie = true;
      else if (grens.sluitDefinitieSectie) inDefinitieSectie = false;
    }
  }
  if (huidig) units.push(huidig);
  return units.length > 0 ? units : [{ type: "tekst", label: null, tekst }];
}

interface GrensTreffer {
  type: StructuurType;
  label: string | null;
  opentDefinitieSectie?: boolean;
  sluitDefinitieSectie?: boolean;
}

// Bepaalt of een (getrimde) regel een structuurgrens markeert. Volgorde =
// prioriteit. Geeft null als de regel gewoon doorlopende tekst is.
function detecteerGrens(
  regel: string,
  inDefinitieSectie: boolean
): GrensTreffer | null {
  if (!regel) return null;

  // Markdown-kop (o.a. XLSX "## Tabblad: X" → tabel).
  const kop = regel.match(/^#{1,6}\s+(.*)$/);
  if (kop) {
    const titel = kop[1].trim();
    if (/^Tabblad:/i.test(titel)) return { type: "tabel", label: titel, sluitDefinitieSectie: true };
    const opent = /\b(begripsbepalingen|begrippen|definities)\b/i.test(titel);
    return { type: opent ? "definitie" : "kop", label: titel, opentDefinitieSectie: opent, sluitDefinitieSectie: !opent };
  }

  // Markdown-tabelregel.
  if (/^\|.*\|\s*$/.test(regel)) return { type: "tabel", label: null, sluitDefinitieSectie: true };

  // Artikel.
  const art = regel.match(/^(?:Artikel|Art\.)\s+(\d+[a-z]?)\b/i);
  if (art) {
    const opent = /\b(begripsbepalingen|begrippen|definities)\b/i.test(regel);
    return {
      type: opent ? "definitie" : "artikel",
      label: `Artikel ${art[1]}`,
      opentDefinitieSectie: opent,
      sluitDefinitieSectie: !opent,
    };
  }

  // Paragraaf §.
  const par = regel.match(/^§\s*(\d+(?:\.\d+)*)/);
  if (par) return { type: "paragraaf", label: `§${par[1]}`, sluitDefinitieSectie: true };

  // Besluit.
  if (/^(Voorgenomen\s+besluit|Het\s+bestuur\s+besluit|Concept-?besluit|Besluit)\b/i.test(regel)) {
    return { type: "besluit", label: "Besluit", sluitDefinitieSectie: true };
  }

  // Genummerde kop ("3 Beleid", "3.2.1 Risicohouding") — kort, begint met
  // hoofdletter na het nummer; geen doorlopende zin. Lengtegrens tegen valse hits.
  const genummerd = regel.match(/^(\d+(?:\.\d+){0,3})\.?\s+\p{Lu}[^\n]{0,118}$/u);
  if (genummerd && !/[.!?]$/.test(regel)) {
    return { type: "paragraaf", label: genummerd[1], sluitDefinitieSectie: true };
  }

  // Binnen een definitie-sectie: term-/opsommingsregel = nieuwe definitie-unit.
  if (inDefinitieSectie) {
    if (/^(?:[a-z]|\d{1,2})[.)]\s+\S/.test(regel) || /^[“"„]?\p{Lu}[\p{L}\- ]{1,40}["”’]?\s*[:=]\s+\S/u.test(regel)) {
      return { type: "definitie", label: null };
    }
  }

  return null;
}

// Splits een (te groot) tekstblok op zinsgrenzen. Als één zin zelf nog te
// groot is (zeldzaam, maar bv. juridische opsommingen) splitsen we op woorden.
function splitsOpZinnen(blok: string, maxGrootte: number): string[] {
  // Zinsgrens: punt/vraagteken/uitroepteken gevolgd door whitespace en hoofdletter
  // of einde-tekst. Houdt afkortingen niet 100% goed maar is robuust genoeg
  // voor Nederlandse bestuursdocumenten.
  const zinnen = blok
    .split(/(?<=[.!?])\s+(?=[A-Z"“(])/)
    .map((z) => z.trim())
    .filter(Boolean);

  const result: string[] = [];
  for (const zin of zinnen) {
    if (zin.length <= maxGrootte) {
      result.push(zin);
    } else {
      // Zin nog steeds te groot — splits op woordgrenzen.
      result.push(...splitsOpWoorden(zin, maxGrootte));
    }
  }
  return result;
}

function splitsOpWoorden(tekst: string, maxGrootte: number): string[] {
  const woorden = tekst.split(/\s+/);
  const result: string[] = [];
  let huidig = "";
  for (const woord of woorden) {
    if ((huidig + " " + woord).length > maxGrootte && huidig) {
      result.push(huidig);
      huidig = woord;
    } else {
      huidig = huidig ? huidig + " " + woord : woord;
    }
  }
  if (huidig) result.push(huidig);
  return result;
}
