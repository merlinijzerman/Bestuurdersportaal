// ============================================================
//  lib/chunking.ts — pure chunk-helpers voor de RAG-pipeline.
//
//  Geen Supabase- of extractie-runtime-imports, zodat dit zuiver en
//  deterministisch te testen is (zelfde principe als lib/stemming.ts en
//  lib/rag-select.ts). Wordt door lib/rag.ts (re-export) en de upload-route
//  gebruikt.
// ============================================================

import type { TekstSegment } from "./document-extractie";

// Eén chunk met herkomst-locatie, klaar voor opslag in document_chunks.
export interface ChunkMetLocatie {
  tekst: string;
  pagina: number | null;
  paragraaf: string | null;
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
export function maakChunksUitSegmenten(
  segmenten: TekstSegment[],
  chunkGrootte = 800,
  overlap = 100
): ChunkMetLocatie[] {
  const result: ChunkMetLocatie[] = [];
  for (const seg of segmenten) {
    for (const tekst of maakChunks(seg.tekst, chunkGrootte, overlap)) {
      result.push({ tekst, pagina: seg.pagina, paragraaf: seg.paragraaf });
    }
  }
  return result;
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
