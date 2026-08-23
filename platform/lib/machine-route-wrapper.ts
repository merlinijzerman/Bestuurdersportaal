// ============================================================================
//  withMachineRoute v1 — de naad voor machineroutes (EPIC W, W5b, PR 1).
// ----------------------------------------------------------------------------
//  `withFondsRoute` gaat over een TENANTGEBRUIKER: sessie → profiel → fonds.
//  Een machineroute heeft geen van drieën. Hij wordt niet door een browser met
//  een cookie aangeroepen maar door een cron of een operator met een bearer,
//  en hij draait met de service-role. Dat is een ander beveiligingsmodel en dus
//  een andere wrapper — niet een vlag op de bestaande.
//
//  v1 DOET PRECIES WAT DE ROUTES VANDAAG AL DOEN. Nul gedragswijziging. De
//  bestaande controle wordt letterlijk verplaatst, niets meer:
//
//    1. DEPLOY_TARGET-guard — draait deze route op de gedeelde app-/publieke
//       surface, dan no-oppen met 200 {"ok":true,"skipped":"deploy_target=app"}.
//    2. CRON_SECRET-bearer   — constant-time; bij afkeuring 401
//       {"error":"Niet geautoriseerd"}.
//
//  DE VOLGORDE IS DE CONTROLE, niet een detail. De skip staat VÓÓR de auth,
//  precies zoals in alle zes routes vandaag. Gevolg: een onbevoegde aanroep op
//  de app-surface krijgt een 200 met `skipped` in plaats van een 401. Dat
//  verraadt alleen de waarde van DEPLOY_TARGET en geen diagnostisch detail.
//  Omdraaien zou het gedrag wijzigen en hoort dus niet in v1.
//
//  WAT V1 BEWUST NIET DOET
//  Geen laatste vangnet. `withFondsRoute` heeft er wel een — dat kon daar,
//  omdat 87 catch-blokken al exact die vorm produceerden en de wrapper dus niets
//  nieuws introduceerde. Hier ligt dat anders: een onafgevangen fout in een
//  machineroute levert vandaag de framework-500 van Next, en die vervangen door
//  {"error":"Serverfout"} zou een gedragswijziging zijn op precies het pad dat
//  een snapshot niet uitlokt. Een vangnet is een kandidaat voor PR 2, met de
//  wijziging apart en gemotiveerd. Niet hier.
//
//  Ook geen rate limit, geen audit, geen x-request-id-header. Het correlatie-id
//  leeft in ctx en in logregels, nooit in de respons — zetten we het in een
//  header, dan wijkt elk snapshot af.
//
//  DE VIER DUPLICATEN. `internal/afschrift-worker`, `internal/ingest-worker`,
//  `internal/semantische-extractie` en `aqlab/worker` droegen elk hun eigen
//  kopie van de bearer-check (bevinding H-02: vier kopieën van één functie).
//  Vóór de migratie is regel voor regel vergeleken: alle vier zijn functioneel
//  identiek aan platform/lib/cron-auth.ts — zelfde fail-closed tak, zelfde
//  lengtecheck vóór timingSafeEqual, zelfde volgorde, zelfde responses. Alleen
//  het commentaar verschilde. Consolideren is hier dus geen gedragswijziging
//  maar het wegnemen van vier plekken waar er stilletjes één uit de pas kan
//  gaan lopen — wat H-02 juist als risico noemt.
// ============================================================================
import { NextResponse, type NextRequest } from "next/server";

/** Hoe deze route bewaakt wordt. TWEE WAARDEN, en `"publiek"` is er omdat een
 *  AFWEZIGE bewaking niet te onderscheiden is van een VERGETEN bewaking —
 *  dezelfde reden als `hostGuard: "route-eigen"` in withFondsRoute.
 *
 *    "cron-secret"  DEPLOY_TARGET-skip + constant-time CRON_SECRET-bearer.
 *    "publiek"      bewust geen enkele controle. Op dit moment uitsluitend
 *                   `healthz/ping`: een liveness-probe die altijd exact
 *                   {"ok":true} teruggeeft, geen database raakt, geen env
 *                   leest en geen versienummer kent. De ECHTE diagnostiek zit
 *                   achter CRON_SECRET in platform/healthz. Wie hier een route
 *                   bijzet, zet er een motivering bij. */
export type MachineBewaking = "cron-secret" | "publiek";

export type MachineSpecV1 = {
  readonly bewaking: MachineBewaking;
  /** Herkenbare naam in logregels. Geen effect op de respons. */
  readonly label: string;
};

/** Context voor een machineroute. Bewust mager: er is geen sessie, geen
 *  profiel en geen fonds. Wat een machineroute nodig heeft, maakt hij zelf
 *  (`createServiceSupabase`) — de wrapper bouwt geen client voor hem, want dan
 *  zou elke route er een krijgen, ook de publieke. */
export type MachineContext = {
  readonly requestId: string;
  readonly label: string;
};

type MachineHandler = (
  ctx: MachineContext,
  request: NextRequest,
  params: unknown
) => Promise<Response> | Response;

/** Injecteerbare afhankelijkheden, zodat de sanity-suite draait zonder
 *  Next-runtime en zonder echte env. Beide mogen sync of async zijn: de echte
 *  set laadt `cron-auth` LAZY omdat die `server-only` meetrekt, en dat zou dit
 *  bestand — en dus de sanity-suite — buiten Next onimporteerbaar maken.
 *  Zelfde constructie als `echteDeps` in core/lib/route-wrapper.ts. */
export type MachineDeps = {
  draaitOpAppSurface: () => boolean | Promise<boolean>;
  geautoriseerdeCron: (req: NextRequest) => boolean | Promise<boolean>;
};

const echteDeps: MachineDeps = {
  draaitOpAppSurface: async () => (await import("./cron-auth")).draaitOpAppSurface(),
  geautoriseerdeCron: async (req) => (await import("./cron-auth")).geautoriseerdeCron(req),
};

/** Factory zodat de wrapper testbaar is zonder env en zonder Next-runtime.
 *  De publieke {@link withMachineRoute} is deze factory met de echte deps. */
export function maakWithMachineRoute(deps: MachineDeps) {
  return function withMachineRoute(spec: MachineSpecV1, handler: MachineHandler) {
    // Next genereert per route een strikte RouteContext-typecheck op de tweede
    // parameter. Geen van de huidige machineroutes is dynamisch, maar de vorm
    // wordt hier wel doorgegeven zodat een latere [id]-machineroute niet eerst
    // de wrapper hoeft te verbouwen.
    return async function (request: NextRequest, invocatie?: any): Promise<Response> {
      const requestId = crypto.randomUUID();

      if (spec.bewaking === "cron-secret") {
        // 1. Skip vóór auth — zie de kop: de volgorde IS de controle.
        if (await deps.draaitOpAppSurface()) {
          return NextResponse.json({ ok: true, skipped: "deploy_target=app" });
        }
        // 2. Constant-time bearer.
        if (!(await deps.geautoriseerdeCron(request))) {
          return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
        }
      }

      const ctx: MachineContext = { requestId, label: spec.label };
      const params: unknown = invocatie?.params ? await invocatie.params : undefined;
      // GEEN try/catch: zie de kop. De route behoudt zijn eigen foutafhandeling
      // en een onafgevangen fout levert exact wat hij vandaag levert.
      return handler(ctx, request, params);
    };
  };
}

export const withMachineRoute = maakWithMachineRoute(echteDeps);
