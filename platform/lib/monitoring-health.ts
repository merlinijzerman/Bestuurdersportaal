// ============================================================================
//  monitoring-health.ts — healthchecks per component (P5, TO §9.2)
// ----------------------------------------------------------------------------
//  Zeven componenten, elk met groen/oranje/rood (of onbekend) plus een
//  responstijd. De snapshot-job roept `draaiHealthchecks()` RECHTSTREEKS aan —
//  niet via een HTTP-hop naar de eigen healthz-route. Dat scheelt een
//  netwerkstap die niets zou meten behalve zichzelf.
//  /api/platform/healthz is een dunne wikkel om dezelfde functie, voor
//  handmatige diagnose.
//
//  ── WAT ER NIET IN DE UITKOMST ZIT ─────────────────────────────────────────
//  Geen fondsinhoud, geen gebruikersgegevens, geen foutmeldingen van derden.
//  `reden` is altijd een VASTE, door ons geschreven string uit een gesloten
//  verzameling — nooit een doorgegeven error.message. Anders zou de healthz-
//  respons een achterdeur worden voor precies het lek dat app-fout.ts dichtzet.
//
//  ── DREMPELS: WAAROM DEZE HIER STAAN EN NIET IN platform_signaal_config ────
//  De config-tabel draagt de drempels van de SIGNALEN uit FO §19. Een
//  responstijd per losse probe is geen signaal uit die catalogus; het signaal is
//  "uptime kernfunctionaliteit" (nr. 7), en dáárvan staat de drempel wél in de
//  tabel. Deze constanten bepalen alleen wanneer een probe "traag" heet. Bewuste
//  scheiding, geen vergeten configuratie.
// ============================================================================

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ComponentStatus = "groen" | "oranje" | "rood" | "onbekend";

export type ComponentNaam =
  | "back_office"
  | "tenant_app"
  | "supabase"
  | "storage"
  | "model_api"
  | "embedding_retrieval"
  | "documentverwerking";

export type ComponentUitkomst = {
  component: ComponentNaam;
  status: ComponentStatus;
  responstijd_ms: number | null;
  /** Vaste, dataloze toelichting uit een gesloten verzameling. Nooit een externe foutmelding. */
  reden: string | null;
};

/** Boven deze responstijd heet een probe traag (oranje), maar niet stuk. */
const TRAAG_MS = 2000;
/** Harde afkap per probe; erboven is de component onbereikbaar (rood). */
const TIMEOUT_MS = 8000;

/** Een job die hier langer dan dit "bezig" staat, hangt. */
const HANGEND_MINUTEN = 30;
/** Terugkijkvenster voor mislukte verwerkingsjobs en retrieval-fouten. */
const VENSTER_MINUTEN = 60;

/** Minimaal aantal waarnemingen voordat een afgeleide check iets mag beweren. */
const MIN_WAARNEMINGEN = 10;

/**
 * Draait alle zeven componentchecks parallel. Werpt nooit: een check die zelf
 * kapotgaat levert `rood` met een vaste reden, niet een exception die de hele
 * healthcheck meesleurt.
 */
export async function draaiHealthchecks(svc: SupabaseClient): Promise<ComponentUitkomst[]> {
  const checks: Array<Promise<ComponentUitkomst>> = [
    Promise.resolve(checkBackOffice()),
    checkTenantApp(),
    checkSupabase(svc),
    checkStorage(svc),
    checkModelApi(),
    checkEmbeddingRetrieval(svc),
    checkDocumentverwerking(svc),
  ];
  return Promise.all(checks);
}

/**
 * De beschikbaarheidsdefinitie achter signaal 7: **geen enkele component is rood**.
 *
 * NIET "alle componenten groen". Dat lijkt strenger maar is in de praktijk
 * onbruikbaar, en wel om drie redenen die zich allemaal op dag één voordoen:
 *
 *  * `embedding_retrieval` staat op `onbekend` zolang er in het meetvenster
 *    minder dan tien gesprekken met de embedding-vlag zijn — bij MVP-volume
 *    vrijwel altijd;
 *  * `model_api` en `tenant_app` staan op `onbekend` als ANTHROPIC_API_KEY of
 *    APP_HOST in het beheer-project ontbreekt;
 *  * één trage probe (>2 s) maakt een component `oranje`, terwijl traag niet
 *    hetzelfde is als onbeschikbaar.
 *
 * Met "alles groen" zou uptime op 0% blijven staan en het stoplicht permanent
 * rood — en een dashboard dat vanaf dag één rood staat, leert de operator het te
 * negeren. Dat is precies de faalvorm die FO §18.2 wil uitsluiten.
 *
 * `onbekend` telt dus NIET als storing, maar verdwijnt ook niet: het aantal
 * onbekende componenten gaat als aggregaat mee in de snapshot-meta.
 */
