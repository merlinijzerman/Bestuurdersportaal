// ============================================================================
//  #413 T4-B — De endpointpin van de Copilot Retrieval-adapter.
// ----------------------------------------------------------------------------
//  DIT IS DE ENIGE PLEK IN DE PRODUCTIEBOOM waar het retrieval-endpoint als
//  letterlijke string staat. De boundarygate
//  (`scripts/sharepoint-retrieval-spike-boundary.test.mjs`) dwingt dat af: een
//  tweede voorkomen elders is een overtreding, ook in een comment.
//
//  Waarom een aparte module en geen constante in de client: een pin die naast de
//  aanroep staat, is een pin die met de aanroep meebeweegt. Zo kan de gate één
//  bestand aanwijzen, en kan een review aan één plek zien welk oppervlak wij bij
//  Microsoft raken.
//
//  BEWUST ZONDER AFHANKELIJKHEDEN. Geen fouttypes, geen config, geen `fetch`:
//  deze module is puur en overal veilig te importeren, ook vanuit een gate.
// ============================================================================

/** `POST` hierheen, en nergens anders. GA-versie; `/beta` is verboden. */
export const COPILOT_RETRIEVAL_ENDPOINT = "https://graph.microsoft.com/v1.0/copilot/retrieval";

/**
 * Eén databron per call. `sharePointEmbedded` is expliciet buiten scope (#413):
 * die container valt buiten de DriveItem-grens waarop onze hele bewijsketen
 * rust, en zou dus kandidaten kunnen opleveren die wij nooit kunnen verifiëren.
 */
export const COPILOT_DATA_SOURCE = "sharePoint" as const;

/** Microsoft-grens op `maximumNumberOfResults`. Hoger is een API-fout. */
export const COPILOT_MAX_RESULTATEN = 25;

/** Microsoft-grens op `queryString`. */
export const COPILOT_MAX_VRAAGTEKENS = 1_500;

/**
 * Bovengrens op wat een aanroeper als requestbudget mág vragen; de standaard is
 * 1. Het budget telt FEITELIJKE netwerkpogingen, backoff-herhalingen meegerekend.
 * Dit staat los van de Microsoft-grens van 200/uur/gebruiker: dit is onze eigen,
 * strengere grens per beurt.
 */
export const COPILOT_MAX_REQUESTBUDGET = 3;

/**
 * Oppervlakken die nooit vanuit deze productieroute geraakt mogen worden.
 * `/beta` is onstabiel en valt buiten het reviewkader; `sharePointEmbedded`
 * valt buiten de DriveItem-grens; `/shares/{token}/driveItem` vraagt volgens
 * Microsoft minimaal delegated `Files.ReadWrite` en zou een read-only route
 * schrijfrecht geven.
 */
const VERBODEN_OPPERVLAK = [
  "graph.microsoft.com/beta",
  "/beta/",
  "sharePointEmbedded",
  "/v1.0/shares/",
  "sharingToken",
] as const;

/**
 * Exacte gelijkheid, geen `startsWith` en geen URL-parsing.
 *
 * Een vergelijking die de URL eerst normaliseert, accepteert varianten die
 * Microsoft anders routeert: een andere host met hetzelfde pad, een query die
 * de versie overschrijft, een dubbele slash. Wij versturen precies één string,
 * dus toetsen we precies die string.
 */
export function isCopilotRetrievalEndpoint(url: string): boolean {
  return url === COPILOT_RETRIEVAL_ENDPOINT;
}

/** Bevat de waarde een oppervlak dat deze route nooit mag raken? */
export function raaktVerbodenOppervlak(waarde: string): boolean {
  return VERBODEN_OPPERVLAK.some((verboden) => waarde.includes(verboden));
}

/**
 * Het aantal resultaten dat de call mag vragen: geklemd op de Microsoft-grens
 * en op minimaal 1. Geklemd en niet geweigerd, want de kandidatenpool van de
 * orkestratie is bewust ruimer (`max(3 × maxResultaten, 20)`) en mag niet de
 * hele beurt laten stranden op een grens van een enkele provider. Dát k voor
 * deze arm lager ligt, is een meetfeit dat in de diagnostiek zichtbaar wordt.
 */
export function begrensResultaten(gevraagd: number): number {
  if (!Number.isFinite(gevraagd)) return 1;
  return Math.min(Math.max(1, Math.trunc(gevraagd)), COPILOT_MAX_RESULTATEN);
}
