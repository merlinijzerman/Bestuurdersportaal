// ============================================================================
//  withFondsRoute — de naad (EPIC W; v1 = W2/deploy 2, capability-poort = W6).
// ----------------------------------------------------------------------------
//  Eén punt waar elke tenant-route doorheen loopt. v1 deed PRECIES wat de routes
//  al deden — nul gedragsverandering, zodat de karakteriseringssnapshots (W1)
//  byte-identiek bleven. Schemavalidatie, rate limit, audit, centrale
//  foutconsolidatie en de x-request-id-header zijn W8–W11 — bewust NIET hier.
//
//  W6 voegt het VIJFDE ding toe: de capability-poort. Die landt UITGESCHAKELD
//  (`ENFORCE_CAPABILITY` staat uit) en met 112 handlers op `"TE_BEPALEN"`, dus
//  ook nu verandert er geen responsebyte en blijven de snapshots byte-identiek.
//  Wat hij wél doet is observeren: elke zou-weigering gaat als
//  `[CAPABILITY-OBSERVE]` naar het log, en dat is de dataset waarmee W7 begint.
//
//  De wrapper doet exact vijf dingen:
//    1. Authenticatie      — createServerSupabase() + auth.getUser(); bij !user
//                            EXACT NextResponse.json({error:"Niet ingelogd"},401).
//    2. Profielresolutie   — haalProfiel(supabase, user.id): id, naam, rol, fonds_id.
//                            (`ctx.email` komt uit de sessie, niet uit het profiel;
//                            zie de toelichting bij FondsContext.)
//    3. Host-guard         — alleen als spec.hostGuard === true (de 12 routes die
//                            hem nu al hebben); hergebruikt beoordeelRouteHostToegang.
//                            `hostGuard: "route-eigen"` = de route doet het zelf,
//                            bewust; zie RouteSpecV1.
//    3b. Capability-poort — beoordeelt spec.capability tegen de profielrol
//                            (core/lib/capability-enforce.ts). Onder
//                            `ENFORCE_CAPABILITY=on` wordt een zou-weigering een
//                            403; anders alleen een logregel. NA de host-guard,
//                            zie het BESLUIT bij het blok zelf.
//    4. Correlation ID     — gegenereerd, in ctx en logregels. NIET als
//                            responseheader (dat zou elk snapshot doen afwijken).
//
//  De wrapper vangt GEEN fouten die de route zelf al vangt; hij heeft alleen een
//  laatste vangnet dat dezelfde vorm produceert die 87 catch-blokken al gebruiken:
//  {"error":"Serverfout"} / 500. Consolidatie van de 9 catch-varianten = deploy 3.
// ============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { haalProfiel } from "@/core/lib/profiel";
import {
  beoordeelCapability,
  capabilityEnforceAan,
  type RouteCapability,
} from "@/core/lib/capability-enforce";
// LET OP: tenant-route-guard trekt `server-only` mee. Die wordt daarom LAZY
// geladen in echteDeps (alleen de 12 host-guard-routes raken hem), zodat deze
// module — en dus de sanity-suite — buiten de Next-runtime importeerbaar blijft.

type RlsClient = Awaited<ReturnType<typeof createServerSupabase>>;

/** Server-side afgeleide tenantcontext. Alle velden readonly: `fondsId` komt
 *  UITSLUITEND uit haalProfiel, nooit uit body of query. */
export type FondsContext = {
  readonly gebruikerId: string;
  /** `user.email` uit de sessie. GEEN vijfde ding dat de wrapper DOET — het is
   *  wat de oude preambule de handler al gaf: die had `user` in scope. Drie van
   *  de 78 W4-routes gebruiken het als naam-fallback (`profiel?.naam ||
   *  user.email`). Bewust `string | undefined` en niet `| null`: bij een insert
   *  laat PostgREST een `undefined`-veld weg (kolomdefault) terwijl `null` de
   *  kolom expliciet leegzet. Dat verschil is in de snapshots onzichtbaar omdat
   *  de fixtures allemaal een naam hebben — dus hier exact overnemen i.p.v.
   *  vertrouwen op de test. */
  readonly email: string | undefined;
  readonly fondsId: string | null; // null = gebruiker zonder fonds; route beslist zelf
  readonly rol: string | null;
  readonly naam: string | null;
  readonly supabase: RlsClient; // RLS-client (anon-key)
  readonly requestId: string;
};

