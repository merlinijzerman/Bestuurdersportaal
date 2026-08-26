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
// ÉÉN enforce-module, gedeeld met withFondsRoute. `platform/lib` importeert al uit
// `core/lib` (ai-poort, app-fout, …); andersom nul. Geen duplicaat. Zie TICKET-W9 §2.2.
import {
  beoordeelSchema,
  leesBodyVanKloon,
  schemaEnforceAan,
  type SchemaDeclaratie,
} from "@/core/lib/schema-enforce";

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

/** De directe schrijf-primitieven op de service-role-client. */
export type DirecteMutatie = "delete" | "insert" | "update" | "upsert" | "storage-remove";

export type MachineSpecV1 = {
  readonly bewaking: MachineBewaking;
  /** Herkenbare naam in logregels. Geen effect op de respons. */
  readonly label: string;
  /**
   * De directe schrijfacties die de HANDLER ZELF op database/storage doet, als
   * DRIFTDETECTOR: wijkt de code van het routebestand af van deze lijst, dan valt
   * de gate `machine-directe-mutaties.sanity.ts` om. `[]` = geen directe mutatie
   * in de handler.
   *
   * MEET BEWUST NIET de mutaties in aangeroepen `platform/lib`-functies — vijf van
   * de zes service-role-machineroutes delegeren hun schrijfwerk (queues, storage),
   * en een route-surface-grep kijkt daar niet in. Dit veld is dus geen
   * capability-grens over het hele call-pad; die structurele grens (de wrapper
   * levert een begrensde client) is vervolgticket #172. Elke controle verklaart
   * wat hij meet — vandaar de naam naar het meetbare, niet naar gezag.
   */
  readonly directeMutaties: readonly DirecteMutatie[];
  /** WELKE bodyvorm deze machineroute accepteert. VERPLICHT (besluit optie a) — een
   *  zod-schema of `"geen-body"`. Van de 12 machinehandlers leest alleen
   *  `internal/semantische-extractie` een body (`document_id`); de rest is
   *  `"geen-body"`. Zelfde `request.clone()`-mechaniek en vlag als withFondsRoute. */
  readonly schema: SchemaDeclaratie;
  /** Tempolimiet (W10). ÉÉN toegestane literal: `"geen"` — en dat is een TYPEGRENS,
   *  geen keuze. `fn_rate_limit_check` sleutelt op `auth.uid()` en werpt `28000`
   *  bij een null-uid (`2026_06_10_rate_limiting.sql`); een machineroute heeft geen
   *  sessie, dus een echte `LimietNaam` zou daar een 500 geven i.p.v. een 429. Het
   *  type verbiedt dat aan de bron, zodat de codemod van #183 er geen kan neerzetten.
   *  Hier is `"geen"` bovendien EERLIJK: machineroutes hébben geen tempolimiet — de
   *  asymmetrie met `audit` (dat het dekkende mechanisme benoemt) staat in besluit 0190.
   *  VERPLICHT (#183a); er is geen rate-limit-codepad in deze wrapper (altijd no-op). */
  readonly rateLimit: "geen";
  /** Auditspoor (W11). TWEE toegestane literals: `"platform-event-log" | "geen"`.
   *  De wrapper schrijft NIETS (geen `auth.uid()`/fonds → geen handelingen_log); de
   *  literal BENOEMT het dekkende mechanisme, en die benoeming is GEMETEN, niet
   *  beweerd — de assertie in `audit-inventaris.mjs` valt rood als een
   *  `"platform-event-log"`-declaratie niet aantoonbaar naar `platform_event_log`
   *  schrijft.
   *
   *  ⚠ CORRECTIE (gemeten op `origin/preview`): een eerdere versie van dit commentaar
   *  beweerde dat "de 6 machinehandlers hun spoor al naar `platform_event_log`
   *  schrijven". Dat is ONWAAR — nul aanroepen van `logAttempt`/`logSecurity`/
   *  `logResultGegarandeerd` in de machineroutes. Het mechanisme bestaat (platform-
   *  serveracties gebruiken het via `withPlatform`), maar de machineroutes laten het
   *  liggen; `monitoring/snapshot` *leest* `platform_event_log` (het is de gat-detector)
   *  maar schrijft het niet. De waarde is bovendien PER SPEC, niet per methode: GET en
   *  POST delen in vijf bestanden één `const SPEC` + één `draai`, dus ze dragen dezelfde
   *  `audit`-waarde (per-methode splitsen = de SPEC splitsen = structuurwijziging).
   *  #183b-machine voegt `logResultGegarandeerd` (retry, NIET fail-closed — een logfout
   *  mag een cron-run niet laten mislukken) toe aan de vijf worker-SPECs (aqlab/worker ·
   *  afschrift-worker · ingest-worker · semantische-extractie · monitoring/snapshot);
   *  de twee readiness-probes (`platform/healthz`, `healthz/ping`) krijgen `"geen"` (ze
   *  muteren niets en `healthz` logt bewust niet — een gezondheidscontrole die faalt op
   *  het loggen is een zelfreferentiële storing). Tot die writes landen bevriest #183a
   *  alle 12 declaraties op `"geen"` en houdt de drager `spoor_vereist` in
   *  `audit-inventaris.json` de 9 openstaande worker-declaraties rood (symmetrisch aan
   *  `ketengebeurtenis_vereist` op de tenant-kant). Elke `"platform-event-log"`-declaratie
   *  valt rood tot het gemeten spoor bestaat. VERPLICHT (#183a); #183a bevriest alle
   *  12 op `"geen"`, #183b-machine flipt de 5 worker-SPECs na de write. */
  readonly audit: "platform-event-log" | "geen";
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
  /** Leest `ENFORCE_SCHEMA`. Injecteerbaar zodat de sanity-suite beide vlagstanden
   *  bewijst zonder process.env te muteren. Dezelfde vlag als withFondsRoute. */
  schemaEnforceAan: () => boolean;
};

const echteDeps: MachineDeps = {
  draaitOpAppSurface: async () => (await import("./cron-auth")).draaitOpAppSurface(),
  geautoriseerdeCron: async (req) => (await import("./cron-auth")).geautoriseerdeCron(req),
  schemaEnforceAan,
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

      // Schema-poort (W9) — NA de bewaking, VÓÓR de handler. Leest een
      // request.clone(), nooit het origineel: de handler leest de body zelf.
      // Vlag UIT → observe + door (byte-identiek); vlag AAN → mismatch = 400.
      if (spec.schema !== "geen-body") {
        // Afwezige/lege body → `{}` (geen 400); alleen écht kapotte JSON → 400.
        const { body, kapot } = await leesBodyVanKloon(request);
        const handhaven = deps.schemaEnforceAan();
        if (kapot) {
          console.warn("[SCHEMA-OBSERVE]", {
            route: spec.label,
            handler: request.method,
            veld: "(body)",
            verwacht: "json",
            gekregen: "onparsebaar",
            code: "invalid_json",
            handhaven,
            requestId,
          });
          if (handhaven) return NextResponse.json({ error: "Ongeldige invoer." }, { status: 400 });
        } else {
          const oordeel = beoordeelSchema({ schema: spec.schema, body });
          if (!oordeel.toegestaan) {
            for (const f of oordeel.fouten) {
              console.warn("[SCHEMA-OBSERVE]", {
                route: spec.label,
                handler: request.method,
                veld: f.veld,
                verwacht: f.verwacht,
                gekregen: f.gekregen,
                code: f.code,
                handhaven,
                requestId,
              });
            }
            if (handhaven) {
              return NextResponse.json({ error: "Ongeldige invoer." }, { status: 400 });
            }
          }
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
