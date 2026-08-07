// ============================================================================
//  monitoring-queries.ts — de acht signaalmetingen (P5, FO §19)
// ----------------------------------------------------------------------------
//  Eén functie per signaal. Elke functie geeft een lijst METINGEN terug, en elke
//  meting draagt een `fondsId`.
//
//  ── BRONNEUTRAAL: ALTIJD PER FONDS GROEPEREN ───────────────────────────────
//  Ook nu er één fonds is. Er wordt een meting geproduceerd voor ELK actief
//  fonds, ook als dat fonds nul waarnemingen heeft — anders bewijst de
//  implementatie de groepering niet en is "het werkt met N fondsen" een aanname.
//  Alleen `uptime_kern` is platformbreed en levert één rij met fondsId = null.
//  Zie TO §9 en FO §20.1: dit is precies de rework die daar wordt uitgesloten.
//
//  ── WAAROM GEEN JOINS EN GEEN GROUP BY IN SQL ──────────────────────────────
//  PostgREST kent geen GROUP BY, en `document_processing_jobs` heeft TWEE
//  foreign keys naar `documenten` (document_id én versie_id) — een embed daarop
//  is dubbelzinnig en moet met een hint worden ontward. Twee eenvoudige queries
//  plus aggregatie in TypeScript is bij MVP-volume zowel sneller te begrijpen
//  als robuuster. De leesvensters zijn begrensd (LEESLIMIET); wordt dat krap,
//  dan is een SQL-view de volgende stap — niet een grotere limiet.
//
//  ── WAT ER NOOIT UITKOMT ───────────────────────────────────────────────────
//  Uitsluitend aggregaten: tellingen, ratio's, percentielen. Geen vraagteksten,
//  geen documenttitels, geen gebruikers-id's. `meta` draagt hooguit tellingen en
//  componentstatussen.
// ============================================================================

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  aantalOnbekend,
  draaiHealthchecks,
  geenEnkeleRood,
  type ComponentUitkomst,
} from "@/platform/lib/monitoring-health";
import {
  p95,
  trendPercentage,
  type SignaalConfig,
  type SignaalId,
} from "@/platform/lib/monitoring-signalen";

/** Eén gemeten punt voor één signaal, voor één fonds (of platformbreed). */
export type Meting = {
  fondsId: string | null;
  waarde: number | null;
  n: number | null;
  meta?: Record<string, unknown> | null;
  /**
   * True als de onderliggende leesquery de LEESLIMIET raakte. De snapshot-route
   * schrijft die meting dan als `onbekend` in plaats van als getal: een stil
   * afgekapte monitoringquery is erger dan een ontbrekende meting, want hij
   * levert een stoplicht dat nergens op slaat.
   */
  afgekapt?: boolean;
};

/**
 * Harde bovengrens per leesquery. Bewust laag: bij MVP-volume ruim voldoende, en
 * een stille truncatie op een monitoringquery is erger dan een te lage waarde —
 * daarom rapporteert de snapshot-route het als de limiet daadwerkelijk bijt.
 */
export const LEESLIMIET = 5000;

/** Een attempt zonder result mag zo lang "onderweg" zijn voordat hij meetelt. */
const AUDIT_GRACE_MINUTEN = 5;

/**
 * Minimaal aantal dagen basisperiode voordat signaal 6 een trend uitspreekt.
 * Daaronder is er geen zinvolle vergelijkingsbasis en geeft de meting null →
 * status onbekend, in plaats van een opgeblazen percentage.
 */
const MIN_BASISDAGEN = 7;

export type MetingContext = {
  svc: SupabaseClient;
  config: SignaalConfig;
  /** Id's van alle actieve fondsen — bepaalt voor welke groepen een rij komt. */
  fondsIds: string[];
  nu: Date;
};

