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

/** Wat een gebruiker te zien krijgt als een gevraagde bron ontbreekt. */
export interface BronstatusDto {
  /** Vaste categorie; één waarde, zodat de client er niet op hoeft te takken. */
  categorie: "bron_niet_geraadpleegd";
  bronsoort: Bronsoort;
  reden: Bronstatusreden;
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
 * Een waarde buiten de gesloten verzamelingen wordt WEGGELATEN in plaats van
 * doorgegeven. Hier is dat de veilige kant: het alternatief is een onbekende
 * string naar de client sturen.
 */
export function bouwBronstatusDto(
  bronstatus: readonly Bronstatus[] | undefined
): BronstatusDto[] | undefined {
  if (!bronstatus || bronstatus.length === 0) return undefined;
  const rijen = bronstatus
    .filter((s) => s.geraadpleegd === false)
    .filter((s) => BRONSOORTEN.includes(s.bronsoort) && REDENEN.includes(s.reden))
    .map((s) => ({
      categorie: "bron_niet_geraadpleegd" as const,
      bronsoort: s.bronsoort,
      reden: s.reden,
    }));
  return rijen.length > 0 ? rijen : undefined;
}
