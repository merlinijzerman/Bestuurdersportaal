// ============================================================================
//  Fail-closed uploadvalidatie — GEDEELD door beide uploadpaden (FO §8.2).
// ----------------------------------------------------------------------------
//  H-07 (review 2026-07-30): deze module stond in platform/lib en werd daardoor
//  alléén door de generieke curatie gebruikt. Het pad waarlangs ALLE
//  fondsdocumenten binnenkomen (/api/documents/upload) valideerde niets van
//  onderstaande — geen groottelimiet, geen magic bytes, geen naam-normalisatie,
//  geen dedup. De strengste laag zat dus op het pad met het laagste volume.
//  De module is puur (geen service-role, geen DB) en hoort daarom in core/,
//  waar beide surfaces hem mogen importeren zonder de laaggrens te schenden.
// ----------------------------------------------------------------------------
//  Defense-in-depth vóór een geüpload bestand de pipeline in mag:
//    1. niet leeg / niet groter dan MAX_BESTAND_BYTES;
//    2. extensie + opgegeven MIME → kandidaat-bestandstype (bepaalBestandstype);
//    3. magic-bytes-controle: de werkelijke container moet bij dat type passen
//       (PDF → %PDF; docx/pptx/xlsx → ZIP/OOXML) — fail-closed bij mismatch;
//    4. OOXML-subtypecontrole: het zip-archief moet de juiste markerentry
//       bevatten (een .pptx die eigenlijk een .docx is, wordt zo geweigerd);
//    5. bestandsnaam-normalisatie (path-stripping, traversal-preventie, witte lijst);
//    6. sha256-inhoudshash t.b.v. deduplicatie (ux_documenten_generiek_hash).
//
//  Fail-closed: bij twijfel WEIGEREN. Alle takken geven een gestructureerde
//  foutcode terug; de server-action vertaalt die naar verwerkingsstatus
//  'geweigerd'/'gequarantineerd' + een platform_event_log-result.
//
//  Bewust GEEN malwarescan hier: die is uitgesteld (WP3, decisions/0022). De
//  scan-stap in de pipeline is nu een gemockte fail-closed plek; deze module
//  dekt het structurele deel (criterium #5: magic-bytes/subtype-mismatch).
//
//  Puur + los testbaar (bestand-validatie.sanity.ts): geen "server-only",
//  geen DB. De feitelijke dedup-LOOKUP (hash al aanwezig?) doet de server-action
//  tegen de DB; deze module levert alleen de hash.
// ============================================================================

import { createHash } from "node:crypto";
import JSZip from "jszip";
import {
  bepaalBestandstype,
  CONTENT_TYPE_PER_BESTANDSTYPE,
  type Bestandstype,
} from "./document-extractie";

// 25 MB. Ruim voor sectorbrede beleidsdocumenten/presentaties; dempt
// resource-uitputting door extreem grote uploads (fail-closed boven de grens).
export const MAX_BESTAND_BYTES = 25 * 1024 * 1024;

// ── Decompressiebudget (zip bomb) ──────────────────────────────────────────
// H-07: MAX_BESTAND_BYTES geldt op het GECOMPRIMEERDE bestand. Een OOXML-
// archief van 2 MB kan naar gigabytes uitpakken; `JSZip.loadAsync` +
// `.async("string")` per slide/sheet blaast dan het geheugen op vóórdat de
// ingest-caps (MAX_CHUNKS_PER_DOCUMENT, MAX_XLSX_RIJEN_PER_TABBLAD) grijpen —
// die werken immers pas op de al geëxtraheerde tekst.
//
// Twee onafhankelijke grenzen, beide fail-closed:
//   1. absolute uitgepakte grootte — voorkomt OOM;
//   2. compressieratio — vangt het klassieke bomb-patroon (klein bestand,
//      extreem hoge ratio).
// De ratio-grens geldt pas boven een ondergrens: kleine XML-archieven hebben
// van nature een hoge ratio (veel herhalende tags) zonder risico te vormen.
export const MAX_UITGEPAKT_BYTES = 200 * 1024 * 1024; // 200 MB
export const MAX_COMPRESSIE_RATIO = 120;
export const RATIO_ONDERGRENS_BYTES = 5 * 1024 * 1024; // ratio pas toetsen boven 5 MB uitgepakt

