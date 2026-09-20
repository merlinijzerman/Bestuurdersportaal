// ============================================================================
//  #413 T4-B — Server-side opbouw van `filterExpression` en `queryString`.
// ----------------------------------------------------------------------------
//  DE SCOPE KOMT NOOIT UIT DE VRAAG. `filterExpression` wordt uitsluitend
//  opgebouwd uit de opnieuw gelezen, serververtrouwde bronregistratie (site,
//  drive, root). De vraag van de gebruiker gaat als aparte `queryString` mee en
//  kan het filter niet raken — ook niet als zij letterlijk `path:"…"` bevat.
//
//  WAAROM DE VORM VÓÓR DE CALL WORDT GETOETST. Microsoft documenteert dat een
//  syntactisch ongeldige KQL-filter ONGESCOPED kan uitvoeren. Een filter dat wij
//  niet kunnen verantwoorden, mag dus niet vertrekken: dan is er geen call.
//
//  GEEN EXCEPTIONS ALS CONTROLESTROOM. Beide functies geven een resultaat terug
//  met een vaste, inhoudsvrije foutcode. De aanroeper vertaalt die naar de
//  foutcategorie van het retrievalcontract; deze module blijft puur en kent geen
//  provider-, HTTP- of contracttypes.
// ============================================================================

export type FilterFoutcode =
  | "root_geen_https"
  | "root_andere_host"
  | "root_bevat_gebruikersdeel"
  | "root_bevat_query_of_fragment"
  | "root_pad_leeg"
  | "root_pad_onveilig"
  | "filtervorm_ongeldig";

export type VraagFoutcode = "vraag_leeg" | "vraag_te_lang";

export type FilterResultaat =
  | { ok: true; filterExpression: string }
  | { ok: false; code: FilterFoutcode };

export type VraagResultaat =
  | { ok: true; queryString: string }
  | { ok: false; code: VraagFoutcode };

/**
 * Wat een gedecodeerd bibliotheekpad mag bevatten. Bewust een ALLOWLIST: geen
 * quote, backslash, wildcard, `%`, `#`, `?` of stuurteken — precies de tekens
 * waarmee een KQL-scope open te breken is. Een dubbel gecodeerd pad houdt na één
 * decodeerslag nog een `%` over en valt hier dus ook af.
 */
const VEILIG_GEDECODEERD_PAD = /^(?:\/[A-Za-z0-9\-._~()& ]+)*$/;

/** De vorm van de uitgaande, opnieuw gecodeerde filter. */
const FILTER_VORM = /^path:"https:\/\/[a-z0-9-]+\.sharepoint\.com(?:\/(?:[A-Za-z0-9\-._~()&]|%[0-9A-F]{2})+)*"$/;