export type RouteSpecV1 = {
  /** WIE mag deze route aanroepen. VERPLICHT — geen default, geen weglating.
   *
   *  Verplicht en niet optioneel omdat een AFWEZIG veld niet te onderscheiden is
   *  van een VERGETEN veld; dezelfde redenering als bij `hostGuard`. Het type
   *  dwingt af dat elke nieuwe route een declaratie MEEBRENGT — ook als die
   *  declaratie voorlopig `"TE_BEPALEN"` is.
   *
   *  W6 landt met 112 handlers op `"TE_BEPALEN"` en de vlag `ENFORCE_CAPABILITY`
   *  UIT: gedrag ongewijzigd, wél observe-logging. W7 vult de echte declaraties
   *  in; W13 laat CI falen op elke resterende `"TE_BEPALEN"`.
   *
   *  ⚠ DE WRAPPER-CHECK KOMT BOVENÓP DE ROUTE-EIGEN GATES, hij vervangt er geen
   *  enkele. Een declaratie hier kan RUIMER zijn dan de inline `requireCapability`
   *  of rolstring in de route. Zolang beide draaien is dat onschadelijk; haal je
   *  de inline gate weg in het vertrouwen dat de wrapper het overneemt, dan
   *  verzwak je de route zonder dat een test dat ziet. Zie TICKET-W6 §3. */
  readonly capability: RouteCapability;
  /** Wie host↔fonds afdwingt voor deze route. Drie waarden, en de derde is er
   *  omdat een AFWEZIG veld niet te onderscheiden is van een VERGETEN veld:
   *
   *    true            de wrapper doet het, vóór de handler (de gewone vorm);
   *    false/afwezig   deze route kent geen host↔fonds-grens;
   *    "route-eigen"   de route roept `beoordeelRouteHostToegang` ZELF aan, en
   *                    dat is een bewuste keuze — niet een vergeten vlag.
   *
   *  W4 gebruikt "route-eigen" voor `documents/upload`: de wrapper zou de guard
   *  vóór de fail-closed rate limit trekken, en de twee aparte labels
   *  (`documents.upload.init` / `.complete`) die de anomaliedetectie voeden tot
   *  één samenvouwen. Zo is de uitzondering greppable, kan een latere gate hem
   *  onderscheiden van een omissie, en hangt de motivering aan de code. */
  readonly hostGuard?: boolean | "route-eigen";
  /** loglabel voor de host-guard-anomaliedetectie (alleen logging, geen respons). */
  readonly label?: string;
};

type FondsHandler = (
  ctx: FondsContext,
  request: NextRequest,
  params: unknown
) => Promise<Response> | Response;

/** 401-respons — LETTERLIJK zoals de 93 preambles hem vandaag produceren. */
function nietIngelogd(): NextResponse {
  return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
}

/** 403-respons van de capability-poort. Eén vaste vorm, zoals de host-guard er
 *  ook één heeft. Bewust GEEN 404: het ticket (§7) laat de 403-versus-404-vraag
 *  expliciet open — hem hier beantwoorden zou een gedragswijziging zijn in het
 *  ticket dat belooft er geen te maken. Bewust ook geen `errorResponse()`: die
 *  schrijft naar `app_errors`, en een afgewezen autorisatie is geen applicatie-
 *  fout maar een normale uitkomst. */
function geenRechten(): NextResponse {
  return NextResponse.json(
    { error: "U heeft geen rechten voor deze actie." },
    { status: 403 }
  );
}

/** Alleen het pad, nooit de querystring — die kan zoektermen dragen. Faalt de
 *  parse, dan is het log dat ene veld kwijt en niet het request. */
function padVan(request: NextRequest): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "<onbekend-pad>";
  }
}

export type HostGuardArgs = { sessieFondsId: string | null; gebruikerId?: string; label: string };
export type HostGuardOordeel = { toegestaan: boolean };

/** Injecteerbare afhankelijkheden — de echte set draait in productie, de
 *  sanity-suite geeft stubs door via {@link maakWithFondsRoute}. */
export type WrapperDeps = {
  createServerSupabase: typeof createServerSupabase;
  haalProfiel: typeof haalProfiel;
  beoordeelRouteHostToegang: (args: HostGuardArgs) => Promise<HostGuardOordeel>;
  /** Leest `ENFORCE_CAPABILITY`. Injecteerbaar zodat de sanity-suite BEIDE
   *  vlagstanden kan bewijzen zonder process.env te muteren — de vlag-aan-stand
   *  is de enige tak die gedrag verandert en mag niet op een omgevingsvariabele
   *  in een testrun leunen. */
  capabilityEnforceAan: () => boolean;
};

const echteDeps: WrapperDeps = {
  createServerSupabase,
  haalProfiel,
  capabilityEnforceAan,
  beoordeelRouteHostToegang: async (args) => {
    const mod = await import("@/core/lib/tenant-route-guard");
    return mod.beoordeelRouteHostToegang(args);
  },
};

