// ============================================================================
//  core/lib/document-bijzonderheden.ts — besluit 0140
// ----------------------------------------------------------------------------
//  Eén pure bron voor de "bijzonderheden" van een document: de toestanden die
//  in de bibliotheeklijst zichtbaar moeten zijn.
//
//  WAAROM DEZE MODULE BESTAAT
//  --------------------------
//  De rij in de bibliotheek toonde tot 0140 tot twaalf badges naast elkaar,
//  waarvan de meeste de NORMALE toestand meldden ("✓ Geïndexeerd" stond bij
//  vrijwel elk document). Daardoor was de afwijking — het ene document dat níet
//  doorzoekbaar is — juist het moeilijkst te vinden. Het uitgangspunt is nu
//  omgekeerd: **een document dat in orde is, levert een lege lijst op.** Alleen
//  afwijkingen worden benoemd.
//
//  De afleiding stond eerder inline in `app/(dashboard)/bibliotheek/page.tsx`
//  als een reeks booleans met onderlinge uitsluitingen. Dat is precies het soort
//  logica dat stil verkeerd gaat bij een volgende wijziging (een pipeline-status
//  erbij, en een document valt zowel in "nog in verwerking" als in "niet
//  doorzoekbaar"). Hier is het puur en getest: `document-bijzonderheden.sanity.ts`.
//
//  FORMULERING (besluit 0140)
//  --------------------------
//  Drie regels, bewust vastgelegd omdat ze anders per scherm verwateren:
//
//    1. Benoem de TOESTAND, niet een oordeel. "Niet verwerkt", niet "Verwerking
//       mislukt"; "Niet geaccepteerd", niet "Geweigerd". De bestuurder die dit
//       leest heeft het bestand vaak zelf aangeleverd — een verwijt is hier
//       misplaatst én onbehulpzaam.
//    2. Geen jargon uit het datamodel. "Metadata onvolledig", niet "Nog niet
//       verrijkt": verrijken is een term uit de review-queue, geen woord dat een
//       bestuurder kent.
//    3. Geen impliciete belofte. "Niet doorzoekbaar", niet "NOG niet
//       doorzoekbaar" — dat laatste suggereert dat het vanzelf goedkomt, en dat
//       is precies niet zo: er is een handeling voor nodig.
//
//  De handelingsaanwijzing ("kies Tekstherkenning uitvoeren in het menu") staat
//  in de toelichting/tooltip, niet in het label. Het label moet in één oogopslag
//  scanbaar zijn over tientallen rijen heen.
//
//  Puur en isomorf: geen I/O, geen React, geen Supabase. `nu` is een parameter
//  zodat de traag-drempel deterministisch testbaar is.
// ============================================================================

import { isVervallen } from "./bronsoort";

/** Pipeline-statussen waarin een document nog asynchroon wordt verwerkt (F3/F4).
 *  `beschikbaar` valt hier bewust buiten: dan is `geindexeerd` de waarheid. */
export const PIPELINE_STATUSSEN = [
  "ontvangen",
  "gevalideerd",
  "gescand",
  "extractie",
  "chunking",
  "embedding",
] as const;

/** Boven deze leeftijd krijgt een nog-verwerkend document een eerlijker
 *  toelichting ("duurt langer dan verwacht"). Het LABEL verandert niet — de
 *  uitzondering hoort in de tooltip, niet in de rij (regel 1 hierboven). */
export const VERWERKING_TRAAG_MS = 15 * 60 * 1000;

/** `fout` = blokkeert gebruik als bron. `let_op` = vraagt een handeling.
 *  `audit` = geen probleem, maar herleidbaarheid die zichtbaar MOET blijven. */
export type BijzonderheidSoort = "fout" | "let_op" | "audit";

export interface Bijzonderheid {
  /** Stabiele sleutel — gebruik deze in tests en filters, niet het label. */
  sleutel:
    | "inactief"
    | "niet_geaccepteerd"
    | "niet_verwerkt"
    | "in_verwerking"
    | "geen_tekstlaag"
    | "niet_doorzoekbaar"
    | "type_ontbreekt"
    | "metadata_onvolledig"
    | "vervallen"
    | "tekstherkenning";
  label: string;
  soort: BijzonderheidSoort;
  /** Volledige uitleg — bestemd voor de tooltip, niet voor de rij. */
  toelichting: string;
}

