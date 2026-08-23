// app/api/platform/monitoring/snapshot/route.ts
// -----------------------------------------------------------------------------
// Snapshot-cron (P5). Draait de signaalcatalogus en schrijft platform_signal_snapshots.
//
// BEVEILIGING + PROJECTKEUZE — zelfde patroon als app/api/aqlab/worker/route.ts:
// eerst de DEPLOY_TARGET-guard (de cron in vercel.json vuurt in BEIDE Vercel-
// projecten sinds variant C), daarna een constant-time CRON_SECRET-bearer.
//
// CADANS — de cron draait elke 5 minuten, maar elk signaal heeft zijn eigen
// interval in platform_signaal_config. Per run wordt alleen gemeten wat "aan de
// beurt" is: de nieuwste snapshot ouder dan het interval. Dat is stateloos en
// zelfherstellend — na een uur stilstand haalt de eerstvolgende run alles in,
// zonder dat we ergens hoeven bij te houden wanneer we voor het laatst draaiden.
//
// FOUTISOLATIE — elk signaal wordt apart afgehandeld. Een kapotte meting levert
// een rij met status 'onbekend' en een reden, en sleept de andere zeven niet
// mee. Zonder die isolatie zou één schemawijziging de hele monitoring blinderen,
// en dat is precies de faalvorm die deze tranche moet uitsluiten.
//
// RETENTIE — aan het eind wordt opgeschoond volgens besluit 0104 (app_errors 90
// dagen, snapshots 180 dagen). Een gewone DELETE met de service-role die hier al
// is: GEEN nieuwe SECURITY DEFINER-functie (dus geen extra gate E/H-oppervlak)
// en GEEN TRUNCATE-recht — TRUNCATE valt buiten RLS en hoort nergens thuis.
// -----------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { withMachineRoute, type MachineContext } from "@/platform/lib/machine-route-wrapper";
import { createServiceSupabase } from "@/platform/lib/supabase-service";
import { logPlatformFout } from "@/platform/lib/platform-fout-log";
import { meetSignaal, type Meting } from "@/platform/lib/monitoring-queries";
import {
  SIGNAAL_REGISTRY,
  SIGNAAL_VOLGORDE,
  bepaalStatus,
  combineerConfig,
  isOnderdruktDoorNDrempel,
  moetDraaien,
  type ConfigRij,
  type SignaalConfig,
  type SignaalId,
} from "@/platform/lib/monitoring-signalen";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Bewaartermijnen — besluit 0104. */
const RETENTIE_DAGEN = {
  app_errors: 90,
  platform_signal_snapshots: 180,
} as const;

type SnapshotRij = {
  signaal: SignaalId;
  fonds_id: string | null;
  waarde: number | null;
  n: number | null;
  status: "groen" | "oranje" | "rood" | "onbekend";
  drempel_oranje: number | null;
  drempel_rood: number | null;
  meta: Record<string, unknown> | null;
};

async function draai(_ctx: MachineContext, _req: NextRequest): Promise<NextResponse> {

  const nu = new Date();
  const svc = createServiceSupabase();

  try {
    const configs = await laadConfiguratie(svc);
    const fondsIds = await laadActieveFondsen(svc);
    const laatste = await laadLaatsteSnapshots(svc);

    const rijen: SnapshotRij[] = [];
    const gemeten: SignaalId[] = [];
    const overgeslagen: SignaalId[] = [];
    const mislukt: SignaalId[] = [];

    for (const signaal of SIGNAAL_VOLGORDE) {
      const config = configs[signaal];
      if (!moetDraaien(laatste.get(signaal) ?? null, config, nu)) {
        overgeslagen.push(signaal);
        continue;
      }

      try {
        const metingen = await meetSignaal(signaal, { svc, config, fondsIds, nu });
        rijen.push(...naarRijen(signaal, config, metingen));
        gemeten.push(signaal);
      } catch (error) {
        // Foutisolatie: schrijf een expliciet 'onbekend' in plaats van niets.
        // Niets schrijven zou als veroudering lezen — en dan weet je wél dat er
        // iets mis is, maar niet dat het aan de MEETQUERY ligt.
        mislukt.push(signaal);
        rijen.push({
          signaal,
          fonds_id: null,
          waarde: null,
          n: null,
          status: "onbekend",
          drempel_oranje: config.drempelOranje,
          drempel_rood: config.drempelRood,
          meta: { fout: "berekening mislukt" },
        });
        await logPlatformFout({
          label: `monitoring.snapshot.${signaal}`,
          error,
          categorie: "database_integriteit",
          severity: "middel",
          context: { signaal },
        });
      }
    }

    if (rijen.length > 0) {
      const { error } = await svc.from("platform_signal_snapshots").insert(rijen);
      if (error) throw error;
    }

    const opgeschoond = await schoonOp(svc, nu);

    return NextResponse.json({
      ok: true,
      tijdstip: nu.toISOString(),
      gemeten,
      overgeslagen,
      mislukt,
      rijen: rijen.length,
      opgeschoond,
    });
  } catch (error) {
    await logPlatformFout({
      label: "monitoring.snapshot",
      error,
      categorie: "database_integriteit",
      severity: "hoog",
    });
    // Bewust geen errorResponse(): die schrijft nóg een foutregel via het
    // tenant-pad, en die RPC werkt hier niet (geen sessie). Eén regel volstaat.
    return NextResponse.json(
      { error: "Snapshot-run mislukt. Zie app_errors." },
      { status: 500 }
    );
  }
}