/** Dispatch. Werpt door: de aanroeper vangt per signaal, zodat één kapotte meting de rest niet meesleept. */
export async function meetSignaal(
  signaal: SignaalId,
  ctx: MetingContext
): Promise<Meting[]> {
  switch (signaal) {
    case "uptime_kern":
      return meetUptime(ctx);
    case "embedding_indexering_fouten":
      return meetEmbeddingFouten(ctx);
    case "extractie_achterstand":
      return meetExtractieAchterstand(ctx);
    case "rate_limit_incidenten":
      return meetRateLimitIncidenten(ctx);
    case "audit_volledigheid":
      return meetAuditVolledigheid(ctx);
    case "ai_latency_p95":
      return meetLatency(ctx);
    case "lege_antwoord_ratio":
      return meetLegeAntwoordRatio(ctx);
    case "tokenverbruik":
      return meetTokenverbruik(ctx);
  }
}

// ── Signaal 7 — Uptime kernfunctionaliteit (platformbreed) ──────────────────
//  De healthcheck van NU is één waarneming; het percentage komt uit de eigen
//  snapshothistorie. Elke snapshotrij draagt daarom `meta.alle_groen`, zodat de
//  volgende run de reeks kan verlengen zonder een aparte tabel.
async function meetUptime(ctx: MetingContext): Promise<Meting[]> {
  const componenten: ComponentUitkomst[] = await draaiHealthchecks(ctx.svc);
  const nuBeschikbaar = geenEnkeleRood(componenten);

  const { data, error } = await ctx.svc
    .from("platform_signal_snapshots")
    .select("meta")
    .eq("signaal", "uptime_kern")
    .gte("tijdstip", sindsIso(ctx))
    .order("tijdstip", { ascending: false })
    .limit(LEESLIMIET);
  if (error) throw error;

  const historie = (data ?? [])
    .map((r) => (r as { meta: Record<string, unknown> | null }).meta)
    .filter((m): m is Record<string, unknown> => !!m && typeof m.beschikbaar === "boolean");

  const totaal = historie.length + 1;
  const goed =
    historie.filter((m) => m.beschikbaar === true).length + (nuBeschikbaar ? 1 : 0);

  // De noemer is het aantal WAARGENOMEN runs, niet het aantal verwachte. Anders
  // zou een verse deployment met drie metingen op 1% uptime staan. Het gat
  // tussen verwacht en waargenomen gaat daarom als aggregaat mee: dat is waar je
  // een stilgevallen cron aan ziet. Het stoplicht zelf wordt bij stilstand al
  // grijs via de verouderingscontrole (isVerouderd).
  const verwachteRuns =
    ctx.config.vensterMinuten > 0
      ? Math.round(ctx.config.vensterMinuten / ctx.config.intervalMinuten)
      : null;

  return [
    {
      fondsId: null,
      waarde: (goed / totaal) * 100,
      n: totaal,
      meta: {
        beschikbaar: nuBeschikbaar,
        componenten_onbekend: aantalOnbekend(componenten),
        waargenomen_runs: totaal,
        verwachte_runs: verwachteRuns,
        definitie: "beschikbaar = geen enkele component rood; onbekend telt niet als storing",
        // Alleen status en responstijd per component — geen foutmeldingen van derden.
        componenten: componenten.map((c) => ({
          component: c.component,
          status: c.status,
          responstijd_ms: c.responstijd_ms,
          reden: c.reden,
        })),
      },
    },
  ];
}