/** De velden die de afleiding nodig heeft. Bewust een eigen, smalle vorm en
 *  niet het volledige `Document`-type: zo kan deze module ook door de server of
 *  een script worden gebruikt zonder de UI-typen mee te slepen. */
export interface DocumentToestand {
  actief: boolean;
  geindexeerd: boolean;
  bibliotheek: string | null;
  bestandstype: "pdf" | "docx" | "xlsx" | null;
  verwerkingsstatus: string | null;
  ocr_toegepast: boolean | null;
  opslag_pad: string | null;
  documenttype: string | null;
  deactivatie_reden: string | null;
  /** Geldigheidsgrens van een generiek kaderdocument (ISO YYYY-MM-DD). */
  geldig_tot: string | null;
  /** ISO-tijdstip van aanmaak — voor de traag-drempel. */
  aangemaakt: string;
}

/**
 * Leidt de bijzonderheden van één document af.
 *
 * Volgorde is betekenisvol en vast: `fout` vóór `let_op` vóór `audit`. De lijst
 * wordt links-naar-rechts gerenderd, dus wat het gebruik blokkeert staat vooraan.
 *
 * Retourneert een LEGE array wanneer er niets aan de hand is. Dat is de normale
 * uitkomst en het hele punt van deze module.
 */
export function bepaalBijzonderheden(
  doc: DocumentToestand,
  nu: number = Date.now()
): Bijzonderheid[] {
  const uit: Bijzonderheid[] = [];

  // ── Inactief sluit al het andere uit ──────────────────────────────────────
  // Een gedeactiveerd document telt niet mee als bron; of het doorzoekbaar is
  // of een tekstlaag heeft is dan niet meer relevant en zou alleen ruis geven.
  if (!doc.actief) {
    uit.push({
      sleutel: "inactief",
      label: "Inactief",
      soort: "fout",
      toelichting: doc.deactivatie_reden
        ? `Buiten gebruik gesteld. Reden: ${doc.deactivatie_reden}`
        : "Dit document is buiten gebruik gesteld en telt niet mee als bron.",
    });
    return uit;
  }

  const isGeneriek = doc.bibliotheek === "generiek";
  const kanInzien = !!doc.opslag_pad;
  const inVerwerking =
    !doc.geindexeerd &&
    (PIPELINE_STATUSSEN as readonly string[]).includes(doc.verwerkingsstatus ?? "");
  const verwerkingMislukt = doc.verwerkingsstatus === "mislukt";
  const verwerkingGeweigerd =
    doc.verwerkingsstatus === "geweigerd" || doc.verwerkingsstatus === "gequarantineerd";

  // ── Blokkerend ────────────────────────────────────────────────────────────
  if (verwerkingGeweigerd) {
    uit.push({
      sleutel: "niet_geaccepteerd",
      label: "Niet geaccepteerd",
      soort: "fout",
      toelichting:
        "Dit bestand is bij de veiligheidscontrole niet geaccepteerd en is niet doorzoekbaar.",
    });
  } else if (verwerkingMislukt) {
    uit.push({
      sleutel: "niet_verwerkt",
      label: "Niet verwerkt",
      soort: "fout",
      toelichting:
        "De verwerking is afgebroken. Een voorzitter of beheerder kan in het menu " +
        '"Opnieuw verwerken" kiezen.',
    });
  }

  // ── Vraagt een handeling ──────────────────────────────────────────────────
  if (inVerwerking) {
    const traag = nu - new Date(doc.aangemaakt).getTime() > VERWERKING_TRAAG_MS;
    uit.push({
      sleutel: "in_verwerking",
      label: "Nog in verwerking",
      soort: "let_op",
      toelichting: traag
        ? "De verwerking duurt langer dan verwacht. Neem contact op met de beheerder als dit aanhoudt."
        : "Dit document wordt verwerkt en is doorgaans binnen enkele minuten doorzoekbaar.",
    });
  }

  // Niet-doorzoekbaar heeft twee gedaanten. Bij een PDF met beschikbaar
  // origineel is de oorzaak vrijwel altijd een ontbrekende tekstlaag en is
  // tekstherkenning de remedie (besluit 0134); in alle andere gevallen tonen we
  // neutraal wát er aan de hand is in plaats van een oorzaak te suggereren die
  // we niet kennen. Generieke documenten vallen erbuiten: die zijn voor tenants
  // read-only (B13) en het menu-item bestaat er niet — een aanwijzing naar een
  // knop die er niet is, is erger dan geen aanwijzing.
  const nietDoorzoekbaar =
    !doc.geindexeerd &&
    !isGeneriek &&
    !inVerwerking &&
    !verwerkingMislukt &&
    !verwerkingGeweigerd;
  if (nietDoorzoekbaar) {
    if (doc.bestandstype === "pdf" && kanInzien) {
      uit.push({
        sleutel: "geen_tekstlaag",
        label: "Geen tekstlaag",
        soort: "let_op",
        toelichting:
          "Deze PDF bevat geen tekstlaag — vermoedelijk een scan. Kies in het menu " +
          '"Tekstherkenning uitvoeren" om het document alsnog doorzoekbaar te maken.',
      });
    } else {
      uit.push({
        sleutel: "niet_doorzoekbaar",
        label: "Niet doorzoekbaar",
        soort: "let_op",
        toelichting:
          "Dit document is niet geïndexeerd en wordt daarom niet door de assistent gevonden.",
      });
    }
  }

  // `documenttype` ontbreekt is een concreet, zelf op te lossen signaal (het
  // document valt in de groep "Zonder type"). De bredere "metadata onvolledig"-
  // melding leunde op de metadata-reviewworkflow, die is verwijderd (besluit
  // 0152) — die bijzonderheid vervalt daarmee.
  if (!doc.documenttype && !isGeneriek) {
    uit.push({
      sleutel: "type_ontbreekt",
      label: "Type ontbreekt",
      soort: "let_op",
      toelichting:
        "Er is geen documenttype gezet; het document staat daarom in de groep " +
        '"Zonder type". Aan te vullen via "Metadata bewerken".',
    });
  }

  // Vervallen kaderdocument. Stond eerder als losse badge ONDER de titel; dat
  // maakte elke generieke rij twee regels hoog en zette een levensloop-signaal
  // op een plek waar de rest van de rij identiteit toont. Het hoort bij de
  // bijzonderheden: het is een afwijking, en er hoort een handeling bij.
  if (isGeneriek && isVervallen(doc.geldig_tot, new Date(nu))) {
    uit.push({
      sleutel: "vervallen",
      label: "Vervallen",
      soort: "fout",
      toelichting: `Dit kaderdocument is vervallen per ${doc.geldig_tot}. Het wordt centraal beheerd; controleer of er een opvolger is.`,
    });
  }

  // ── Herleidbaarheid ───────────────────────────────────────────────────────
  // GEEN probleem, maar mag niet verdwijnen: besluit 0020/0134 vraagt dat een
  // bestuurder die een getal overneemt kan zien dat er een herkenningsstap
  // tussen bron en citaat zit. Verplaatsen naar een detailpaneel of tooltip is
  // daarom een BESLUITWIJZIGING, geen weergavekeuze.
  if (doc.ocr_toegepast) {
    uit.push({
      sleutel: "tekstherkenning",
      label: "Tekstherkenning",
      soort: "audit",
      toelichting:
        "De tekst van dit document is via tekstherkenning (OCR) uit een scan gehaald. " +
        "Controleer overgenomen getallen tegen het origineel.",
    });
  }

  return uit;
}

/** Telt de documenten met ten minste één bijzonderheid — voor de samenvatting
 *  op een ingeklapte groepskop. Zonder die samenvatting verbergt inklappen
 *  precies de informatie die je zoekt. */
export function telBijzonderheden(
  docs: DocumentToestand[],
  nu: number = Date.now()
): { met: number; zwaarste: BijzonderheidSoort | null } {
  let met = 0;
  let zwaarste: BijzonderheidSoort | null = null;
  for (const d of docs) {
    const b = bepaalBijzonderheden(d, nu);
    if (b.length === 0) continue;
    met++;
    if (b.some((x) => x.soort === "fout")) zwaarste = "fout";
    else if (zwaarste !== "fout" && b.some((x) => x.soort === "let_op")) zwaarste = "let_op";
    else if (zwaarste === null) zwaarste = "audit";
  }
  return { met, zwaarste };
}
