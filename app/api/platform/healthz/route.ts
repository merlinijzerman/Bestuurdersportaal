// app/api/platform/healthz/route.ts
// -----------------------------------------------------------------------------
// Diagnostische healthcheck (P5, TO §9.2). Zeven componenten met status en
// responstijd.
//
// BEVEILIGING — architectuurpunt 4 van de werkopdracht.
// Deze route is NIET publiek. Een openbaar eindpunt dat Supabase-connectiviteit,
// storage-status en model-API-bereikbaarheid prijsgeeft, is een kaart van je
// infrastructuur voor een aanvaller: het vertelt precies welke afhankelijkheid
// wankelt en wanneer. De publieke tegenhanger is /api/healthz/ping, die
// uitsluitend {"ok":true} teruggeeft.
//
// Zelfde patroon als de aqlab-worker: DEPLOY_TARGET-guard vóór de auth, daarna
// een constant-time CRON_SECRET-bearer (platform/lib/cron-auth.ts).
//
// De snapshot-job roept draaiHealthchecks() rechtstreeks aan; deze route bestaat
// voor handmatige diagnose ("wat is er nu aan de hand") zonder in de SQL-editor
// te hoeven duiken.
// -----------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/platform/lib/supabase-service";
import { draaitOpAppSurface, geautoriseerdeCron } from "@/platform/lib/cron-auth";
import {
  aantalOnbekend,
  draaiHealthchecks,
  geenEnkeleRood,
} from "@/platform/lib/monitoring-health";
import { logPlatformFout } from "@/platform/lib/platform-fout-log";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function draai(req: NextRequest): Promise<NextResponse> {
  if (draaitOpAppSurface()) {
    return NextResponse.json({ ok: true, skipped: "deploy_target=app" });
  }
  if (!geautoriseerdeCron(req)) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }
  try {
    const svc = createServiceSupabase();
    const componenten = await draaiHealthchecks(svc);
    return NextResponse.json({
      // Zelfde definitie als signaal 7: beschikbaar = geen enkele component rood.
      // "Onbekend" telt niet als storing, maar wordt wel apart gerapporteerd.
      ok: geenEnkeleRood(componenten),
      onbekend: aantalOnbekend(componenten),
      tijdstip: new Date().toISOString(),
      componenten,
    });
  } catch (error) {
    // BEWUST GEEN errorResponse(): die schrijft via het TENANT-pad naar
    // fn_app_error_log, en die RPC leunt op een sessie. Deze route draait op
    // CRON_SECRET zónder sessie, dus zou de fout als `anon` worden aangeboden —
    // en anon heeft daar geen EXECUTE (gate H). Een falende healthcheck zou dan
    // nergens landen, terwijl dat juist de diagnostiek onder het uptime-signaal
    // is. Zelfde keuze als de snapshot-route.
    await logPlatformFout({
      label: "platform.healthz",
      error,
      categorie: "externe_afhankelijkheid",
      severity: "hoog",
    });
    return NextResponse.json(
      { error: "Healthcheck mislukt. Zie app_errors." },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return draai(req);
}
export async function POST(req: NextRequest) {
  return draai(req);
}
