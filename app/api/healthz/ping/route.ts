// app/api/healthz/ping/route.ts
// -----------------------------------------------------------------------------
// Liveness-probe (P5). Publiek bereikbaar en OPZETTELIJK NIETSZEGGEND.
//
// WAAROM PUBLIEK
// Sinds variant C draaien de tenant-app en de beheer-back-office als twee
// aparte Vercel-projecten. De snapshot-job draait alleen in beheer en kan de
// beschikbaarheid van het andere project dus niet van binnenuit meten — daar is
// een van buiten aanroepbaar eindpunt voor nodig. Dit is dat eindpunt.
//
// WAAROM DIT NIETS VERRAADT
// De route raakt geen database, leest geen env, kent geen versienummer en doet
// geen enkele component-check. Het antwoord is altijd exact `{"ok":true}`. Het
// bevestigt dus alleen dat de deployment HTTP beantwoordt — precies wat de
// loginpagina ook al doet. De ECHTE diagnostiek (Supabase, storage, model-API,
// pipelinegezondheid) zit achter CRON_SECRET in /api/platform/healthz; een
// publieke healthcheck die dát zou lekken is een informatiebron voor een
// aanvaller (architectuurpunt 4 van de werkopdracht).
//
// Deze route deployt in BEIDE projecten. Dat is de bedoeling: beheer pingt
// hiermee de app-host, en de app-host heeft er zelf geen last van.
// -----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { withMachineRoute } from "@/platform/lib/machine-route-wrapper";

export const dynamic = "force-dynamic";

// `bewaking: "publiek"` is een WAARDE, geen weglating. Deze route hoort als
// enige machineroute geen controle te hebben — zie de kop hierboven. Door hem
// toch door de wrapper te halen staat die keuze in de code in plaats van in de
// afwezigheid ervan, en kan een latere gate hem onderscheiden van een route
// waar iemand de bewaking gewoon vergat.
const SPEC = { rateLimit: "geen", audit: "geen", bewaking: "publiek", label: "healthz.ping", directeMutaties: [], schema: "geen-body" } as const;

export const GET = withMachineRoute(SPEC, async () => NextResponse.json({ ok: true }));