export function geenEnkeleRood(uitkomsten: ComponentUitkomst[]): boolean {
  return uitkomsten.length > 0 && !uitkomsten.some((u) => u.status === "rood");
}

/** Aantal componenten dat niets kon zeggen — zichtbaar houden, niet wegmoffelen. */
export function aantalOnbekend(uitkomsten: ComponentUitkomst[]): number {
  return uitkomsten.filter((u) => u.status === "onbekend").length;
}

// ── 1. Back-office ──────────────────────────────────────────────────────────
//  Deze code draait in het beheer-project; dat hij antwoordt IS de meting. Geen
//  zelfreferentiële HTTP-call: die zou alleen bewijzen dat de route zichzelf kan
//  bereiken.
function checkBackOffice(): ComponentUitkomst {
  return { component: "back_office", status: "groen", responstijd_ms: 0, reden: null };
}

// ── 2. Tenant-app (het ANDERE Vercel-project) ───────────────────────────────
async function checkTenantApp(): Promise<ComponentUitkomst> {
  const host = eersteHost(process.env.APP_HOST);
  if (!host) {
    // Zonder APP_HOST kunnen we niets meten. Dat is 'onbekend', niet 'groen' —
    // een blinde monitor mag nooit als "alles in orde" lezen (FO §18.2).
    return {
      component: "tenant_app",
      status: "onbekend",
      responstijd_ms: null,
      reden: "APP_HOST niet geconfigureerd",
    };
  }
  return meet("tenant_app", async () => {
    const res = await fetchMetTimeout(`https://${host}/api/healthz/ping`);
    if (!res.ok) return { ok: false, reden: `status ${res.status}` };
    return { ok: true, reden: null };
  });
}

// ── 3. Supabase-connectiviteit ──────────────────────────────────────────────
async function checkSupabase(svc: SupabaseClient): Promise<ComponentUitkomst> {
  return meet("supabase", async () => {
    // Goedkoopste query met een echte round-trip: één id uit een kleine,
    // geïndexeerde tabel. Geen tenantinhoud.
    const { error } = await svc.from("fondsen").select("id").limit(1);
    if (error) return { ok: false, reden: "query mislukt" };
    return { ok: true, reden: null };
  });
}

// ── 4. Storage ──────────────────────────────────────────────────────────────
async function checkStorage(svc: SupabaseClient): Promise<ComponentUitkomst> {
  return meet("storage", async () => {
    // listBuckets is bucketonafhankelijk: geen bestandsnamen, geen inhoud, en
    // geen aanname over welke buckets bestaan.
    const { error } = await svc.storage.listBuckets();
    if (error) return { ok: false, reden: "storage niet bereikbaar" };
    return { ok: true, reden: null };
  });
}

// ── 5. Model-API ────────────────────────────────────────────────────────────
async function checkModelApi(): Promise<ComponentUitkomst> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      component: "model_api",
      status: "onbekend",
      responstijd_ms: null,
      reden: "ANTHROPIC_API_KEY niet geconfigureerd",
    };
  }
  return meet("model_api", async () => {
    // GET /v1/models is een METADATA-endpoint: het verbruikt geen tokens en
    // kost dus niets, ook niet bij een meting elke vijf minuten. Een echte
    // modelaanroep als healthcheck zou wél elke run geld kosten.
    const res = await fetchMetTimeout("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    });
    if (res.status === 429) return { ok: false, zacht: true, reden: "rate limited" };
    if (!res.ok) return { ok: false, reden: `status ${res.status}` };
    return { ok: true, reden: null };
  });
}