export type ValidatieFoutcode =
  | "leeg_bestand"
  | "te_groot"
  | "type_niet_ondersteund"
  | "magic_bytes_mismatch"
  | "ooxml_subtype_mismatch"
  | "decompressie_cap";

export type ValidatieResultaat =
  | {
      ok: true;
      bestandstype: Bestandstype;
      veiligeNaam: string;
      hash: string;
      /** Uit de inhoud gesnifte MIME (na subtypecontrole), niet de opgegeven. */
      mimeGedetecteerd: string;
      grootte: number;
    }
  | { ok: false; foutcode: ValidatieFoutcode; melding: string };

// ── Magic-bytes (containerniveau) ──────────────────────────────────────────
// PDF begint met "%PDF"; alle OOXML-formaten (docx/pptx/xlsx) zijn ZIP-archieven
// die met de lokale-header-signature "PK\x03\x04" beginnen.
export type Container = "pdf" | "zip" | "onbekend";

export function containerVanMagicBytes(buffer: Buffer): Container {
  if (buffer.length >= 4) {
    if (
      buffer[0] === 0x25 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x44 &&
      buffer[3] === 0x46
    )
      return "pdf"; // %PDF
    if (
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      buffer[2] === 0x03 &&
      buffer[3] === 0x04
    )
      return "zip"; // PK\x03\x04
  }
  return "onbekend";
}

// Welke container hoort bij welk logisch bestandstype.
function verwachteContainer(bestandstype: Bestandstype): Container {
  return bestandstype === "pdf" ? "pdf" : "zip";
}

// ── OOXML-subtype: de juiste markerentry in het zip-archief ─────────────────
// Onderscheidt docx/pptx/xlsx (zelfde magic bytes) op de daadwerkelijke inhoud.
const OOXML_MARKER: Record<"docx" | "pptx" | "xlsx", string> = {
  docx: "word/document.xml",
  pptx: "ppt/presentation.xml",
  xlsx: "xl/workbook.xml",
};

async function ooxmlSubtypeKlopt(
  buffer: Buffer,
  bestandstype: "docx" | "pptx" | "xlsx"
): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    return zip.file(OOXML_MARKER[bestandstype]) !== null;
  } catch {
    return false; // onleesbaar zip → fail-closed
  }
}

// ── Decompressiebudget ─────────────────────────────────────────────────────
/** Uitkomst van de zip-bomb-controle. `uitgepakt` is de som van de
 *  ONGECOMPRIMEERDE groottes uit de centrale directory — die staat in de
 *  headers, dus dit vereist géén daadwerkelijke decompressie. */
export type DecompressieOordeel =
  | { ok: true; uitgepakt: number; ratio: number }
  | { ok: false; reden: "te_groot_uitgepakt" | "ratio_te_hoog"; uitgepakt: number; ratio: number };

export async function beoordeelDecompressie(buffer: Buffer): Promise<DecompressieOordeel> {
  let uitgepakt = 0;
  try {
    const zip = await JSZip.loadAsync(buffer);
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      // JSZip legt de uncompressedSize uit de zip-header vast op `_data`. Het
      // veld staat niet in de publieke typing; vandaar de smalle cast — we
      // lezen alleen een getal en vallen fail-closed terug op 0 als het
      // ontbreekt (dan grijpt de ratio-check niet, maar de absolute wél zodra
      // een andere entry hem overschrijdt).
      const data = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
      uitgepakt += data?.uncompressedSize ?? 0;
    }
  } catch {
    // Onleesbaar archief → fail-closed. ooxmlSubtypeKlopt weigert hier ook al op.
    return { ok: false, reden: "te_groot_uitgepakt", uitgepakt: 0, ratio: 0 };
  }

  const ratio = buffer.length > 0 ? uitgepakt / buffer.length : 0;

  if (uitgepakt > MAX_UITGEPAKT_BYTES) {
    return { ok: false, reden: "te_groot_uitgepakt", uitgepakt, ratio };
  }
  if (uitgepakt > RATIO_ONDERGRENS_BYTES && ratio > MAX_COMPRESSIE_RATIO) {
    return { ok: false, reden: "ratio_te_hoog", uitgepakt, ratio };
  }
  return { ok: true, uitgepakt, ratio };
}

