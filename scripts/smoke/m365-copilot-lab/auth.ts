// ============================================================================
//  #407 labsmoke — delegated aanmelding via public-client-PKCE.
// ----------------------------------------------------------------------------
//  DRIE DINGEN DIE DEZE MODULE NIET DOET, EN WAAROM.
//
//  1. GEEN CLIENTSECRET. De appregistratie is een public client; de registry
//     draagt er geen secret voor, en `registry.ts` weigert een registratie die
//     dat wel zou suggereren. PKCE vervangt het secret.
//  2. GEEN `offline_access`. Zonder die scope geeft Microsoft geen refresh
//     token af. Dat is geen vergetelheid maar de opdracht: er valt dan ook
//     niets te bewaren, te lekken of per ongeluk te hergebruiken.
//  3. NIETS OP SCHIJF. Access token, id-token, code en verifier bestaan alleen
//     in het procesgeheugen van deze run. Er is geen tokencache, geen tijdelijk
//     bestand en geen logregel die er een draagt.
//
//  DE LOOPBACK-ONTVANGER. De appregistratie kent `http://localhost` als
//  redirect-URI; Microsoft staat voor een public client elke POORT op die host
//  toe, maar het PAD moet leeg blijven. Daarom luisteren wij op een vrije poort
//  op `/` — en op ZOWEL 127.0.0.1 ALS ::1, want welke van de twee `localhost`
//  in de browser wordt, verschilt per systeem. Binden op de wildcard zou die
//  ambiguïteit ook oplossen, maar dan is de ontvanger van de autorisatiecode
//  even bereikbaar vanaf het hele netwerk. Dat is het niet waard.
// ============================================================================
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

/** Hoe lang er op de browserstap gewacht wordt voordat de run stopt. */
const STANDAARD_WACHT_MS = 300_000;

/**
 * Deadline op het inwisselen van de autorisatiecode.
 *
 * De browserstap heeft een ruim venster, want daar zit een mens met een
 * authenticator-app. Het tokenendpoint heeft dat niet: dat is machine-tegen-
 * machine en hoort in seconden te antwoorden. Zonder eigen deadline hangt een
 * `fetch` op een niet-antwoordende host in principe onbeperkt — en dan lijkt de
 * runner vastgelopen op een stap waar niets meer te wachten valt.
 */
const TOKEN_TIMEOUT_MS = 30_000;

/** De redirect-URI die in de appregistratie moet staan (poort uitgezonderd). */
export const VERWACHTE_REDIRECT_BASIS = "http://localhost";

export class AuthFout extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "AuthFout";
    this.code = code;
  }
}

/** Claims die wij uit het id-token gebruiken. Meer lezen wij er niet uit. */
export interface IdTokenClaims {
  tid: string;
  oid: string;
  aud: string;
  iss: string;
  nonce?: string;
  preferred_username?: string;
  exp?: number;
}

export interface Aanmelding {
  /** Uitsluitend in het geheugen; nooit loggen, nooit wegschrijven. */
  accessToken: string;
  claims: IdTokenClaims;
  /** De scopes die Microsoft FEITELIJK heeft afgegeven. */
  toegekendeScopes: string[];
}

