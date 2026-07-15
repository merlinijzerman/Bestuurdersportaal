// ============================================================================
//  lib/pii-gate.ts — AVG-gate op de uitgaande zoekvraag (besluit 0072, FR-9).
// ----------------------------------------------------------------------------
//  Scenario A stuurt de vraag (indirect) naar een externe search-/fetch-provider.
//  AVG-lijn (Merlin/compliance): bevat de vraag persoons- of fondsgegevens, dan
//  wordt live web-retrieval GEBLOKKEERD (terugval op RAG/modelkennis) i.p.v. de
//  vraag te schonen — bij Route 1 genereert het model de zoekquery zelf, dus
//  schonen is niet waterdicht. De keuze wordt gelogd (retrieval_meta.web).
//
//  Conservatief maar niet overijverig: we detecteren harde PII-signalen (BSN,
//  e-mail, IBAN, telefoonnummer) en expliciete persoonsaanduidingen. Zuivere
//  beleids-/wetsvragen ("wat zegt de Pensioenwet over de solidariteitsreserve?")
//  bevatten geen PII en worden NIET geblokkeerd.
//
//  Pure functie, geen DB/fetch. Testbaar via lib/pii-gate.sanity.ts.
// ============================================================================

export type PiiSoort =
  | "bsn"
  | "email"
  | "iban"
  | "telefoon"
  | "persoonsaanduiding"
  | "fondsnaam";

export interface PiiUitkomst {
  bevatPii: boolean;
  soorten: PiiSoort[];
}

// 9 cijfers, eventueel met spaties/punten. Extra: elf-proef om ruis (willekeurige
// 9-cijferige getallen zoals bedragen) te beperken — alleen een geldige BSN telt.
function bevatBsn(tekst: string): boolean {
  const kandidaten = tekst.match(/\b\d{9}\b/g) ?? [];
  for (const k of kandidaten) {
    const c = k.split("").map(Number);
    // Elf-proef: 9*d1 + 8*d2 + … + 2*d8 + (-1)*d9 deelbaar door 11.
    const som =
      9 * c[0] + 8 * c[1] + 7 * c[2] + 6 * c[3] + 5 * c[4] + 4 * c[5] + 3 * c[6] + 2 * c[7] - c[8];
    if (som % 11 === 0) return true;
  }
  return false;
}

const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;
// NL IBAN: NL + 2 controlecijfers + 4 letters bankcode + 10 cijfers.
const IBAN_RE = /\bNL\d{2}\s?[A-Z]{4}(?:\s?\d){10}\b/i;
// NL telefoon: 06-nummers of 0xx(x)-nummers, met spaties/streepjes, of +31.
const TELEFOON_RE = /(?:\+31|\b0)\s?\d(?:[\s-]?\d){7,9}\b/;
// Expliciete persoonsaanduiding: aanhef + hoofdletterwoord.
const PERSOON_RE =
  /\b(?:dhr|mevr|mw|de heer|mevrouw|meneer|voorzitter|bestuurslid)\b\.?\s+[A-Z][a-z]+/;

/**
 * Detecteer persoons-/fondsgegevens in `vraag`. `fondsnamen` (optioneel) zijn de
 * bekende namen van het eigen fonds/de uitvoerders; een letterlijke vermelding
 * daarvan telt als fondsgegeven (dataminimalisatie richting externe provider).
 */
export function bevatPersoonsgegevens(
  vraag: string,
  fondsnamen: string[] = []
): PiiUitkomst {
  const soorten: PiiSoort[] = [];
  const tekst = vraag ?? "";

  if (bevatBsn(tekst)) soorten.push("bsn");
  if (EMAIL_RE.test(tekst)) soorten.push("email");
  if (IBAN_RE.test(tekst)) soorten.push("iban");
  if (TELEFOON_RE.test(tekst)) soorten.push("telefoon");
  if (PERSOON_RE.test(tekst)) soorten.push("persoonsaanduiding");

  const lower = tekst.toLowerCase();
  for (const naam of fondsnamen) {
    const n = (naam ?? "").trim().toLowerCase();
    if (n.length >= 4 && lower.includes(n)) {
      soorten.push("fondsnaam");
      break;
    }
  }

  return { bevatPii: soorten.length > 0, soorten };
}
