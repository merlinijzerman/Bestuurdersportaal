// ============================================================================
//  #322 F4-T2-1 — CENTRALE citaatopbouw.
// ----------------------------------------------------------------------------
//  Nummering, sentinel, neutralisatie, bronkop en `BronVerwijzing` horen in ÉÉN
//  hand. Liet je dit aan de adapter over, dan kan elke provider bronlabels
//  simuleren, de neutralisatie overslaan of een andere citaat-ID-semantiek
//  gebruiken — precies de divergentie die dit contract moet opheffen. De adapter
//  levert alleen weergavemetadata (`Bronresultaat.weergave`).
//
//  Dit is een LETTERLIJKE port van `maakContext` uit rag.ts, met chunkvelden
//  vervangen door contractvelden. `rag.ts` roept deze functie nu aan, zodat er
//  één bron van waarheid is en de bestaande snapshots byte-identiek blijven.
//
//  NIEUW ten opzichte van maakContext: de harde contextgrens wordt hier
//  afgedwongen, op de WERKELIJK GERENDERDE blokken. Meten op de kale passage zou
//  de parent-uitbreiding en de bronkoppen niet meetellen, en dan is de grens
//  geen grens.
// ============================================================================
import { neutraliseerBrontekst, maakBronSentinel } from "../bron-afbakening";
import { notulenBronLabel } from "../notulen";
import { bouwBronfragment } from "../bronfragment";
import { statuslabelVoorBron } from "../documentstatus-label";
import type { BronVerwijzing } from "../rag";
import type { Bronresultaat, CitaatOpdracht } from "./contract";
import { maakCitationId } from "./identiteit";

export interface Citaatuitkomst {
  contextTekst: string;
  bronnen: BronVerwijzing[];
  geneutraliseerd: number;
  sentinel: string;
  /** Gezet zodra de contextgrens blokken heeft afgekapt. */
  afgekapt: boolean;
  /** De bronnen die daadwerkelijk in de context staan. */
  opgenomen: Bronresultaat[];
}

const GEEN_TREFFERS = "Er zijn geen relevante documenten gevonden in de bibliotheek.";