// ── Signaal 1 — Embedding-/indexeringsfouten ────────────────────────────────
async function meetEmbeddingFouten(ctx: MetingContext): Promise<Meting[]> {
  // Ingest-faalratio: van de jobs die in het venster TERMINAAL werden, welk
  // aandeel is 'mislukt'. Bewust GÉÉN stap-filter: sinds F4/F6 draagt één job de
  // hele keten (extractie→embedding) en blijft `stap` op de instapfase staan. Een
  // embedding-fout op een extractie-entry-job zou met een stap-filter onzichtbaar
  // blijven — precies de blinde monitor die FO §18.2 uitsluit. Venster op `eind`
  // (wanneer de job klaar was), niet op instroom. Noemer = geslaagd + mislukt;
  // 'overgeslagen' (gedeactiveerd) en 'geweigerd' (bewuste cap/OCR-weigering) zijn
  // geen fouten en blijven er dus buiten.
  const jobs = await leesJobs(ctx.svc, {
    statussen: ["geslaagd", "mislukt"],
    sinds: sindsIso(ctx),
    sindsVeld: "eind",
  });
  const fondsPerDocument = await fondsVoorDocumenten(
    ctx.svc,
    jobs.map((j) => j.document_id)
  );

  const teller = nieuweTeller(ctx.fondsIds);
  for (const job of jobs) {
    const fondsId = fondsPerDocument.get(job.document_id) ?? null;
    const bak = pak(teller, fondsId);
    bak.totaal += 1;
    if (job.status === "mislukt") bak.raak += 1;
  }

  return alsRatio(teller);
}

// ── Signaal 2 — Ingest-achterstand (momentopname) ───────────────────────────
async function meetExtractieAchterstand(ctx: MetingContext): Promise<Meting[]> {
  // Openstaande ingest-jobs (wachtend|bezig) = de achterstand op dit moment.
  // Geen stap-filter: in het single-job-model heeft een document dat nog niet
  // klaar is precies één open job, ongeacht of het in de extractie- of de
  // embedding-fase zit. Zo telt de achterstand elk vastzittend/wachtend document.
  const jobs = await leesJobs(ctx.svc, {
    statussen: ["wachtend", "bezig"],
  });
  const fondsPerDocument = await fondsVoorDocumenten(
    ctx.svc,
    jobs.map((j) => j.document_id)
  );

  const teller = nieuweTeller(ctx.fondsIds);
  for (const job of jobs) {
    pak(teller, fondsPerDocument.get(job.document_id) ?? null).raak += 1;
  }

  return alsAantal(teller);
}

// ── Signaal 5 — Rate-limit-incidenten ───────────────────────────────────────
//  Bron is app_errors, NIET rate_limit_events: fn_rate_limit_check verwijdert
//  verlopen rijen bij elke check, dus daar valt niets historisch te tellen.
async function meetRateLimitIncidenten(ctx: MetingContext): Promise<Meting[]> {
  const { data, error } = await ctx.svc
    .from("app_errors")
    .select("fonds_id, severity, http_status")
    .eq("categorie", "rate_limiting")
    .gte("tijdstip", sindsIso(ctx))
    .order("tijdstip", { ascending: false })
    .limit(LEESLIMIET);
  if (error) throw error;

  const rijen = (data ?? []) as Array<{
    fonds_id: string | null;
    severity: string | null;
    http_status: number | null;
  }>;
  const afgekapt = rijen.length >= LEESLIMIET;

  const teller = nieuweTeller(ctx.fondsIds);
  // Twee soorten gebeurtenissen, en ze betekenen het TEGENOVERGESTELDE:
  //   * een 429 = de rem werkte (severity laag);
  //   * een mislukte limietcheck = de rem viel weg (severity hoog, fail-open).
  // Met drempels van 20/40 per dag domineren de 429's, en zouden drie fail-opens
  // — het enige echt alarmerende geval — in de ruis verdwijnen. Ze worden daarom
  // apart geteld en in `meta` zichtbaar gemaakt.
  const faalOpen = new Map<string | null, number>();
  for (const rij of rijen) {
    pak(teller, rij.fonds_id).raak += 1;
    if (rij.severity === "hoog") {
      faalOpen.set(rij.fonds_id, (faalOpen.get(rij.fonds_id) ?? 0) + 1);
    }
  }

  return alsAantal(teller, afgekapt).map((m) => ({
    ...m,
    meta: {
      limietchecks_mislukt: faalOpen.get(m.fondsId) ?? 0,
      toelichting:
        "Waarde telt alle rate-limit-gebeurtenissen. limietchecks_mislukt is de deelverzameling waarin de rem zelf uitviel (fail-open) — dat is de ernstige variant.",
    },
  }));
}

