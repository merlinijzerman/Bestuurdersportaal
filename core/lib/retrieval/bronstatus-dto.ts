// ============================================================================
//  #434 T4-F — de BRONSTATUS zoals de route hem mag tonen.
// ----------------------------------------------------------------------------
//  `RetrievalUitkomst.bronstatus` is een INTERN object. Het rechtstreeks
//  serialiseren zou betekenen dat elk veld dat er ooit bij komt vanzelf de
//  route verlaat — en dat is precies hoe een intern veld een publiek contract
//  wordt zonder dat iemand die beslissing neemt.
//
//  Daarom een expliciete, gesloten DTO: alleen wat hier staat gaat naar buiten.
//  Uitsluitend enumwaarden; geen providertekst, URL, ref, documentnaam,
//  tenant-id of bronregistratie-id — die staan ook niet in de bron, maar dat is
//  een eigenschap van vandaag en geen garantie voor morgen.
//
//  ONTBREEKT DE STATUS, DAN ONTBREEKT HET VELD. Geen lege array, geen `null`:
//  het bestaande single-adapterpad moet byte-identiek blijven, en een veld dat
//  altijd bestaat verandert elke bestaande snapshot zonder iets te zeggen.
// ============================================================================
import type { Bronsoort, Bronstatus, Bronstatusreden } from "./contract";

/**
 * De waarde die overblijft als een gesloten veld niet herkend wordt.
 *
 * Geen vulling en geen gok: hij zegt precies wat er aan de hand is — er is een
 * bron niet geraadpleegd en waaróm is niet herleidbaar. Dat is wél een
 * gesloten waarde, dus er gaat nog steeds geen vrije tekst naar de client.
 */
export const BRONSTATUS_ONBEKEND = "onbekend" as const;

/** Wat een gebruiker te zien krijgt als een gevraagde bron ontbreekt. */
export interface BronstatusDto {
  /** Vaste categorie; één waarde, zodat de client er niet op hoeft te takken. */
  categorie: "bron_niet_geraadpleegd";
  bronsoort: Bronsoort | typeof BRONSTATUS_ONBEKEND;
  reden: Bronstatusreden | typeof BRONSTATUS_ONBEKEND;
}

const REDENEN: readonly Bronstatusreden[] = [
  "bewust_uit",
  "readiness_ontbreekt",
  "token_ongeldig",
  "providerfout",
  "timeout",
  "geannuleerd",
  "geen_resultaten",
];

const BRONSOORTEN: readonly Bronsoort[] = ["fonds", "generiek", "sharepoint", "notulen", "web"];

/**
 * Projecteert de interne bronstatus naar de gesloten DTO.
 *
 * Alleen NIET-GERAADPLEEGDE bronnen komen erin: een bron die wél is
 * geraadpleegd en niets vond, is geen ontbrekende bron maar een lege uitslag.
 * Die melden zou de gebruiker laten denken dat er iets mis is.
 *
 * EEN ONBEKENDE WAARDE WORDT NIET WEGGELATEN MAAR AFGEVLAKT NAAR `onbekend`.
 * Weglaten was de vorige keuze en die was fout: de rij bestond juist omdát er
 * een bron ontbrak, dus wie hem weggooit gooit de wáárschuwing weg en niet het
 * risico. Het antwoord oogt dan weer volledig terwijl een gevraagde bron
 * ontbreekt — exact de stille degradatie die T4-E moest uitsluiten. Afvlakken
 * houdt beide eisen overeind: de melding blijft staan, en er gaat nog steeds
 * geen onbekende string naar de client.
 *
 * `geraadpleegd` telt alleen als geraadpleegd bij een letterlijke `true`.
 * Alles wat geen boolean is, is een onleesbare rij, en van een onleesbare rij
 * kunnen we niet vaststellen dát de bron is geraadpleegd. Fail-closed betekent
 * hier dus: melden.
 */
export function bouwBronstatusDto(
  bronstatus: readonly Bronstatus[] | undefined
): BronstatusDto[] | undefined {
  if (!bronstatus || bronstatus.length === 0) return undefined;
  const rijen = bronstatus
    .filter((s) => s.geraadpleegd !== true)
    .map((s) => ({
      categorie: "bron_niet_geraadpleegd" as const,
      bronsoort: BRONSOORTEN.includes(s.bronsoort) ? s.bronsoort : BRONSTATUS_ONBEKEND,
      reden: REDENEN.includes(s.reden) ? s.reden : BRONSTATUS_ONBEKEND,
    }));
  return rijen.length > 0 ? rijen : undefined;
}
