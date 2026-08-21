// tests/cross-tenant/route-wrapper-bewust.ts
// -----------------------------------------------------------------------------
// Wrapper-bewuste bronherkenning voor de statische §15-guards (EPIC W, W3/#94).
//
// De statische guards (AFS-1, AQL-4, …) toetsen BRONPATRONEN: "roept de route
// createServerSupabase( aan?", "roept ze beoordeelRouteHostToegang( aan?". Die
// vraagstelling ging uit van een route die haar preambule zélf schrijft. Sinds de
// W3-codemod schrijft `withFondsRoute` die preambule. De belofte is niet
// verdwenen — ze is één laag verhuisd.
//
// Een guard die dat niet weet is vals-rood. Maar het patroon dan maar schrappen
// uit de guard maakt hem vals-groen: dan bewijst niets meer dát er een RLS-client
// en een host↔fonds-grens is. Dit bestand kiest de derde weg:
//
//   • het bepaalt PER GEËXPORTEERDE HANDLER waar de belofte hoort te staan —
//     in de route zelf (klassiek) of in de wrapper (na de codemod);
//   • het verankert de delegatie met `toetsWrapperFundament()`: de wrapper moet
//     aantoonbaar createServerSupabase + auth.getUser doen, de service-role NIET
//     aanraken, en onder `spec.hostGuard` feitelijk beoordeelRouteHostToegang
//     aanroepen met een 403 bij afwijzing. Zonder dat anker zou "de route wijst
//     naar de wrapper" een lege verwijzing zijn en de invariant verdampen;
//   • het accepteert `withFondsRoute` alleen als de route hem ook echt uit
//     `@/core/lib/route-wrapper` importeert — een gelijknamige lokale functie
//     telt niet.
//
// Netto is de guard hierdoor STRENGER dan voorheen: eerst volstond het dat het
// patroon érgens in het bestand stond, nu moet elke handler afzonderlijk gedekt
// zijn (route-eigen of via een spec die de guard aanzet).
// -----------------------------------------------------------------------------
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const hier = dirname(fileURLToPath(import.meta.url));

/** Leest een bestand relatief aan de repo-root. */
export const leesBron = (...p: string[]): string =>
  readFileSync(join(hier, "..", "..", ...p), "utf8");

const METHODEN = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type Methode = (typeof METHODEN)[number];