export interface AanmeldOpdracht {
  tenantId: string;
  clientId: string;
  /** Graph-permissies uit de registry, zonder resource-prefix. */
  delegatedPermissions: string[];
  /** UPN van de geregistreerde testidentiteit; gaat mee als `login_hint`. */
  loginHint: string;
  redirectUris: string[];
  wachtMs?: number;
  /** Deadline op het inwisselen van de code; uitsluitend voor tests te verlagen. */
  tokenTimeoutMs?: number;
  /** Wordt aangeroepen met de autorisatie-URL zodra die klaarstaat. */
  toonUrl: (url: string) => void;
  signal?: AbortSignal;
  /** Uitsluitend voor tests; de flow gebruikt normaal de globale `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface CodeInwisselOpdracht {
  autoriteit: string;
  clientId: string;
  code: string;
  redirectUri: string;
  verifier: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Wisselt de autorisatiecode in voor tokens — afbreekbaar, en met een eigen
 * deadline.
 *
 * Apart van `meldAan()` omdat dit het enige stuk van de flow is dat zonder
 * browser en zonder loopback-socket te testen valt, en het is precies het stuk
 * waar de runner eerder onbeperkt kon blijven hangen: de browserstap heeft een
 * ruim venster omdat daar een mens zit, maar hierna is het machine-tegen-
 * machine en hoort er binnen seconden een antwoord te komen.
 */
export async function wisselCodeIn(opdracht: CodeInwisselOpdracht): Promise<Record<string, unknown>> {
  const timeoutMs = opdracht.timeoutMs ?? TOKEN_TIMEOUT_MS;
  // Twee redenen om te stoppen, één signaal. `AbortSignal.any` houdt Ctrl-C
  // werkend tot in deze call — zonder dat bleef de runner na de browserstap
  // hangen en deed de SIGINT-handler zichtbaar niets.
  const afbreking = opdracht.signal
    ? AbortSignal.any([opdracht.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  const doeFetch = opdracht.fetchImpl ?? fetch;

  let antwoord: Response;
  try {
    antwoord = await doeFetch(`${opdracht.autoriteit}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: opdracht.clientId,
        grant_type: "authorization_code",
        code: opdracht.code,
        redirect_uri: opdracht.redirectUri,
        code_verifier: opdracht.verifier,
      }),
      redirect: "error",
      signal: afbreking,
    });
  } catch (fout) {
    // De twee afbrekingsgronden uit elkaar houden: een afgebroken run is iets
    // anders dan een tokenendpoint dat niet antwoordt, en ze vragen om een
    // andere vervolgstap.
    if (opdracht.signal?.aborted) {
      throw new AuthFout("aanmelding_afgebroken", "de run is afgebroken tijdens de tokenuitgifte");
    }
    const naam = (fout as Error)?.name;
    if (naam === "TimeoutError" || naam === "AbortError") {
      throw new AuthFout("tokenuitgifte_timeout", `tokenendpoint antwoordde niet binnen ${timeoutMs / 1000} s`);
    }
    // Geen providertekst: alleen de soort fout.
    throw new AuthFout("tokenuitgifte_mislukt", `tokenendpoint onbereikbaar (${naam ?? "netwerkfout"})`);
  }

  if (!antwoord.ok) {
    // Alleen de status. De body van een mislukte tokenrespons bevat standaard
    // een correlatie-id en soms de UPN; die hoort niet in onze uitvoer.
    throw new AuthFout("tokenuitgifte_mislukt", `tokenendpoint gaf HTTP ${antwoord.status}`);
  }
  return (await antwoord.json()) as Record<string, unknown>;
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Vergelijkt twee `state`-waarden in constante tijd. Een gewone `===` lekt via
 * de looptijd waar de eerste afwijking zit; bij een waarde die een aanvaller
 * kan raden-en-bijstellen is dat precies het verkeerde primitief.
 */
function gelijkeState(a: string, b: string): boolean {
  const links = Buffer.from(a, "utf8");
  const rechts = Buffer.from(b, "utf8");
  if (links.length !== rechts.length) return false;
  return timingSafeEqual(links, rechts);
}

/**
 * Decodeert de claimset van een JWT ZONDER de handtekening te controleren.
 *
 * Dat mag hier, en alleen hier: het token komt niet via de browser binnen maar
 * rechtstreeks van het tokenendpoint over TLS, in antwoord op een request die
 * wij zelf met onze eigen `code_verifier` hebben gedaan. OpenID Connect noemt
 * dat expliciet als het geval waarin handtekeningvalidatie mag vervallen. De
 * claims worden hierna alsnog tegen tenant, app en nonce getoetst, en de actor
 * wordt bovendien bij Graph zelf nagevraagd — één gedecodeerde claim is nooit
 * het enige bewijs.
 */
function leesClaims(idToken: string): IdTokenClaims {
  const delen = idToken.split(".");
  if (delen.length !== 3) throw new AuthFout("idtoken_vorm", "id-token heeft geen drie delen");
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(delen[1], "base64url").toString("utf8")) as unknown;
  } catch {
    throw new AuthFout("idtoken_vorm", "claimset van het id-token is onleesbaar");
  }
  if (typeof payload !== "object" || payload === null) {
    throw new AuthFout("idtoken_vorm", "claimset van het id-token is geen object");
  }
  const claims = payload as Record<string, unknown>;
  for (const veld of ["tid", "oid", "aud", "iss"]) {
    if (typeof claims[veld] !== "string" || (claims[veld] as string).length === 0) {
      throw new AuthFout("idtoken_claims", `claim '${veld}' ontbreekt in het id-token`);
    }
  }
  return {
    tid: (claims.tid as string).toLowerCase(),
    oid: (claims.oid as string).toLowerCase(),
    aud: (claims.aud as string).toLowerCase(),
    iss: claims.iss as string,
    nonce: typeof claims.nonce === "string" ? claims.nonce : undefined,
    preferred_username: typeof claims.preferred_username === "string" ? claims.preferred_username : undefined,
    exp: typeof claims.exp === "number" ? claims.exp : undefined,
  };
}

/**
 * Start de loopback-ontvanger op één vrije poort, op beide adresfamilies.
 *
 * De poort wordt bepaald door de eerste socket; de tweede probeert dezelfde
 * poort en mag falen — dan is die familie op dit systeem simpelweg niet in
 * gebruik voor `localhost`.
 */
async function startOntvanger(
  afhandelen: (url: URL) => string,
): Promise<{ poort: number; sluit: () => Promise<void> }> {
  const servers: Server[] = [];
  const maak = (): Server =>
    createServer((req, res) => {
      let antwoord: string;
      try {
        antwoord = afhandelen(new URL(req.url ?? "/", "http://localhost"));
      } catch {
        antwoord = "Aanmelding mislukt. Deze pagina mag gesloten worden.";
      }
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(antwoord);
    });

  const eerste = maak();
  const poort = await new Promise<number>((klaar, mislukt) => {
    eerste.once("error", mislukt);
    eerste.listen({ host: "127.0.0.1", port: 0 }, () => klaar((eerste.address() as AddressInfo).port));
  });
  servers.push(eerste);

  const tweede = maak();
  await new Promise<void>((klaar) => {
    // Een ontbrekende of bezette ::1 is geen fout: dan loopt `localhost` op dit
    // systeem via IPv4 en is de eerste socket al de juiste.
    tweede.once("error", () => klaar());
    tweede.listen({ host: "::1", port: poort, ipv6Only: true }, () => {
      servers.push(tweede);
      klaar();
    });
  });

  return {
    poort,
    sluit: async () => {
      await Promise.all(servers.map((server) => new Promise<void>((klaar) => server.close(() => klaar()))));
    },
  };
}

/**
 * Voert de volledige autorisatiecode-flow met PKCE uit en levert een delegated
 * access token plus de gecontroleerde id-tokenclaims.
 */
export async function meldAan(opdracht: AanmeldOpdracht): Promise<Aanmelding> {
  if (!opdracht.redirectUris.some((uri) => uri.replace(/\/+$/, "") === VERWACHTE_REDIRECT_BASIS)) {
    throw new AuthFout(
      "redirect_niet_geregistreerd",
      `de appregistratie kent '${VERWACHTE_REDIRECT_BASIS}' niet als redirect-URI`,
    );
  }

  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));
  const nonce = base64url(randomBytes(16));

  let oplossen: (code: string) => void;
  let afwijzen: (fout: Error) => void;
  const opCode = new Promise<string>((klaar, mislukt) => {
    oplossen = klaar;
    afwijzen = mislukt;
  });

  const ontvanger = await startOntvanger((url) => {
    const fout = url.searchParams.get("error");
    if (fout) {
      // De foutbeschrijving van Microsoft komt NIET in onze fout terecht: die
      // tekst kan een UPN of correlatie-id dragen en reist door naar de output.
      afwijzen(new AuthFout("autorisatie_geweigerd", `autorisatieserver gaf fout '${fout}'`));
      return "Aanmelding geweigerd. Deze pagina mag gesloten worden.";
    }
    const ontvangenState = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    if (!ontvangenState || !gelijkeState(ontvangenState, state)) {
      afwijzen(new AuthFout("state_mismatch", "de callback droeg een andere state dan verzonden"));
      return "Onverwachte callback. Deze pagina mag gesloten worden.";
    }
    if (!code) {
      afwijzen(new AuthFout("code_ontbreekt", "de callback droeg geen autorisatiecode"));
      return "Geen autorisatiecode ontvangen. Deze pagina mag gesloten worden.";
    }
    oplossen(code);
    return "Aangemeld. Deze pagina mag gesloten worden; ga terug naar de terminal.";
  });

  const redirectUri = `http://localhost:${ontvanger.poort}/`;
  const autoriteit = `https://login.microsoftonline.com/${opdracht.tenantId}/oauth2/v2.0`;
  // GEEN offline_access: zonder die scope is er geen refresh token om te bewaren.
  const scopes = [
    "openid",
    "profile",
    ...opdracht.delegatedPermissions.map((permissie) => `https://graph.microsoft.com/${permissie}`),
  ];

  const autorisatieUrl = new URL(`${autoriteit}/authorize`);
  for (const [sleutel, waarde] of Object.entries({
    client_id: opdracht.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: scopes.join(" "),
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    // Stuurt de aanmeldpagina naar de geregistreerde testidentiteit. Het is een
    // hint, geen grendel: welke actor het daadwerkelijk werd, stelt de
    // driftcontrole vast.
    login_hint: opdracht.loginHint,
  })) {
    autorisatieUrl.searchParams.set(sleutel, waarde);
  }

  let code: string;
  try {
    opdracht.toonUrl(autorisatieUrl.toString());
    const wacht = opdracht.wachtMs ?? STANDAARD_WACHT_MS;
    code = await Promise.race([
      opCode,
      new Promise<never>((_, mislukt) => {
        const timer = setTimeout(
          () => mislukt(new AuthFout("aanmelding_timeout", `geen callback binnen ${Math.round(wacht / 1000)} s`)),
          wacht,
        );
        timer.unref?.();
        opdracht.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            mislukt(new AuthFout("aanmelding_afgebroken", "de run is afgebroken"));
          },
          { once: true },
        );
      }),
    ]);
  } finally {
    await ontvanger.sluit();
  }

  const payload = await wisselCodeIn({
    autoriteit,
    clientId: opdracht.clientId,
    code,
    redirectUri,
    verifier,
    signal: opdracht.signal,
    timeoutMs: opdracht.tokenTimeoutMs,
    fetchImpl: opdracht.fetchImpl,
  });

  const accessToken = payload.access_token;
  const idToken = payload.id_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new AuthFout("token_ontbreekt", "de tokenrespons bevat geen access token");
  }
  if (typeof idToken !== "string" || idToken.length === 0) {
    throw new AuthFout("token_ontbreekt", "de tokenrespons bevat geen id-token");
  }
  // Controle, geen vertrouwen: als hier tóch een refresh token opduikt, is er
  // een scope of een appinstelling veranderd en stopt de run.
  if (typeof payload.refresh_token === "string") {
    throw new AuthFout("refreshtoken_onverwacht", "de tokenrespons droeg een refresh token");
  }

  const claims = leesClaims(idToken);
  if (!claims.nonce || claims.nonce !== nonce) {
    throw new AuthFout("nonce_mismatch", "het id-token hoort niet bij deze aanmeldpoging");
  }
  if (claims.aud !== opdracht.clientId.toLowerCase()) {
    throw new AuthFout("aud_mismatch", "het id-token is voor een andere appregistratie uitgegeven");
  }
  if (claims.iss !== `https://login.microsoftonline.com/${claims.tid}/v2.0`) {
    throw new AuthFout("iss_mismatch", "de issuer van het id-token hoort niet bij de tenant in het token");
  }
  if (typeof claims.exp === "number" && claims.exp * 1000 <= Date.now()) {
    throw new AuthFout("idtoken_verlopen", "het id-token is al verlopen");
  }

  return {
    accessToken,
    claims,
    toegekendeScopes: typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [],
  };
}
