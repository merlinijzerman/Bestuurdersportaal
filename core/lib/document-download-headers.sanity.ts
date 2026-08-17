import {
  bepaalBestandsnaam,
  bepaalContentType,
  normaliseerBestandstype,
  ONBEKEND_CONTENT_TYPE,
} from "./document-download-headers";

function check(naam: string, waarde: boolean) {
  if (!waarde) throw new Error(`FAALT: ${naam}`);
  console.log(`OK: ${naam}`);
}

// ── Geldige types houden hun eigen content-type ──────────────────────────────
check("pdf -> application/pdf", bepaalContentType("pdf") === "application/pdf");
check("docx -> Word-type", bepaalContentType("docx").includes("wordprocessingml"));
check("xlsx -> Excel-type", bepaalContentType("xlsx").includes("spreadsheetml"));
check("pptx -> PowerPoint-type", bepaalContentType("pptx").includes("presentationml"));

// ── De twee randen die WP4 repareert ─────────────────────────────────────────
// Vóór deze wijziging werd een leeg/null type stilzwijgend application/pdf, en
// leverde een ongeldig-maar-niet-leeg type `undefined` als Content-Type op.
check("null wordt NIET pdf", bepaalContentType(null) === ONBEKEND_CONTENT_TYPE);
check("undefined wordt NIET pdf", bepaalContentType(undefined) === ONBEKEND_CONTENT_TYPE);
check("lege string wordt NIET pdf", bepaalContentType("") === ONBEKEND_CONTENT_TYPE);
check("onbekend type levert nooit undefined", bepaalContentType("exe") === ONBEKEND_CONTENT_TYPE);
check("html wordt niet als html geserveerd", bepaalContentType("html") === ONBEKEND_CONTENT_TYPE);
check("svg wordt niet als svg geserveerd", bepaalContentType("svg") === ONBEKEND_CONTENT_TYPE);
check("niet-string type levert octet-stream", bepaalContentType({ a: 1 }) === ONBEKEND_CONTENT_TYPE);
check(
  "hoofdlettervariant telt niet als geldig type",
  bepaalContentType("PDF") === ONBEKEND_CONTENT_TYPE
);

// ── normaliseerBestandstype is de enige bron van 'geldig' ────────────────────
check("normaliseer geeft null bij onbekend", normaliseerBestandstype("exe") === null);
check("normaliseer geeft het type bij geldig", normaliseerBestandstype("pdf") === "pdf");

// ── Bestandsnaam ─────────────────────────────────────────────────────────────
check(
  "opgeslagen bestandsnaam wint",
  bepaalBestandsnaam("jaarverslag.pdf", "Jaarverslag", "pdf") === "jaarverslag.pdf"
);
check(
  "lege bestandsnaam valt terug op titel + extensie",
  bepaalBestandsnaam("", "Jaarverslag", "pdf") === "Jaarverslag.pdf"
);
check(
  "spaties-alleen telt als leeg",
  bepaalBestandsnaam("   ", "Jaarverslag", "pdf") === "Jaarverslag.pdf"
);
check(
  "zonder geldig type GEEN verzonnen extensie",
  bepaalBestandsnaam(null, "Jaarverslag", "exe") === "Jaarverslag"
);
check(
  "zonder geldig type en zonder bestandsnaam: kale titel",
  bepaalBestandsnaam(null, "Jaarverslag", null) === "Jaarverslag"
);
