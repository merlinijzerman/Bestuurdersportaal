// ============================================================================
//  lib/xlsx-segment.ts — Fase 1 xlsx-segmentatie (bouwticket "Async document-
//  ingest + ingest-caps").
// ----------------------------------------------------------------------------
//  Pure logica die de rijen van één xlsx-tabblad omzet in CHUNK-VRIENDELIJKE
//  segmenten: elk segment is een kleine markdown-tabel met de KOPREGEL herhaald
//  en hooguit XLSX_DOELGROOTTE_CHARS aan tekst, zodat:
//    - hele rijen intact blijven (geen afkappen middenin een rij), en
//    - elk segment in lib/chunking.ts één nette tabel-unit/chunk wordt.
//
//  Vervangt de oude aanpak (één giant tabel-unit van het hele tabblad, op
//  WOORDgrenzen gesplitst) die een dataset tot duizenden willekeurige chunks
//  opblies. Geen DB/IO/zware imports → los testbaar (lib/xlsx-segment.sanity.ts).
//
//  Werkhypothese: rij 0 is de kopregel. Bij overschrijding van de rij-cap gooit
//  deze module een IngestCapError (de upload-route vertaalt die naar 413).
// ============================================================================

import type { TekstSegment } from "./document-extractie";
import {
  IngestCapError,
  MAX_XLSX_RIJEN_PER_TABBLAD,
  XLSX_DOELGROOTTE_CHARS,
  xlsxRijenMelding,
} from "./ingest-caps";

// Markdown-cel: trim + ontsmet pipes/newlines zodat de tabel niet kapot loopt.
function formatCel(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val).trim().replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

// Maak alle rijen even breed (gevuld tot `breedte`), als geformatteerde cellen.
function padRij(rij: unknown[], breedte: number): string[] {
  const result: string[] = [];
  for (let i = 0; i < breedte; i++) result.push(formatCel(rij[i]));
  return result;
}

// Segmenteer één tabblad in chunk-vriendelijke markdown-blokken.
//   - rijen: 2D-array (header op index 0), zoals XLSX.utils.sheet_to_json(header:1)
//   - Gooit IngestCapError als het aantal datarijen de cap overschrijdt.
//   - Lege/0-koloms tabbladen leveren een lege lijst (geen segment).
export function segmenteerTabblad(
  sheetnaam: string,
  rijen: unknown[][]
): TekstSegment[] {
  if (rijen.length === 0) return [];

  // Cap-controle op datarijen (exclusief kopregel) vóór we tekst opbouwen.
  const aantalDataRijen = rijen.length - 1;
  if (aantalDataRijen > MAX_XLSX_RIJEN_PER_TABBLAD) {
    throw new IngestCapError(xlsxRijenMelding(sheetnaam, aantalDataRijen));
  }

  const breedte = rijen.reduce((max, rij) => Math.max(max, rij.length), 0);
  if (breedte === 0) return [];

  const kop = `## Tabblad: ${sheetnaam}`;
  const headerCellen = padRij(rijen[0], breedte);
  const headerLijn = `| ${headerCellen.join(" | ")} |`;
  const scheiderLijn = `| ${headerCellen.map(() => "---").join(" | ")} |`;
  // Vaste voorvervoeging (kop + kopregel + scheider) die elk blok herhaalt.
  const voorvoegsel = `${kop}\n\n${headerLijn}\n${scheiderLijn}`;
  const paragraaf = `Tabblad: ${sheetnaam}`;

  const segmenten: TekstSegment[] = [];
  let blok: string[] = [];
  let blokChars = 0;
  let startRij = 1; // 1-based datarij-index (na de kopregel)

  const flush = (eindRij: number) => {
    if (blok.length === 0) return;
    const tekst = `${voorvoegsel}\n${blok.join("\n")}`;
    segmenten.push({
      pagina: null,
      // Rijbereik in de paragraaf-locatie → betekenisvolle bronvermelding.
      paragraaf: `${paragraaf} (rijen ${startRij}–${eindRij})`,
      tekst,
    });
    blok = [];
    blokChars = 0;
  };

  for (let i = 1; i < rijen.length; i++) {
    const lijn = `| ${padRij(rijen[i], breedte).join(" | ")} |`;
    // Nieuw blok wanneer toevoegen de doelgrootte zou overschrijden (maar laat
    // altijd minstens één rij toe, ook als die zelf al groot is).
    if (blok.length > 0 && voorvoegsel.length + blokChars + lijn.length + 1 > XLSX_DOELGROOTTE_CHARS) {
      flush(i - 1);
      startRij = i;
    }
    blok.push(lijn);
    blokChars += lijn.length + 1;
  }
  flush(rijen.length - 1);

  return segmenten;
}