// ── Signaal 14 — Audit-volledigheid (attempt zonder result) ─────────────────
//  withPlatformRead schrijft bewust GEEN attempt-event, dus leespaden kunnen dit
//  signaal niet vervuilen; alleen schrijfpaden (withPlatform) tellen mee.
//  Privacyklasse hoog: uitsluitend het AANTAL, nooit de correlatie-id's of de
//  identiteiten. Doorklik hoort bij P6 (platform.logs.read).
async function meetAuditVolledigheid(ctx: MetingContext): Promise<Meting[]> {
  const sinds = sindsIso(ctx);
  const uiterlijk = new Date(
    ctx.nu.getTime() - AUDIT_GRACE_MINUTEN * 60_000
  ).toISOString();

  // .order() is hier niet cosmetisch: zonder expliciete volgorde garandeert
  // PostgREST niets, en wordt juist de RESULTS-kant afgekapt, dan tellen
  // afgeronde attempts als gat — vals alarm op precies het signaal dat over de
  // volledigheid van het auditspoor gaat.
  const [attempts, results] = await Promise.all([
    ctx.svc
      .from("platform_event_log")
      .select("correlatie_id, doel_fonds_id")
      .eq("fase", "attempt")
      .gte("tijdstip", sinds)
      .lte("tijdstip", uiterlijk)
      .order("tijdstip", { ascending: false })
      .limit(LEESLIMIET),
    ctx.svc
      .from("platform_event_log")
      .select("correlatie_id")
      .eq("fase", "result")
      .gte("tijdstip", sinds)
      .order("tijdstip", { ascending: false })
      .limit(LEESLIMIET),
  ]);
  if (attempts.error) throw attempts.error;
  if (results.error) throw results.error;

  const attemptRijen = (attempts.data ?? []) as Array<{
    correlatie_id: string;
    doel_fonds_id: string | null;
  }>;
  const resultRijen = (results.data ?? []) as Array<{ correlatie_id: string }>;
  const afgekapt =
    attemptRijen.length >= LEESLIMIET || resultRijen.length >= LEESLIMIET;

  const afgerond = new Set(resultRijen.map((r) => r.correlatie_id));

  const teller = nieuweTeller(ctx.fondsIds);
  for (const rij of attemptRijen) {
    if (afgerond.has(rij.correlatie_id)) continue;
    pak(teller, rij.doel_fonds_id).raak += 1;
  }
  // Correlatie-id's worden hier alleen GELEZEN om het verschil te bepalen; ze
  // verlaten deze functie niet en komen dus niet in de snapshot of op het scherm.
  // Doorklik naar de logregels vergt platform.logs.read (P6, besluit 0106).
  return alsAantal(teller, afgekapt);
}

// ── Signaal 3 — AI-respons-latency p95 ──────────────────────────────────────
async function meetLatency(ctx: MetingContext): Promise<Meting[]> {
  const { data, error } = await ctx.svc
    .from("governance_log")
    .select("fonds_id, duur_model_ms:retrieval_meta->>duur_model_ms")
    .gte("aangemaakt", sindsIso(ctx))
    .order("aangemaakt", { ascending: false })
    .limit(LEESLIMIET);
  if (error) throw error;

  const rijen = (data ?? []) as Array<{
    fonds_id: string | null;
    duur_model_ms: string | null;
  }>;
  const afgekapt = rijen.length >= LEESLIMIET;

  const perFonds = new Map<string | null, number[]>();
  for (const id of ctx.fondsIds) perFonds.set(id, []);
  for (const rij of rijen) {
    // LET OP: `Number(null)` is 0, en 0 is finiet en niet-negatief. Zonder deze
    // null-check zouden alle gesprekken van vóór P5 én elke terugvraag als 0 ms
    // meetellen — dan zakt de p95 naar bijna nul, schiet `n` ruim boven de
    // n-drempel, en staat het signaal groen op waarnemingen die nooit gemeten
    // zijn. Precies de blinde monitor die deze tranche moet uitsluiten.
    if (rij.duur_model_ms === null || rij.duur_model_ms === undefined) continue;
    const ms = Number(rij.duur_model_ms);
    if (!Number.isFinite(ms) || ms < 0) continue;
    const lijst = perFonds.get(rij.fonds_id) ?? [];
    lijst.push(ms);
    perFonds.set(rij.fonds_id, lijst);
  }

  return [...perFonds.entries()].map(([fondsId, waarden]) => ({
    fondsId,
    waarde: p95(waarden),
    n: waarden.length,
    afgekapt,
  }));
}

