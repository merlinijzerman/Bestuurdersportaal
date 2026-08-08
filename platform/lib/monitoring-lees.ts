// ============================================================================
//  monitoring-lees.ts — leeslaag voor het monitoringdashboard (P4-light)
// ----------------------------------------------------------------------------
//  De SupabaseClient wordt INGESPOTEN, niet hier gemaakt: zo werkt dezelfde
//  functie binnen de callback van withPlatformRead, en kan de leeskant nooit
//  buiten de capability- en auditwrapper om draaien (les H-15). Patroon van
//  platform/lib/aqlab/dashboard-lees.ts.
//
//  Leest uitsluitend AGGREGATEN uit platform_signal_snapshots. Geen enkele query
//  raakt fondsinhoud, gesprekken of gebruikers.
// ============================================================================

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SIGNAAL_REGISTRY,
  SIGNAAL_VOLGORDE,
  clientVeiligeWaarde,
  combineerConfig,
  dunTrendUit,
  isOnderdruktDoorNDrempel,
  isSignaalId,
  maskeerTrendwaarde,
  statusVoorWeergave,
  type ConfigRij,
  type SignaalConfig,
  type SignaalId,
  type SignaalStatus,
} from "@/platform/lib/monitoring-signalen";

/** Eén punt in de trendlijn. */
export type TrendPunt = { tijdstip: string; waarde: number | null };

/** Wat het dashboard per signaal per fonds toont. */
export type SignaalWeergave = {
  signaal: SignaalId;
  config: SignaalConfig;
  fondsId: string | null;
  fondsNaam: string | null;
  waarde: number | null;
  n: number | null;
  /** Status ná verouderingscorrectie — dit is wat de gebruiker ziet. */
  status: SignaalStatus;
  /** Status zoals opgeslagen bij de meting; verschilt bij veroudering. */
  statusBijMeting: SignaalStatus;
  laatsteMeting: string | null;
  verouderd: boolean;
  onderdrukt: boolean;
  drempelOranje: number | null;
  drempelRood: number | null;
  meta: Record<string, unknown> | null;
  trend: TrendPunt[];
};

export type MonitoringOverzicht = {
  signalen: SignaalWeergave[];
  /** Nieuwste snapshot over alle signalen — de "leeft de monitor nog"-regel. */
  laatsteSnapshot: string | null;
  /** Aantal gelezen snapshotrijen; gaat als `effect` mee het auditspoor in. */
  gelezenRijen: number;
  /**
   * True als de snapshotquery NIET kon worden gelezen. Cruciaal onderscheid: zonder
   * dit zou een leesfout zich voordoen als "er is nog nooit gemeten", en dat is een
   * verkeerde diagnose met veel te veel stelligheid gebracht.
   */
  leesfout: boolean;
  /** True als de trend is afgekapt op de leeslimiet; de grafiek dekt dan minder dagen. */
  trendAfgekapt: boolean;
  /**
   * Hoeveel dagen de trend WERKELIJK dekt (nieuwste − oudste gelezen rij), naar
   * boven afgerond. Bij een afgekapte query is dit minder dan de gevraagde
   * periode; het dashboard toont dít getal in plaats van de belofte (blok D3).
   */
  gedekteDagen: number;
};

/** Hoeveel dagen trend het dashboard maximaal toont (de langste periodekeuze). */
const TREND_DAGEN = 7;
/**
 * Bovengrens op de leesquery. Ruim gekozen zodat een week aan snapshots over
 * meerdere fondsen niet stil wordt afgekapt: uptime schrijft 288 rijen/dag, elk
 * fonds ± 456 (vier kwartier- en drie uursignalen), dus 7 dagen bij vier fondsen
 * ≈ 14.800 rijen. Dit is een SERVER-side leescap; de payload naar de client wordt
 * NIET hierdoor bepaald maar door de uurlijkse uitdunning (`dunTrendUit`). Wordt
 * dit krap, dan is een SQL-view de volgende stap — niet een nóg hogere limiet.
 */
const LEESLIMIET = 20000;