// ── 6. Embedding/retrieval (afgeleid) ───────────────────────────────────────
//  Geen live probe: een embedding-aanroep kost geld en zou de meting zelf tot
//  kostenpost maken. In plaats daarvan het gedrag van het echte verkeer.
async function checkEmbeddingRetrieval(svc: SupabaseClient): Promise<ComponentUitkomst> {
  const sinds = new Date(Date.now() - VENSTER_MINUTEN * 60_000).toISOString();
  try {
    // PROJECTEER één jsonb-sleutel; haal niet het hele retrieval_meta binnen.
    // Dat veld draagt documenttitels (`mogelijk_gerelateerd`), uit de vraag
    // afgeleide zoektermen (`terugval.termen`), URL's (`web.gebruikte_bronnen`)
    // en sectiestructuur (`doorgrond.secties`). Elke vijf minuten het volledige
    // auditveld van alle fondsen het beheerproces in trekken, alleen om te zien
    // of één vlag bestaat, is onnodig breed — en het dashboard belooft de
    // gebruiker "metadata en telemetrie, geen fondsinhoud".
    const { data, error } = await svc
      .from("governance_log")
      .select("ok:retrieval_meta->>embedding_query_success")
      .gte("aangemaakt", sinds)
      .order("aangemaakt", { ascending: false })
      .limit(500);

    if (error) {
      return uitkomst("embedding_retrieval", "rood", null, "bron niet leesbaar");
    }

    const rijen = (data ?? []) as Array<{ ok: string | null }>;
    // Alleen rijen waar de vlag daadwerkelijk gezet is; een ontbrekende sleutel
    // levert null en telt niet mee als geslaagde embedding.
    const metVlag = rijen.filter((r) => r.ok === "true" || r.ok === "false");
    if (metVlag.length < MIN_WAARNEMINGEN) {
      // Te weinig verkeer om iets te beweren. Expliciet onbekend — niet groen.
      return uitkomst(
        "embedding_retrieval",
        "onbekend",
        null,
        "te weinig waarnemingen in het venster"
      );
    }

    const mislukt = metVlag.filter((r) => r.ok === "false").length;
    const ratio = (mislukt / metVlag.length) * 100;
    const status: ComponentStatus = ratio >= 20 ? "rood" : ratio >= 5 ? "oranje" : "groen";
    return uitkomst(
      "embedding_retrieval",
      status,
      null,
      status === "groen" ? null : "verhoogd aandeel embedding-terugval"
    );
  } catch {
    return uitkomst("embedding_retrieval", "rood", null, "check mislukt");
  }
}

// ── 7. Documentverwerking (afgeleid) ────────────────────────────────────────
async function checkDocumentverwerking(svc: SupabaseClient): Promise<ComponentUitkomst> {
  const hangendSinds = new Date(Date.now() - HANGEND_MINUTEN * 60_000).toISOString();
  const misluktSinds = new Date(Date.now() - VENSTER_MINUTEN * 60_000).toISOString();
  try {
    const [hangend, mislukt] = await Promise.all([
      svc
        .from("document_processing_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "bezig")
        .lt("start", hangendSinds),
      svc
        .from("document_processing_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "mislukt")
        .gte("aangemaakt", misluktSinds),
    ]);

    if (hangend.error || mislukt.error) {
      return uitkomst("documentverwerking", "rood", null, "bron niet leesbaar");
    }

    const nHangend = hangend.count ?? 0;
    const nMislukt = mislukt.count ?? 0;
    if (nHangend >= 5 || nMislukt >= 10) {
      return uitkomst("documentverwerking", "rood", null, "veel hangende of mislukte jobs");
    }
    if (nHangend > 0 || nMislukt >= 3) {
      return uitkomst("documentverwerking", "oranje", null, "hangende of mislukte jobs");
    }
    return uitkomst("documentverwerking", "groen", null, null);
  } catch {
    return uitkomst("documentverwerking", "rood", null, "check mislukt");
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

type ProbeUitkomst = { ok: boolean; zacht?: boolean; reden: string | null };

/**
 * Voert een probe uit, meet de duur en vertaalt naar een status.
 * `zacht: true` betekent "niet in orde, maar niet stuk" → oranje.
 */
async function meet(
  component: ComponentNaam,
  probe: () => Promise<ProbeUitkomst>
): Promise<ComponentUitkomst> {
  const start = Date.now();
  try {
    const res = await probe();
    const duur = Date.now() - start;
    if (!res.ok) {
      return uitkomst(component, res.zacht ? "oranje" : "rood", duur, res.reden);
    }
    if (duur > TRAAG_MS) {
      return uitkomst(component, "oranje", duur, "traag");
    }
    return uitkomst(component, "groen", duur, null);
  } catch {
    // Geen error-detail doorgeven: een externe foutmelding kan van alles bevatten.
    return uitkomst(component, "rood", Date.now() - start, "onbereikbaar");
  }
}

function uitkomst(
  component: ComponentNaam,
  status: ComponentStatus,
  responstijd_ms: number | null,
  reden: string | null
): ComponentUitkomst {
  return { component, status, responstijd_ms, reden };
}

async function fetchMetTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

/** APP_HOST mag een komma-lijst zijn (apex + www); de eerste is de kanonieke. */
function eersteHost(waarde: string | undefined): string | null {
  if (!waarde) return null;
  const host = waarde.split(",")[0]?.trim();
  return host && host.length > 0 ? host : null;
}