// ── Signaal 4 — Lege-antwoord-ratio ─────────────────────────────────────────
//  Definitie (vastgelegd, want FO §19 laat hem open): een antwoord telt als leeg
//  wanneer er geen enkele chunk is geselecteerd (`geselecteerd = 0`) OF de
//  bronbasis als zwak is gemarkeerd. Terugvragen (`verduidelijking = true`)
//  tellen NIET mee: dat is een bewuste vervolgvraag, geen leeg antwoord
//  (besluit 0092).
async function meetLegeAntwoordRatio(ctx: MetingContext): Promise<Meting[]> {
  const { data, error } = await ctx.svc
    .from("governance_log")
    .select(
      "fonds_id, geselecteerd:retrieval_meta->>geselecteerd, zwak:retrieval_meta->>zwakke_bronbasis, verduidelijking:retrieval_meta->>verduidelijking"
    )
    .gte("aangemaakt", sindsIso(ctx))
    .order("aangemaakt", { ascending: false })
    .limit(LEESLIMIET);
  if (error) throw error;

  const rijen = (data ?? []) as Array<{
    fonds_id: string | null;
    geselecteerd: string | null;
    zwak: string | null;
    verduidelijking: string | null;
  }>;
  const afgekapt = rijen.length >= LEESLIMIET;

  const teller = nieuweTeller(ctx.fondsIds);
  for (const rij of rijen) {
    if (rij.verduidelijking === "true") continue;
    const bak = pak(teller, rij.fonds_id);
    bak.totaal += 1;
    if (rij.geselecteerd === "0" || rij.zwak === "true") bak.raak += 1;
  }
  return alsRatio(teller, afgekapt);
}