export function bouwCitaties(
  bronnen: Bronresultaat[],
  opdracht: CitaatOpdracht & { maxContextTekens: number }
): Citaatuitkomst {
  const sentinel = opdracht.sentinel ?? maakBronSentinel();
  const startIndex = opdracht.startIndex ?? 0;
  const past = (tekst: string) => opdracht.maxContextTekens <= 0 || tekst.length <= opdracht.maxContextTekens;
  if (bronnen.length === 0) {
    // Ook de terugvalzin telt mee: een grens die zijn eigen foutmelding niet
    // begrenst, is geen grens.
    return {
      contextTekst: past(GEEN_TREFFERS) ? GEEN_TREFFERS : "",
      bronnen: [], geneutraliseerd: 0, sentinel, afgekapt: false, opgenomen: [],
    };
  }

  const verwijzingen: BronVerwijzing[] = [];
  const contextDelen: string[] = [];
  const opgenomen: Bronresultaat[] = [];
  let geneutraliseerdTotaal = 0;
  let afgekapt = false;
  // De scheiding tussen twee blokken telt mee voor de grens; anders zou een
  // context met veel bronnen er stelselmatig overheen gaan.
  const SCHEIDING = "\n\n";
  let lengte = 0;

  for (const [index, bron] of bronnen.entries()) {
    const nr = startIndex + index + 1;
    const bronLabel = `[Bron ${nr}]`;
    const w = bron.weergave ?? {};
    const locatie = [
      bron.locator.paragraaf && `${bron.locator.paragraaf}`,
      bron.locator.pagina && `pag. ${bron.locator.pagina}`,
    ]
      .filter(Boolean)
      .join(", ");

    // Increment D — notulensegmenten dragen een agendapunt-specifieke
    // bronvermelding; overige bronnen houden "[bron] — [titel]".
    const bronTitel = w.notulen
      ? notulenBronLabel(w.notulen.vergaderingTitel, w.notulen.agendapuntVolgnummer, w.notulen.agendapuntTitel)
      : `${bron.documentIdentiteit.bron} — ${bron.titel}`;

    // Increment G — generieke bronnen expliciet labelen, zodat het model ze niet
    // presenteert als door het fonds bestuurlijk vastgesteld (#22/#23).
    const bronsoortLabel =
      bron.documentIdentiteit.bibliotheek === "generiek"
        ? ` [generiek/extern kader${w.bronorganisatie ? ` — ${w.bronorganisatie}` : ""}]`
        : "";

    // R1.6 — is de treffer uitgebreid tot zijn structuur-unit, dan is DAT de
    // brontekst; bronlabel, locatie en fragment blijven op de treffer.
    const ruweBrontekst = w.aangeleverdePassage ?? bron.passage;
    const { tekst: brontekst, geneutraliseerd } = neutraliseerBrontekst(ruweBrontekst);

    const statusLabel = statuslabelVoorBron(
      {
        documentstatus: bron.status.documentstatus,
        bronstatus: bron.status.bronstatus,
        geldig_tot: bron.status.geldigTot,
      },
      opdracht.peildatum
    );

    const herkomstLabel =
      opdracht.primaireDocumentIds && opdracht.primaireDocumentIds.size > 0
        ? opdracht.primaireDocumentIds.has(bron.documentIdentiteit.id)
          ? opdracht.hoofddocumentLabel
          : " [aanvullend uit de bibliotheek]"
        : "";

    const kop = `${bronLabel} ${bronTitel}${bronsoortLabel}${statusLabel}${herkomstLabel}${locatie ? ` (${locatie})` : ""}`;
    // H-10: elke bron in een eigen, met een onvoorspelbare sentinel afgebakend
    // blok. Alles tussen de openings- en sluittag is DATA, nooit instructie.
    const blok = `<bron s="${sentinel}" nr="${nr}">\n${kop}:\n${brontekst}\n</bron s="${sentinel}">`;

    // HARDE contextgrens op het gerenderde blok, inclusief kop en scheiding.
    const extra = blok.length + (contextDelen.length > 0 ? SCHEIDING.length : 0);
    if (opdracht.maxContextTekens > 0 && lengte + extra > opdracht.maxContextTekens) {
      afgekapt = true;
      break;
    }
    lengte += extra;

    geneutraliseerdTotaal += geneutraliseerd;
    contextDelen.push(blok);
    opgenomen.push(bron);
    verwijzingen.push({
      ...(bron.versie.waarde ? { citation_id: maakCitationId(
        bron.documentIdentiteit.id,
        bron.passageIdentiteit.id,
        bron.versie.soort,
        bron.versie.waarde
      ) } : {}),
      // Bestaande veldnaam; de waarde is vanaf #367 een providerneutrale,
      // opaque documentidentiteit en nadrukkelijk geen database-id.
      document_id: bron.documentIdentiteit.id,
      titel: w.notulen ? bronTitel : bron.titel,
      bron: bron.documentIdentiteit.bron ?? "",
      pagina: bron.locator.pagina ?? null,
      paragraaf: bron.locator.paragraaf ?? null,
      // Bewust de KALE passage, niet de uitgebreide: de vindplaats die erbij
      // staat is die van de treffer.
      fragment: bouwBronfragment(bron.passage),
      heeft_origineel: !!w.opslagPad,
      documentstatus: bron.status.documentstatus ?? null,
      bronstatus: bron.status.bronstatus ?? null,
      documentdatum: w.documentdatum ?? null,
      geldig_tot: bron.status.geldigTot ?? null,
      bibliotheek: bron.documentIdentiteit.bibliotheek ?? null,
      bronorganisatie: w.bronorganisatie ?? null,
      normgewicht: bron.curatie?.normgewicht ?? null,
      extern_url: w.externUrl ?? null,
      documenttype: w.documenttype ?? null,
      bestandstype: w.bestandstype ?? null,
    } as BronVerwijzing);
  }

  // Kapte de grens ALLES weg, dan is er geen context — en dan is de
  // "geen documenten gevonden"-zin misleidend én mogelijk zelf te lang.
  const contextTekst =
    contextDelen.length > 0 ? contextDelen.join(SCHEIDING) : afgekapt ? "" : past(GEEN_TREFFERS) ? GEEN_TREFFERS : "";
  return {
    contextTekst,
    bronnen: verwijzingen,
    geneutraliseerd: geneutraliseerdTotaal,
    sentinel,
    afgekapt,
    opgenomen,
  };
}
