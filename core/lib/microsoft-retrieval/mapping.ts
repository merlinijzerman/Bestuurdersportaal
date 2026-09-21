// ============================================================================
//  #413 T4-C — Van Copilot-hit naar een geregistreerde bronreferentie.
// ----------------------------------------------------------------------------
//  EEN `webUrl` UIT COPILOT IS GEEN BRON. Hij is een string uit een externe
//  dienst; hij bewijst niets over rechten, ligging of versie. Deze module doet
//  precies twee dingen, en allebei zonder netwerkcall:
//
//    1. ROOTGRENS — ligt de hit binnen het pad van de OPNIEUW GELEZEN root?
//       Alles daarbuiten valt af vóór er ook maar één vervolgcall vertrekt.
//    2. CANONICALISERING — de vergelijkingsvorm waarmee de hit in het private
//       documentregister wordt opgezocht.
//
//  DE CANONICALISERING IS EEN TWEELING. Exact dezelfde regels staan in
//  `microsoft_private.sharepoint_canoniek_weburl()` (migratie
//  2026_09_20_413_weburl_canoniek_quarantaine.sql), want die voedt de
//  gegenereerde kolom waartegen wij opzoeken. Lopen de twee uiteen, dan zoekt
//  de adapter op een waarde die nooit is opgeslagen — en dat is geen fout die
//  luidruchtig faalt, maar een arm die stil niets meer vindt. De vectorlijst in
//  `tests/cross-tenant/copilot-mapping.test.ts` en die in de SQL-gedragssuite
//  worden daarom tegen elkaar gehouden.
//
//  GEEN DECODE VAN PADSEGMENTEN. `%2F` decoderen zou er een padscheiding van
//  maken en twee verschillende bestanden op elkaar kunnen afbeelden. Wat wél
//  wordt genormaliseerd: schema, host, poort, query, fragment, trailing slash.
//  Een encodingverschil tussen Copilot en de listing leidt zo tot een GEMISTE
//  mapping (zichtbaar in de teller) en nooit tot een verkeerde.
//
//  ── DE OFFICE-WEERGAVE-URL ─────────────────────────────────────────────────
//  Graph levert voor Word-, Excel- en PowerPointbestanden vaak niet het
//  bibliotheekpad maar een VIEWER-URL: `https://host/:w:/r/sites/…/a.docx`.
//  De labscan van #419 stelde dat live vast, en onze eigen listing slaat die
//  vorm onveranderd op in `web_url` — terwijl een MAP wél het gewone pad krijgt.
//  Zonder normalisatie vergelijkt de rootgrens dus `/:w:/r/sites/…` met
//  `/sites/…`, en valt élk Word- en PowerPointdocument af onder `root`: precies
//  de twee bestandstypen waar de fixtures uit bestaan.
//
//  De vier viewerprefixen `/:w:/r/`, `/:x:/r/`, `/:p:/r/` en `/:b:/r/` worden
//  daarom weggestreken; wat erachter staat ís het serverrelatieve pad. EXACT
//  deze vier, en niets anders: een SHARINGLINK (`/:w:/s/<token>`) draagt geen
//  pad maar een token, en die hoort fail-closed af te vallen in plaats van op
//  goed geluk ergens op te matchen.
// ============================================================================

/**
 * Waarom een kandidaat vóór de netwerkcall afvalt. Inhoudsvrij; gaat als telling
 * naar de diagnostiek, nooit met een URL erbij.
 *
 * BEWUST GEEN APARTE `quarantaine`-CATEGORIE. Die stond hier eerst, maar zij was
 * onbereikbaar: de registerfunctie verbergt rijen in quarantaine, geeft dan niets
 * terug, en dat is voor deze laag niet te onderscheiden van een onbekende URL.
 * Een categorie die nooit kan worden geretourneerd is een belofte zonder dekking.
 *
 * De informatie zelf gaat niet verloren, maar hoort op een andere plek: hoeveel
 * rijen er in quarantaine staan is een EIGENSCHAP VAN HET REGISTER, niet van een
 * verzoek. Eén telling per bron in de beheerstand (T4-F, en vandaag al in
 * `supabase/checks/2026_09_20_413_weburl_verificatie.sql` als
 * `e_rijen_in_quarantaine`) is goedkoper én betrouwbaarder dan een extra
 * database-rondgang per gemiste hit — die zou bovendien alleen iets zeggen over
 * de hits die wij toevallig kregen.
 */
export type MappingAfwijzing = "root" | "mapping";

/**
 * De canonieke vergelijkingsvorm, of `null` als de URL er geen kan hebben.
 *
 * `null` is geen foutmelding maar een uitkomst: een hit zonder canonieke vorm
 * bestaat voor deze arm niet. Office-weergave-URL's (`/:w:/…`, `/:p:/…`) leveren
 * wél een vorm op, maar die staat niet in het register en valt daarna af onder
 * `mapping` — een bekende, geaccepteerde beperking (#407).
 */