// ── Signaal 6 — Tokenverbruik per fonds ─────────────────────────────────────
//  Trend, geen absoluut getal: de FO-drempel is "+50% / +100%" t.o.v. het
//  voortschrijdend daggemiddelde. Vergelijkt de laatste 24 uur met het
//  daggemiddelde van de zeven dagen dáárvoor.
//
//  ONDERGRENS. Meegeteld: eindgeneratie + map-reduce-lus, inclusief cachetokens.
//  NIET meegeteld: de reranker, query-reformulatie, server-side web_search, en de
//  AI-routes buiten de assistentchat (voorbereiding en besluit-concept schrijven
//  uberhaupt geen governance_log-regel). Het dashboard toont dat voorbehoud als
//  vaste regel — een onvolledig getal dat als volledig wordt gepresenteerd is
//  schijnzekerheid.
async function meetTokenverbruik(ctx: MetingContext): Promise<Meting[]> {
  const dagMs = 24 * 60 * 60_000;
  const grensRecent = new Date(ctx.nu.getTime() - dagMs);
  const startBasis = new Date(ctx.nu.getTime() - 8 * dagMs);

  const { data, error } = await ctx.svc
    .from("governance_log")
    .select("fonds_id, aangemaakt, tokens:retrieval_meta->tokens")
    .gte("aangemaakt", startBasis.toISOString())
    // Zonder .order() zou een afkapping bij >LEESLIMIET rijen de recent/basis-
    // splitsing willekeurig maken, en komt er een trendpercentage uit met een
    // stoplicht dat nergens op slaat.
    .order("aangemaakt", { ascending: false })
    .limit(LEESLIMIET);
  if (error) throw error;

  const rijen = (data ?? []) as Array<{
    fonds_id: string | null;
    aangemaakt: string;
    tokens: { in?: unknown; out?: unknown } | null;
  }>;
  const afgekapt = rijen.length >= LEESLIMIET;

  type Bak = { recent: number; basis: number; nRecent: number; basisDagen: Set<string> };
  const perFonds = new Map<string | null, Bak>();
  for (const id of ctx.fondsIds)
    perFonds.set(id, { recent: 0, basis: 0, nRecent: 0, basisDagen: new Set() });

  for (const rij of rijen) {
    const totaal = getal(rij.tokens?.in) + getal(rij.tokens?.out);
    if (totaal <= 0) continue; // gesprekken van vóór P5 dragen geen tokens
    const bak =
      perFonds.get(rij.fonds_id) ??
      { recent: 0, basis: 0, nRecent: 0, basisDagen: new Set<string>() };
    if (new Date(rij.aangemaakt) >= grensRecent) {
      bak.recent += totaal;
      bak.nRecent += 1;
    } else {
      bak.basis += totaal;
      // Welke kalenderdagen de basisperiode werkelijk dekt.
      bak.basisDagen.add(rij.aangemaakt.slice(0, 10));
    }
    perFonds.set(rij.fonds_id, bak);
  }

  return [...perFonds.entries()].map(([fondsId, bak]) => {
    // Deel door het WERKELIJKE aantal dagen met waarnemingen, niet vast door 7.
    // Anders wordt de trend in de eerste week structureel opgeblazen — op dag 2
    // zou één dag verbruik door zeven worden gedeeld en als +600% oplichten.
    // Onder de volle basisperiode geven we liever niets dan een vals rood.
    const basisDagen = bak.basisDagen.size;
    const dagGemiddeldeBasis = basisDagen >= MIN_BASISDAGEN ? bak.basis / basisDagen : 0;
    // Onder de n-drempel mag er GEEN absoluut tokengetal mee. Bij n=1 is
    // `tokens_laatste_24u` het exacte verbruik van één gesprek van één
    // bestuurder — 180 dagen bewaard. De trendwaarde zelf wordt door
    // bepaalStatus() al onderdrukt; dit dicht de opslagkant.
    const onderDrempel = bak.nRecent < (ctx.config.nDrempel ?? 0);
    return {
      fondsId,
      waarde: trendPercentage(bak.recent, dagGemiddeldeBasis),
      n: bak.nRecent,
      afgekapt,
      meta: onderDrempel
        ? { onderdrukt: true, basisdagen: basisDagen }
        : {
            tokens_laatste_24u: bak.recent,
            daggemiddelde_basisperiode: Math.round(dagGemiddeldeBasis),
            basisdagen: basisDagen,
            ...(basisDagen < MIN_BASISDAGEN
              ? { reden: `nog geen volledige basisperiode (${basisDagen}/${MIN_BASISDAGEN} dagen)` }
              : {}),
          },
    };
  });
}

// ── Gedeelde helpers ────────────────────────────────────────────────────────

function sindsIso(ctx: MetingContext): string {
  const minuten = ctx.config.vensterMinuten > 0 ? ctx.config.vensterMinuten : 1440;
  return new Date(ctx.nu.getTime() - minuten * 60_000).toISOString();
}

type JobRij = { document_id: string; status: string };

