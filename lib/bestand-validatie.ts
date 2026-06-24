// ============================================================================
//  Fail-closed uploadvalidatie voor de generieke documentcuratie (FO §8.2).
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

export type ValidatieFoutcode =
  | "leeg_bestand"
  | "te_groot"
  | "type_niet_ondersteund"
  | "magic_bytes_mismatch"
  | "ooxml_subtype_mismatch";

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

  // OOXML: verifieer dat het zip-archief écht het geclaimde subtype is.
  if (bestandstype !== "pdf") {
    const klopt = await ooxmlSubtypeKlopt(buffer, bestandstype);
    if (!klopt) {
      return {
        ok: false,
        foutcode: "ooxml_subtype_mismatch",
        melding: "Het Office-bestand is niet van het opgegeven type.",
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