export function canoniekeWebUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string" || url.length === 0) return null;
  // Controletekens eerst, en op de RUWE string: `new URL()` verwijdert tab, CR
  // en LF stilzwijgend, en dan zou een URL met stuurtekens er schoon uitzien.
  if (/[\u0000-\u001f\u007f]/.test(url)) return null;

  // Géén `$`: alles vanaf de eerste `?` of `#` hoort niet bij het bibliotheekpad
  // en valt hier weg. Dat is ook precies wat `regexp_match` in de SQL-tweeling
  // doet — met een `$` erachter zou een URL mét query hier NULL opleveren en in
  // de database niet, en dan zoekt de adapter op een waarde die nooit bestond.
  const delen = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]+)([^?#]*)/.exec(url);
  if (!delen) return null;
  const [, schema, authority, ruwPad] = delen;
  if (schema.toLowerCase() !== "https") return null;
  if (authority.includes("@")) return null;

  const host = authority.toLowerCase().replace(/:443$/, "");
  if (!/^[a-z0-9][a-z0-9.-]*\.sharepoint\.com$/.test(host)) return null;

  const zonderSlash = ruwPad.replace(/\/+$/, "");
  // `/r` = "resource": het deel erna is het serverrelatieve pad. `/s` (sharing)
  // heeft die eigenschap NIET en wordt bewust niet aangeraakt.
  const viewer = /^\/:[wxpb]:\/r(\/.*)$/.exec(zonderSlash);
  const pad = viewer ? viewer[1] : zonderSlash;
  if (pad === "") return null;
  return `https://${host}${pad}`;
}

/**
 * Ligt de hit binnen de root? Beide kanten worden gecanonicaliseerd, zodat een
 * trailing slash of een poortnotatie niet over de grens beslist.
 *
 * De vergelijking gebeurt op SEGMENTGRENS. Een kale `startsWith` zou
 * `/sites/pgb-geheim` als "binnen `/sites/pgb`" lezen — een scopelek dat er in
 * een diff onschuldig uitziet.
 */
export function hitBinnenRoot(hitWebUrl: string | null | undefined, rootWebUrl: string | null | undefined): string | null {
  const hit = canoniekeWebUrl(hitWebUrl);
  const root = canoniekeWebUrl(rootWebUrl);
  if (!hit || !root) return null;
  if (hit === root) return hit;
  return hit.startsWith(`${root}/`) ? hit : null;
}

/** Wat het private register over een geregistreerd document teruggeeft. */
export interface GeregistreerdDocument {
  ref: string;
  bronId: string;
  driveId: string;
  itemId: string;
  rootItemId: string;
  naam: string;
  bestandstype: string | null;
  mappad: string;
  status: string;
  bronStatus: string;
  siteHostnaam: string;
  configuratieversie: number;
}

export type MappingUitkomst =
  | { ok: true; document: GeregistreerdDocument; canoniek: string }
  | { ok: false; afwijzing: MappingAfwijzing };

/**
 * De volledige locatorstap, zonder netwerk.
 *
 * `zoek` is de private registeropzoeking (de DB-functie), geïnjecteerd zodat
 * deze module puur en hermetisch testbaar blijft. Die functie levert HOOGSTENS
 * ÉÉN rij: zij dwingt `count = 1` af en negeert rijen in quarantaine. Twee
 * documenten met dezelfde canonieke URL leveren dus niets op — fail-closed,
 * want bij ambiguïteit is niet aan te wijzen welk document geciteerd wordt.
 *
 * QUARANTAINE IS GEEN FOUT VAN DIT VERZOEK. Zes Preview-rijen staan er sinds de
 * migratie in; ze komen pas terug zodra een volgende listing de botsing oplost.
 * Voor de locator bestaan ze niet — en hij kan ze ook niet van een onbekende URL
 * onderscheiden, want de registerfunctie geeft in beide gevallen niets terug.
 * Beide tellen daarom als `mapping`; zie de noot bij `MappingAfwijzing`.
 */
export async function zoekBronreferentie(
  hitWebUrl: string,
  rootWebUrl: string,
  zoek: (canoniek: string) => Promise<GeregistreerdDocument | undefined>,
): Promise<MappingUitkomst> {
  const canoniek = hitBinnenRoot(hitWebUrl, rootWebUrl);
  if (!canoniek) return { ok: false, afwijzing: "root" };

  const document = await zoek(canoniek);
  if (!document) return { ok: false, afwijzing: "mapping" };

  // De registerfunctie filtert hier al op, maar een adapter mag niet afhangen
  // van wat een andere laag belooft: een bron die niet actief is of een
  // document dat als verwijderd/ontoegankelijk is gemarkeerd, is geen kandidaat.
  if (document.bronStatus !== "actief" || document.status !== "gezien") {
    return { ok: false, afwijzing: "mapping" };
  }
  return { ok: true, document, canoniek };
}