/**
 * Haalt het volledige overzicht op: laatste stand + trend per signaal per fonds.
 *
 * `nu` is een parameter zodat de verouderingslogica testbaar en reproduceerbaar
 * blijft en niet stiekem van de systeemklok afhangt.
 */
export async function haalMonitoringOverzicht(
  svc: SupabaseClient,
  nu: Date = new Date()
): Promise<MonitoringOverzicht> {
  const sinds = new Date(nu.getTime() - TREND_DAGEN * 24 * 60 * 60_000).toISOString();

  const [configRes, snapshotRes, fondsRes] = await Promise.all([
    svc.from("platform_signaal_config").select("*"),
    svc
      .from("platform_signal_snapshots")
      .select("signaal, fonds_id, tijdstip, waarde, n, status, drempel_oranje, drempel_rood, meta")
      .gte("tijdstip", sinds)
      .order("tijdstip", { ascending: false })
      .limit(LEESLIMIET),
    svc.from("fondsen").select("id, naam"),
  ]);

  const configs = bouwConfigs(configRes.error ? [] : ((configRes.data ?? []) as ConfigRij[]));
  const fondsNamen = new Map<string, string>(
    fondsRes.error
      ? []
      : ((fondsRes.data ?? []) as Array<{ id: string; naam: string | null }>).map((f) => [
          f.id,
          f.naam ?? "Onbekend fonds",
        ])
  );

  type Rij = {
    signaal: string;
    fonds_id: string | null;
    tijdstip: string;
    waarde: number | string | null;
    n: number | null;
    status: string;
    drempel_oranje: number | string | null;
    drempel_rood: number | string | null;
    meta: Record<string, unknown> | null;
  };
  const leesfout = !!snapshotRes.error;
  const ruweRijen = leesfout ? [] : ((snapshotRes.data ?? []) as Rij[]);
  // Stille afkapping is precies wat de meetlaag weigert; de leeslaag hoort dat
  // niet alsnog te doen. Raakt de query de (ruime) leescap tóch, dan is de trend
  // afgekapt en dekt hij minder dan de gevraagde periode — het dashboard toont
  // dan `gedekteDagen` in plaats van de belofte, en deze vlag blijft de melding
  // aansturen.
  const trendAfgekapt = ruweRijen.length >= LEESLIMIET;
  const rijen = ruweRijen.filter((r) => isSignaalId(r.signaal));

  // Aflopend op tijdstip binnen elkaar: de eerste rij per (signaal, fonds) is de
  // meest recente meting; de rest vormt de trend.
  const perGroep = new Map<string, Rij[]>();
  for (const rij of rijen) {
    const sleutel = `${rij.signaal}::${rij.fonds_id ?? ""}`;
    const lijst = perGroep.get(sleutel) ?? [];
    lijst.push(rij);
    perGroep.set(sleutel, lijst);
  }

  const signalen: SignaalWeergave[] = [];
  for (const signaal of SIGNAAL_VOLGORDE) {
    const config = configs[signaal];
    if (!config.actief) continue;

    const groepen = [...perGroep.entries()].filter(([sleutel]) =>
      sleutel.startsWith(`${signaal}::`)
    );

    if (groepen.length === 0) {
      // Nooit gemeten: toch tonen, met status onbekend. Een signaal dat van het
      // dashboard verdwijnt omdat er geen data is, is precies de blinde vlek die
      // deze tranche moet uitsluiten.
      signalen.push(leegSignaal(signaal, config));
      continue;
    }

    for (const [, groepRijen] of groepen) {
      const laatst = groepRijen[0];
      if (!laatst) continue;
      const statusBijMeting = naarStatus(laatst.status);
      const status = statusVoorWeergave(statusBijMeting, laatst.tijdstip, config, nu);
      const onderdrukt = isOnderdruktDoorNDrempel(laatst.n, config);

      // CLIENT-VEILIGHEID. De tabel is een client component; een onderdrukte
      // waarde mag de payload dus niet in. Zonder deze maskering zou de ruwe
      // waarde meegeserialiseerd worden ook al toont het scherm "onderdrukt".
      // Dezelfde belofte als bij de trend (maskeerTrendwaarde), nu op de laatste
      // stand — suppressie toepassen vóórdat de data de client bereikt
      // (core/lib/suppressie.ts schrijft dit patroon voor). Via een pure functie
      // zodat de invariant "onderdrukt ⇒ waarde null" in de sanity vastligt.
      const waarde = clientVeiligeWaarde(naarGetal(laatst.waarde), onderdrukt);

      // Oplopend voor de grafiek (de query gaf aflopend), per punt gemaskeerd, en
      // dan uitgedund tot ≤1 punt/uur. SUPPRESSIE HOORT HIER, NIET IN DE FORMATTER:
      // de trendlijn krijgt álle historische punten en het aria-label spreekt de
      // waarde letterlijk uit — een punt met n<10 mag daar niet in belanden. De
      // uitdunning begrenst de client-payload zonder de laatste stand te raken
      // (die komt uit `laatst`, niet uit deze reeks).
      const trend = dunTrendUit(
        [...groepRijen].reverse().map((r) => ({
          tijdstip: r.tijdstip,
          waarde: maskeerTrendwaarde(naarGetal(r.waarde), r.n, config),
        }))
      );

      signalen.push({
        signaal,
        config,
        fondsId: laatst.fonds_id,
        fondsNaam: laatst.fonds_id ? fondsNamen.get(laatst.fonds_id) ?? null : null,
        waarde,
        n: laatst.n,
        status,
        statusBijMeting,
        laatsteMeting: laatst.tijdstip,
        verouderd: status !== statusBijMeting,
        onderdrukt,
        drempelOranje: naarGetal(laatst.drempel_oranje),
        drempelRood: naarGetal(laatst.drempel_rood),
        meta: laatst.meta,
        trend,
      });
    }
  }

  const laatsteSnapshot = rijen.length > 0 ? rijen[0]?.tijdstip ?? null : null;

  // Werkelijk gedekte periode: nieuwste − oudste gelezen rij. Bij afkapping is dit
  // minder dan TREND_DAGEN; het dashboard toont dít getal, niet de belofte.
  let gedekteDagen = 0;
  if (rijen.length > 0) {
    const nieuwste = new Date(rijen[0]!.tijdstip).getTime();
    const oudste = new Date(rijen[rijen.length - 1]!.tijdstip).getTime();
    if (Number.isFinite(nieuwste) && Number.isFinite(oudste)) {
      gedekteDagen = Math.max(1, Math.ceil((nieuwste - oudste) / (24 * 60 * 60_000)));
    }
  }

  return {
    signalen,
    laatsteSnapshot,
    gelezenRijen: rijen.length,
    leesfout,
    trendAfgekapt,
    gedekteDagen,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function bouwConfigs(rijen: ConfigRij[]): Record<SignaalId, SignaalConfig> {
  const perSignaal = new Map(rijen.map((r) => [r.signaal, r]));
  const uit = {} as Record<SignaalId, SignaalConfig>;
  for (const signaal of Object.keys(SIGNAAL_REGISTRY) as SignaalId[]) {
    uit[signaal] = combineerConfig(signaal, perSignaal.get(signaal) ?? null);
  }
  return uit;
}

function leegSignaal(signaal: SignaalId, config: SignaalConfig): SignaalWeergave {
  return {
    signaal,
    config,
    fondsId: null,
    fondsNaam: null,
    waarde: null,
    n: null,
    status: "onbekend",
    statusBijMeting: "onbekend",
    laatsteMeting: null,
    verouderd: true,
    onderdrukt: false,
    drempelOranje: config.drempelOranje,
    drempelRood: config.drempelRood,
    meta: null,
    trend: [],
  };
}

/** numeric komt uit PostgREST soms als string terug. */
function naarGetal(waarde: number | string | null): number | null {
  if (waarde === null) return null;
  const n = typeof waarde === "number" ? waarde : Number(waarde);
  return Number.isFinite(n) ? n : null;
}

function naarStatus(waarde: string): SignaalStatus {
  return waarde === "groen" || waarde === "oranje" || waarde === "rood"
    ? waarde
    : "onbekend";
}