/** Factory zodat de wrapper testbaar is zonder echte cookies/Supabase. De
 *  publieke {@link withFondsRoute} is deze factory met de echte deps. */
export function maakWithFondsRoute(deps: WrapperDeps) {
  return function withFondsRoute(spec: RouteSpecV1, handler: FondsHandler) {
    // Next genereert per route een strikte RouteContext-typecheck op de tweede
    // parameter; die verschilt tussen statische en [id]-routes. Eén wrapper dekt
    // beide, dus typen we de context bewust los en normaliseren hem intern.
    return async function (request: NextRequest, invocatie?: any): Promise<Response> {
      const requestId = crypto.randomUUID();

      // 1. Authenticatie.
      const supabase = await deps.createServerSupabase();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return nietIngelogd();

      // 2. Profielresolutie (vier kolommen).
      const profiel = await deps.haalProfiel(supabase, user.id);
      const fondsId = profiel?.fondsId ?? null;

      // 3. Host-guard — alleen waar de route hem nu al heeft.
      // LET OP: `=== true`, niet truthy. "route-eigen" is een string en dus
      // truthy; die route doet de guard zelf en mag hem hier NIET nog eens
      // krijgen — dat zou de ordening veranderen die de uitzondering juist
      // beschermt.
      if (spec.hostGuard === true) {
        const oordeel = await deps.beoordeelRouteHostToegang({
          sessieFondsId: fondsId,
          gebruikerId: user.id,
          label: spec.label ?? "withFondsRoute",
        });
        if (!oordeel.toegestaan) {
          return NextResponse.json(
            { error: "Dit webadres hoort niet bij uw fonds." },
            { status: 403 }
          );
        }
      }

      // 3b. Capability-poort (W6) — NA de host-guard, VÓÓR de handler.
      //
      // ORDENING (BESLUIT, W6): de host↔fonds-grens gaat voor. Die staat in
      // productie al fail-closed aan; de capability-poort niet. Zou de
      // capability-check ervóór komen, dan zou het flippen van
      // ENFORCE_CAPABILITY veranderen WELKE 403 een host-mismatch oplevert —
      // een gedragswijziging die niets met autorisatie te maken heeft.
      //
      // Onder de vlag UIT verandert er geen enkele responsebyte; er wordt
      // alleen geobserveerd. Dat is de hele belofte van W6.
      const capOordeel = beoordeelCapability({
        capability: spec.capability,
        rol: profiel?.rol ?? null,
      });
      if (!capOordeel.toegestaan) {
        const handhaven = deps.capabilityEnforceAan();
        // Proportioneel loggen, zoals [TENANT-RESOLVE]: alleen de zou-weigeringen.
        // De happy path blijft stil. Met 112 handlers op "TE_BEPALEN" is dat
        // vandaag nog élk request — en precies dat is de dataset waarmee W7
        // begint: route + rol + zou-beslissing, ook zonder productieverkeer.
        //
        // GEEN gebruikers-id en GEEN e-mail in deze regel: W7 heeft route, rol en
        // uitkomst nodig, meer niet. Het pad kan fixture-/resource-UUID's dragen
        // (geen persoonsgegeven); de hele ctx belandt hier bewust nooit in.
        console.warn("[CAPABILITY-OBSERVE]", {
          route: spec.label ?? padVan(request),
          methode: request.method,
          capability: spec.capability,
          rol: profiel?.rol ?? null,
          zouBeslissing: "weigeren",
          reden: capOordeel.reden,
          handhaven,
          requestId,
        });
        if (handhaven) return geenRechten();
      }

      // 4. Correlation ID leeft in ctx + logregels (v1: geen responseheader).
      const ctx: FondsContext = {
        gebruikerId: user.id,
        email: user.email,
        fondsId,
        rol: profiel?.rol ?? null,
        naam: profiel?.naam ?? null,
        supabase,
        requestId,
      };

      // Laatste vangnet: alleen wat de route zélf niet vangt. Dezelfde vorm als
      // de 87 bestaande blokken. De route behoudt zijn eigen try/catch.
      let params: unknown;
      try {
        params = invocatie?.params ? await invocatie.params : undefined;
        return await handler(ctx, request, params);
      } catch (e) {
        console.error(`[${requestId}] onafgevangen routefout:`, e);
        return NextResponse.json({ error: "Serverfout" }, { status: 500 });
      }
    };
  };
}

export const withFondsRoute = maakWithFondsRoute(echteDeps);