async function leesJobs(
  svc: SupabaseClient,
  opties: {
    stappen?: string[];
    statussen?: string[];
    sinds?: string;
    // Op welk tijdveld het venster filtert. 'eind' voor terminale metingen
    // (wanneer een job KLAAR was), 'aangemaakt' voor instroom. Default 'aangemaakt'.
    sindsVeld?: "aangemaakt" | "eind";
  }
): Promise<JobRij[]> {
  let query = svc.from("document_processing_jobs").select("document_id, status");
  // Sinds F4/F6 draagt ÉÉN job de hele keten (extractie→embedding); `stap` is
  // alleen de instapfase (auditspoor), niet de actuele fase. Stap-filteren is
  // daarom bewust optioneel — de ingest-signalen filteren op STATUS, niet op stap.
  if (opties.stappen) query = query.in("stap", opties.stappen);
  if (opties.statussen) query = query.in("status", opties.statussen);
  if (opties.sinds) query = query.gte(opties.sindsVeld ?? "aangemaakt", opties.sinds);

  const { data, error } = await query.limit(LEESLIMIET);
  if (error) throw error;
  return (data ?? []) as JobRij[];
}

/**
 * document_id → fonds_id. Aparte query in plaats van een PostgREST-embed:
 * document_processing_jobs heeft twee FK's naar documenten (document_id en
 * versie_id), waardoor een embed dubbelzinnig is.
 */
async function fondsVoorDocumenten(
  svc: SupabaseClient,
  documentIds: string[]
): Promise<Map<string, string | null>> {
  const uniek = [...new Set(documentIds.filter(Boolean))];
  const kaart = new Map<string, string | null>();
  if (uniek.length === 0) return kaart;

  const { data, error } = await svc
    .from("documenten")
    .select("id, fonds_id")
    .in("id", uniek.slice(0, LEESLIMIET));
  if (error) throw error;

  for (const rij of (data ?? []) as Array<{ id: string; fonds_id: string | null }>) {
    kaart.set(rij.id, rij.fonds_id);
  }
  return kaart;
}

type Bak = { totaal: number; raak: number };

/** Start met een lege bak per actief fonds, zodat elk fonds gegarandeerd een rij krijgt. */
function nieuweTeller(fondsIds: string[]): Map<string | null, Bak> {
  const teller = new Map<string | null, Bak>();
  for (const id of fondsIds) teller.set(id, { totaal: 0, raak: 0 });
  return teller;
}

function pak(teller: Map<string | null, Bak>, fondsId: string | null): Bak {
  const bestaand = teller.get(fondsId);
  if (bestaand) return bestaand;
  const nieuw: Bak = { totaal: 0, raak: 0 };
  teller.set(fondsId, nieuw);
  return nieuw;
}

function alsRatio(teller: Map<string | null, Bak>, afgekapt = false): Meting[] {
  return [...teller.entries()].map(([fondsId, bak]) => ({
    fondsId,
    waarde: bak.totaal === 0 ? null : (bak.raak / bak.totaal) * 100,
    n: bak.totaal, // noemer = aantal waarnemingen; dit is wat de n-drempel toetst
    afgekapt,
  }));
}

/**
 * Telsignalen. `n` is hier bewust NULL en niet de telling zelf.
 *
 * `n` is de teller waarop de n-drempel (besluit 0055) wordt toegepast: "hoeveel
 * waarnemingen zitten er achter deze waarde". Bij een telsignaal is de waarde
 * zélf het aantal gebeurtenissen, niet de populatie. Zou `n = waarde` staan, dan
 * zou een later ingestelde n-drempel precies de KLEINE aantallen onderdrukken —
 * dus 1 tot 9 rate-limit-incidenten of audit-gaten onzichtbaar maken. Dat is het
 * omgekeerde van wat 0055 beoogt en zou de gevaarlijkste gevallen wegfilteren.
 */
function alsAantal(teller: Map<string | null, Bak>, afgekapt = false): Meting[] {
  return [...teller.entries()].map(([fondsId, bak]) => ({
    fondsId,
    waarde: bak.raak,
    n: null,
    afgekapt,
  }));
}

function getal(waarde: unknown): number {
  const n = Number(waarde);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