/** Tekens die in KQL betekenis dragen; in een pad hebben ze niets te zoeken. */
const KQL_BETEKENISVOL = /["\\*?()\[\]{}<>:~^]/;

/**
 * Een punt- of dubbelepuntsegment in de RUWE URL. Net als bij een backslash
 * herschrijft de WHATWG-parser dit in stilte: `/sites/pgb/../ander` én
 * `/sites/pgb/%2e%2e/ander` worden allebei `/sites/ander`. Wie pas ná het
 * parsen kijkt, ziet een keurig pad dat een ANDERE bibliotheek aanwijst dan in
 * de registratie staat — een scopewijziging zonder spoor.
 *
 * De vergelijking gebeurt op het één keer gedecodeerde segment, want `%2e` en
 * `%2E` zijn voor de parser gelijk aan `.`. Dubbel gecodeerde vormen (`%252e`)
 * laat de parser juist staan; die stranden verderop op de padallowlist, die
 * geen `%` toelaat.
 */
function bevatPuntsegment(ruweUrl: string): boolean {
  const naSchema = ruweUrl.indexOf("://");
  const rest = naSchema === -1 ? ruweUrl : ruweUrl.slice(naSchema + 3);
  const eerste = rest.indexOf("/");
  if (eerste === -1) return false;
  const pad = rest.slice(eerste).split("?")[0].split("#")[0];
  for (const segment of pad.split("/")) {
    let gedecodeerd: string;
    try {
      gedecodeerd = decodeURIComponent(segment);
    } catch {
      // Onleesbare codering: dan kunnen we niet vaststellen wat het segment
      // betekent, en dus weigeren we het.
      return true;
    }
    if (gedecodeerd === "." || gedecodeerd === "..") return true;
  }
  return false;
}

/**
 * Bouwt de padscope uit de root-URL van de geregistreerde bron.
 *
 * `verwachteHost` komt uit dezelfde bronregistratie en wordt apart meegegeven:
 * zo kan een root-URL die om welke reden dan ook naar een andere tenant wijst,
 * niet stilzwijgend de scope worden. Twee waarden uit één bron die elkaar
 * moeten bevestigen is geen dubbelop — het is de enige manier om drift tussen
 * `site_hostnaam` en `root_pad` te zien.
 */
export function bouwFilterExpression(rootWebUrl: string, verwachteHost: string): FilterResultaat {
  // VÓÓR het parsen, want de URL-parser HERSCHRIJFT deze tekens in stilte: bij
  // een https-URL wordt een backslash een padscheiding (`/a\b` → `/a/b`),
  // worden tab, CR en LF simpelweg verwijderd (`/si<tab>te` → `/site`) en
  // worden punt- en dubbelepuntsegmenten weggerekend (`/sites/pgb/../ander` →
  // `/sites/ander`). De scope die wij versturen zou dan een andere zijn dan die
  // in de registratie staat — soms zelfs een BREDERE — en dat mag niet langs
  // een controle glippen die pas ná het parsen kijkt.
  if (/[\\\u0000-\u001f\u007f]/.test(rootWebUrl)) return { ok: false, code: "root_pad_onveilig" };
  if (bevatPuntsegment(rootWebUrl)) return { ok: false, code: "root_pad_onveilig" };

  let parsed: URL;
  try {
    parsed = new URL(rootWebUrl);
  } catch {
    return { ok: false, code: "root_geen_https" };
  }
  if (parsed.protocol !== "https:") return { ok: false, code: "root_geen_https" };
  if (parsed.username || parsed.password) return { ok: false, code: "root_bevat_gebruikersdeel" };
  if (parsed.search || parsed.hash) return { ok: false, code: "root_bevat_query_of_fragment" };
  const host = parsed.hostname.toLowerCase();
  if (host !== verwachteHost.trim().toLowerCase()) return { ok: false, code: "root_andere_host" };
  if (parsed.port) return { ok: false, code: "root_geen_https" };
  if (!/^[a-z0-9-]+\.sharepoint\.com$/.test(host)) return { ok: false, code: "root_andere_host" };

  // Toetsen op de GEDECODEERDE betekenis, niet alleen op de vorm. `new URL()`
  // percent-encodeert een aanhalingsteken in een pad stilzwijgend tot `%22`; een
  // filter die er daardoor schoon uitziet, kan aan de Microsoft-kant alsnog als
  // quote worden gelezen en de scope openbreken.
  let gedecodeerd: string;
  try {
    gedecodeerd = decodeURIComponent(parsed.pathname).normalize("NFC").replace(/\/+$/, "");
  } catch {
    return { ok: false, code: "root_pad_onveilig" };
  }
  if (!gedecodeerd) return { ok: false, code: "root_pad_leeg" };
  if (!VEILIG_GEDECODEERD_PAD.test(gedecodeerd)) return { ok: false, code: "root_pad_onveilig" };
  // NOG EEN KEER, nu op de GEDECODEERDE vorm. De controle vóór het parsen vangt
  // wat de parser zelf wegrekent; dit vangt het omgekeerde geval: `..%2fander`
  // laat de parser ongemoeid (`%2f` blijft staan), maar na decodering staat er
  // `../ander` — en die punt­segmenten zouden dan in de UITGAANDE filter belanden,
  // waar Microsoft ze naar eigen inzicht mag interpreteren.
  if (gedecodeerd.split("/").some((deel) => deel === "." || deel === "..")) {
    return { ok: false, code: "root_pad_onveilig" };
  }
  // Dubbele grendel: de allowlist hierboven sluit deze tekens al uit. Blijft
  // hier toch iets hangen, dan is de allowlist verruimd zonder dat iemand deze
  // regel heeft herzien — en dan stopt de call alsnog.
  if (KQL_BETEKENISVOL.test(gedecodeerd)) return { ok: false, code: "root_pad_onveilig" };

  // Opnieuw coderen vanuit de gecontroleerde, gedecodeerde vorm; nooit de
  // binnengekomen codering overnemen.
  const pad = gedecodeerd.split("/").map((deel) => encodeURIComponent(deel)).join("/");
  const filterExpression = `path:"https://${host}${pad}"`;
  if (!FILTER_VORM.test(filterExpression)) return { ok: false, code: "filtervorm_ongeldig" };
  return { ok: true, filterExpression };
}

/**
 * Eén begrensde zin. De vraag is invoer van een gebruiker en wordt daarom
 * genormaliseerd en van stuurtekens ontdaan — niet om KQL te ontwijken (de
 * vraag komt in een eigen veld terecht), maar omdat een vraag met
 * regeleindes of nulbytes een provider onvoorspelbaar laat reageren en in geen
 * enkel logboek thuishoort.
 */
export function bouwQueryString(vraag: string, maxTekens: number): VraagResultaat {
  const schoon = vraag
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!schoon) return { ok: false, code: "vraag_leeg" };
  if (schoon.length > maxTekens) return { ok: false, code: "vraag_te_lang" };
  return { ok: true, queryString: schoon };
}