// ── Veilige bestandsnaam voor logregels ────────────────────────────────────
/** L-07: `file.name` is ruwe gebruikersinvoer. Newlines vervalsen logregels in
 *  de Vercel-logs, en een bestandsnaam is vaak zélf een persoonsgegeven
 *  ("Beoordelingsgesprek J. Jansen.pdf") dat anders in een logstroom met een
 *  andere retentie en toegang belandt. Deze helper normaliseert de naam én
 *  kort hem in, zodat een logregel bruikbaar blijft voor diagnose zonder de
 *  volledige naam te bewaren. */
export function logNaam(ruw: string | null | undefined): string {
  if (!ruw) return "onbekend";
  const veilig = normaliseerBestandsnaam(ruw);
  return veilig.length > 40 ? `${veilig.slice(0, 37)}…` : veilig;
}

// ── Bestandsnaam-normalisatie ──────────────────────────────────────────────
// Strip padcomponenten (basename), normaliseer Unicode (NFC), houd alleen een
// veilige witte lijst over en voorkom path-traversal. Lege uitkomst → fallback.
export function normaliseerBestandsnaam(ruw: string): string {
  const basename = ruw.split(/[\\/]/).pop() ?? ruw;
  const genormaliseerd = basename
    .normalize("NFC")
    .replace(/[^\w .\-]+/g, "_") // alleen letters/cijfers/_ . spatie -
    .replace(/\.{2,}/g, ".") // geen ".." → traversal-preventie
    .replace(/\s+/g, " ")
    .replace(/^[ ._-]+/, "") // geen leidende punt/spatie/streep (dotfiles)
    .trim()
    .slice(0, 200);
  return genormaliseerd.length > 0 ? genormaliseerd : "document";
}

export function bestandHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// ── Hoofd-entrypoint ───────────────────────────────────────────────────────
// Async vanwege de OOXML-subtypecontrole (JSZip). Geeft fail-closed een
// foutcode terug; alleen bij ok=true mag het bestand de pipeline in.
export async function valideerUpload(input: {
  naam: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<ValidatieResultaat> {
  const { buffer } = input;

  if (buffer.length === 0) {
    return { ok: false, foutcode: "leeg_bestand", melding: "Het bestand is leeg." };
  }
  if (buffer.length > MAX_BESTAND_BYTES) {
    return {
      ok: false,
      foutcode: "te_groot",
      melding: `Bestand groter dan ${Math.round(MAX_BESTAND_BYTES / 1024 / 1024)} MB.`,
    };
  }

  // Kandidaat-type uit extensie + opgegeven MIME (hergebruik van de bestaande
  // detectie; een File-shim volstaat — bepaalBestandstype leest alleen name/type).
  const bestandstype = bepaalBestandstype({
    name: input.naam,
    type: input.mimeType,
  } as File);
  if (!bestandstype) {
    return {
      ok: false,
      foutcode: "type_niet_ondersteund",
      melding: "Alleen PDF, DOCX, PPTX en XLSX zijn toegestaan.",
    };
  }

  // Magic-bytes moeten bij de containerfamilie van dat type passen.
  const container = containerVanMagicBytes(buffer);
  if (container !== verwachteContainer(bestandstype)) {
    return {
      ok: false,
      foutcode: "magic_bytes_mismatch",
      melding:
        "De bestandsinhoud komt niet overeen met de extensie/het MIME-type.",
    };
  }

  // OOXML: verifieer dat het zip-archief écht het geclaimde subtype is, en dat
  // het binnen het decompressiebudget blijft (zip bomb, H-07). De budgetcheck
  // leest alleen de zip-headers — er wordt niets uitgepakt.
  if (bestandstype !== "pdf") {
    const klopt = await ooxmlSubtypeKlopt(buffer, bestandstype);
    if (!klopt) {
      return {
        ok: false,
        foutcode: "ooxml_subtype_mismatch",
        melding: "Het Office-bestand is niet van het opgegeven type.",
      };
    }

    const budget = await beoordeelDecompressie(buffer);
    if (!budget.ok) {
      return {
        ok: false,
        foutcode: "decompressie_cap",
        melding:
          budget.reden === "ratio_te_hoog"
            ? "Dit bestand pakt onevenredig groot uit en is daarom geweigerd."
            : "Dit bestand pakt te groot uit en is daarom geweigerd.",
      };
    }
  }

  return {
    ok: true,
    bestandstype,
    veiligeNaam: normaliseerBestandsnaam(input.naam),
    hash: bestandHash(buffer),
    mimeGedetecteerd: CONTENT_TYPE_PER_BESTANDSTYPE[bestandstype],
    grootte: buffer.length,
  };
}