// ── Opbouw van de snapshotrijen ─────────────────────────────────────────────

function naarRijen(
  signaal: SignaalId,
  config: SignaalConfig,
  metingen: Meting[]
): SnapshotRij[] {
  return metingen.map((m) => {
    const onderdrukt = isOnderdruktDoorNDrempel(m.n, config);
    const status = m.afgekapt ? "onbekend" : bepaalStatus(m.waarde, m.n, config);

    // Onder de n-drempel wordt de waarde NIET weggeschreven, niet alleen niet
    // getoond. Anders staat het onderdrukte getal 180 dagen in de database en is
    // de suppressie een weergavetruc in plaats van dataminimalisatie (0055).
    // Bij een afgekapte leesquery idem: een getal uit een halve dataset is
    // misleidender dan geen getal.
    const bewaarWaarde = onderdrukt || m.afgekapt ? null : m.waarde;

    return {
      signaal,
      fonds_id: m.fondsId,
      waarde: bewaarWaarde === null ? null : afronden(bewaarWaarde, config.eenheid),
      // `n` blijft wél staan: dat is nodig om de suppressie te kunnen
      // verantwoorden en om te zien wanneer een signaal weer meetbaar wordt.
      n: m.n,
      status,
      // De toegepaste drempels worden MEEGESTEMPELD: zonder dat is historie niet
      // interpreteerbaar zodra iemand een drempel bijstelt.
      drempel_oranje: config.drempelOranje,
      drempel_rood: config.drempelRood,
      meta: m.afgekapt
        ? { ...(m.meta ?? {}), afgekapt: true, reden: "leeslimiet bereikt" }
        : m.meta ?? null,
    };
  });
}

function afronden(waarde: number, eenheid: SignaalConfig["eenheid"]): number {
  if (eenheid === "aantal" || eenheid === "milliseconden") return Math.round(waarde);
  return Math.round(waarde * 100) / 100;
}

// ── Laden ───────────────────────────────────────────────────────────────────

/**
 * Configuratie uit de database, met de code-registry als fallback. Een
 * onbereikbare of onvolledige configtabel mag de meting niet blokkeren — dan
 * draait hij op de geseede standaardwaarden en dat is precies goed.
 */
async function laadConfiguratie(
  svc: SupabaseClient
): Promise<Record<SignaalId, SignaalConfig>> {
  let rijen: ConfigRij[] = [];
  try {
    const { data, error } = await svc.from("platform_signaal_config").select("*");
    if (!error) rijen = (data ?? []) as ConfigRij[];
  } catch {
    // Val terug op de registry.
  }

  const perSignaal = new Map(rijen.map((r) => [r.signaal, r]));
  const uit = {} as Record<SignaalId, SignaalConfig>;
  for (const signaal of Object.keys(SIGNAAL_REGISTRY) as SignaalId[]) {
    uit[signaal] = combineerConfig(signaal, perSignaal.get(signaal) ?? null);
  }
  return uit;
}

/** Bepaalt voor welke groepen een meting wordt geproduceerd (bronneutraal, ook bij één fonds). */
async function laadActieveFondsen(svc: SupabaseClient): Promise<string[]> {
  const { data, error } = await svc.from("fondsen").select("id");
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
}

/** Nieuwste snapshottijdstip per signaal — de basis voor moetDraaien en voor de veroudering. */
async function laadLaatsteSnapshots(svc: SupabaseClient): Promise<Map<string, string>> {
  const laatste = new Map<string, string>();
  const { data, error } = await svc
    .from("platform_signal_snapshots")
    .select("signaal, tijdstip")
    .order("tijdstip", { ascending: false })
    .limit(2000);
  if (error) throw error;

  for (const rij of (data ?? []) as Array<{ signaal: string; tijdstip: string }>) {
    if (!laatste.has(rij.signaal)) laatste.set(rij.signaal, rij.tijdstip);
  }
  return laatste;
}

// ── Retentie (besluit 0104) ─────────────────────────────────────────────────

async function schoonOp(
  svc: SupabaseClient,
  nu: Date
): Promise<Record<string, string>> {
  const uitkomst: Record<string, string> = {};

  for (const [tabel, dagen] of Object.entries(RETENTIE_DAGEN)) {
    const grens = new Date(nu.getTime() - dagen * 24 * 60 * 60_000).toISOString();
    try {
      const { error } = await svc.from(tabel).delete().lt("tijdstip", grens);
      uitkomst[tabel] = error ? "mislukt" : `ouder dan ${dagen}d verwijderd`;
    } catch {
      uitkomst[tabel] = "mislukt";
    }
  }
  return uitkomst;
}

// De DEPLOY_TARGET-skip en de constant-time CRON_SECRET-bearer staan sinds W5b
// in platform/lib/machine-route-wrapper.ts, niet meer in dit bestand. Zelfde
// controle, zelfde volgorde, zelfde responses — alleen op één plek.
const SPEC = { bewaking: "cron-secret", label: "platform.monitoring.snapshot" } as const;

// Vercel Cron gebruikt GET; POST voor handmatige/lokale triggers.
export const GET = withMachineRoute(SPEC, draai);
export const POST = withMachineRoute(SPEC, draai);