/** De import moet uit de ECHTE wrapper komen; een lokale `withFondsRoute` niet. */
const WRAPPER_IMPORT =
  /import\s*\{[^}]*\bwithFondsRoute\b[^}]*\}\s*from\s*["']@\/core\/lib\/route-wrapper["']/;

export type Handlerbeeld = {
  readonly methode: Methode;
  /** true = `export const GET = withFondsRoute(spec, …)` uit de echte wrapper. */
  readonly viaWrapper: boolean;
  /** true = de spec zet `hostGuard: true` aan (alleen zinvol bij viaWrapper). */
  readonly hostGuardInSpec: boolean;
};

/** Inventariseert de geëxporteerde HTTP-handlers van een route-bestand. */
export function leesHandlers(bron: string): Handlerbeeld[] {
  const heeftWrapperImport = WRAPPER_IMPORT.test(bron);
  const beeld: Handlerbeeld[] = [];
  for (const methode of METHODEN) {
    // Spec-object van de wrapper-aanroep. De spec is plat (hostGuard + label),
    // dus [^{}]* is hier exact genoeg en kan niet over de handler heen lopen.
    const wrapper = new RegExp(
      `export\\s+const\\s+${methode}\\s*=\\s*withFondsRoute\\s*\\(\\s*(\\{[^{}]*\\})`
    ).exec(bron);
    if (wrapper && heeftWrapperImport) {
      beeld.push({
        methode,
        viaWrapper: true,
        hostGuardInSpec: /\bhostGuard\s*:\s*true\b/.test(wrapper[1]),
      });
      continue;
    }
    const eigen = new RegExp(
      `export\\s+(?:async\\s+)?function\\s+${methode}\\s*[(<]|export\\s+const\\s+${methode}\\s*[:=]`
    ).test(bron);
    if (eigen) beeld.push({ methode, viaWrapper: false, hostGuardInSpec: false });
  }
  return beeld;
}

// ── Het anker: de wrapper maakt de belofte die de routes eraan delegeren waar ──

let fundamentGetoetst = false;

/** Bewijst dat `withFondsRoute` doet wat de wrapper-bewuste guards aannemen.
 *  Idempotent; roep hem aan vóór je op de delegatie leunt. */
export function toetsWrapperFundament(): void {
  if (fundamentGetoetst) return;
  const w = leesBron("core", "lib", "route-wrapper.ts");

  // (a) De wrapper draait op de RLS-client en raakt de service-role nooit.
  assert.ok(w.includes("createServerSupabase"), "wrapper: geen createServerSupabase → routes die eraan delegeren staan zonder RLS-client");
  assert.ok(
    !w.includes("createServiceSupabase") && !w.includes("SUPABASE_SERVICE_ROLE_KEY"),
    "wrapper raakt de service-role — dan lekt élke gedelegeerde route eromheen"
  );

  // (b) Sessiecontrole met de bestaande 401-vorm.
  assert.ok(w.includes("auth.getUser("), "wrapper: geen auth.getUser");
  assert.match(w, /!user[\s\S]{0,80}?nietIngelogd\(\)/, "wrapper: geen 401-tak bij ontbrekende sessie");
  assert.match(w, /nietIngelogd[\s\S]{0,200}?status:\s*401/, "wrapper: nietIngelogd geeft geen 401");

  // (c) Host↔fonds wordt onder spec.hostGuard feitelijk afgedwongen, met 403.
  assert.match(
    w,
    /spec\.hostGuard[\s\S]{0,300}?beoordeelRouteHostToegang\(/,
    "wrapper: spec.hostGuard roept beoordeelRouteHostToegang niet aan"
  );
  assert.match(
    w,
    /!oordeel\.toegestaan[\s\S]{0,300}?status:\s*403/,
    "wrapper: een afgewezen host-oordeel leidt niet tot 403"
  );

  // (d) De handler krijgt de RLS-client mee (anders werkt de route buiten RLS om).
  assert.match(
    w,
    /ctx:\s*FondsContext\s*=\s*\{[\s\S]{0,400}?\bsupabase,/,
    "wrapper: geeft de RLS-client niet door in ctx"
  );

  // (e) `ctx.fondsId` en `ctx.rol` komen UITSLUITEND uit haalProfiel — nooit uit
  //     body of query. Zonder dit anker zou een guard die `ctx.fondsId` accepteert
  //     als "server-side afgeleid" een lege verwijzing zijn: de route bewijst dan
  //     niets meer over de herkomst van het fonds. (W4, issue #94/#96.)
  assert.match(
    w,
    /const\s+profiel\s*=\s*await\s+deps\.haalProfiel\(/,
    "wrapper: het profiel komt niet uit haalProfiel"
  );
  assert.match(
    w,
    /const\s+fondsId\s*=\s*profiel\?\.fondsId/,
    "wrapper: fondsId wordt niet uit het profiel afgeleid"
  );
  assert.match(
    w,
    /ctx:\s*FondsContext\s*=\s*\{[\s\S]{0,400}?\bfondsId,/,
    "wrapper: geeft het profiel-fondsId niet door als ctx.fondsId"
  );
  assert.match(
    w,
    /ctx:\s*FondsContext\s*=\s*\{[\s\S]{0,400}?\brol:\s*profiel\?\.rol/,
    "wrapper: ctx.rol komt niet uit het profiel"
  );
  // (f) `ctx.email` komt uit de SESSIE (user), niet uit body of profiel. Zonder
  //     dit anker zou een route die `user.email` door `ctx.email` verving op een
  //     lege verwijzing kunnen leunen.
  assert.match(
    w,
    /ctx:\s*FondsContext\s*=\s*\{[\s\S]{0,400}?\bemail:\s*user\.email\b/,
    "wrapper: ctx.email komt niet uit de sessiegebruiker"
  );

  fundamentGetoetst = true;
}

// ── De drie wrapper-bewuste vragen ────────────────────────────────────────────

function benoem(beeld: Handlerbeeld[]): string {
  return beeld.map((h) => h.methode).join("/");
}

/** null = in orde; anders de reden waarom de RLS-client niet aantoonbaar is. */
export function redenGeenRlsClient(bron: string): string | null {
  toetsWrapperFundament();
  const handlers = leesHandlers(bron);
  if (handlers.length === 0) return "geen geëxporteerde HTTP-handler gevonden";
  const eigen = handlers.filter((h) => !h.viaWrapper);
  if (eigen.length > 0 && !bron.includes("createServerSupabase(")) {
    return `${benoem(eigen)} schrijft de preambule zelf maar roept createServerSupabase( niet aan (en loopt niet via withFondsRoute)`;
  }
  return null;
}

/** null = in orde; anders de reden waarom de sessiecontrole niet aantoonbaar is. */
export function redenGeenGebruikerscontrole(bron: string): string | null {
  toetsWrapperFundament();
  const handlers = leesHandlers(bron);
  if (handlers.length === 0) return "geen geëxporteerde HTTP-handler gevonden";
  const eigen = handlers.filter((h) => !h.viaWrapper);
  if (eigen.length > 0 && !bron.includes("auth.getUser")) {
    return `${benoem(eigen)} controleert de sessie niet (geen auth.getUser, geen withFondsRoute)`;
  }
  return null;
}

/** null = in orde; anders de reden waarom host↔fonds niet aantoonbaar geldt. */
export function redenGeenHostGuard(bron: string): string | null {
  toetsWrapperFundament();
  const handlers = leesHandlers(bron);
  if (handlers.length === 0) return "geen geëxporteerde HTTP-handler gevonden";
  const inlineGuard = bron.includes("beoordeelRouteHostToegang(");
  const ongedekt = handlers.filter((h) => (h.viaWrapper ? !h.hostGuardInSpec : !inlineGuard));
  if (ongedekt.length > 0) {
    return `${benoem(ongedekt)} dwingt host↔fonds niet af (geen beoordeelRouteHostToegang( in de route, geen withFondsRoute({ hostGuard: true }))`;
  }
  return null;
}

/** null = in orde; anders de reden waarom `fonds_id` niet aantoonbaar
 *  server-side uit het profiel komt.
 *
 *  Klassiek schrijft de route dat zelf (`profiel.fonds_id` / `profiel?.fonds_id`);
 *  na de codemod komt het uit `ctx.fondsId`, dat de wrapper uitsluitend uit
 *  `haalProfiel` vult — verankerd door {@link toetsWrapperFundament} (e). De
 *  negatieve helft van de invariant ("nooit uit de body") blijft bij de aanroeper:
 *  die kent de body-vorm van de route. */
export function redenFondsIdNietUitProfiel(bron: string): string | null {
  toetsWrapperFundament();
  const handlers = leesHandlers(bron);
  if (handlers.length === 0) return "geen geëxporteerde HTTP-handler gevonden";
  const uitProfiel = /\bprofiel\??\.fonds_id\b/.test(bron);
  const uitCtx = /\bctx\.fondsId\b/.test(bron);
  // PER HANDLER, niet per bestand. Een bestand met één gemigreerde en één
  // klassieke handler zou bij een bestandstoets alleen nog de klassieke eis
  // stellen: de wrapper-tak valt dan stil weg en de guard is eenzijdig — rood bij
  // sabotage, dus ogenschijnlijk gezond, terwijl hij over de gemigreerde handler
  // niets meer belooft. `stuurinformatie/beheer` (GET+POST) is precies zo'n
  // bestand. Zie ook redenGeenHostGuard, dat dezelfde vorm heeft.
  const ongedekt = handlers.filter((h) => (h.viaWrapper ? !uitCtx : !uitProfiel));
  if (ongedekt.length > 0) {
    return `${benoem(ongedekt)} leidt fonds_id niet af uit het profiel (geen profiel.fonds_id / profiel?.fonds_id in de route, geen ctx.fondsId uit de wrapper)`;
  }
  return null;
}

/** De uitdrukking waarmee DEZE route de profielrol aanduidt: `profiel?.rol` als
 *  ze haar preambule zelf schrijft, `ctx.rol` als elke handler aan de wrapper
 *  delegeert. Zo blijft een guard die op de letterlijke regel toetst even streng
 *  als voorheen, in plaats van beide vormen los te accepteren. */
export function rolUitdrukkingVoor(bron: string): "profiel?.rol" | "ctx.rol" {
  toetsWrapperFundament();
  const handlers = leesHandlers(bron);
  const allesViaWrapper = handlers.length > 0 && handlers.every((h) => h.viaWrapper);
  return allesViaWrapper ? "ctx.rol" : "profiel?.rol";
}
