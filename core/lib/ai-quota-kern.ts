// ============================================================================
//  ai-quota-kern.ts — pure rekenkern voor de AI-begrenzing (quota + kill switch)
// ----------------------------------------------------------------------------
//  PURE functies zonder IO. De DATABASE is en blijft de afdwingende laag: de
//  reservering gebeurt atomair in `fn_ai_reserveer_intern` en niets hier kan die
//  beslissing overrulen. Dit bestand bestaat om twee redenen:
//
//   1. EXECUTABLE SPEC. `ai-quota-kern.sanity.ts` pint de drempels, de
//      maandgrens en de actietype-tabel, zodat een wijziging in de SQL die hier
//      niet landt (of andersom) meteen rood wordt. Zelfde rol als
//      `rate-limit.sanity.ts` speelt voor `fn_rate_limit_check`.
//   2. WEERGAVE. De beheermodule rekent percentage en status hiermee uit, zodat
//      de UI dezelfde grenzen hanteert als de DB en niet zijn eigen variant.
//
//  KALENDERMAAND (FR-2). De maandgrens wordt SERVER-SIDE in UTC bepaald, nooit
//  door de client. In SQL is dat `date_trunc('month', now() at time zone 'UTC')`;
//  `maandSleutel()` hieronder is exact dezelfde afspraak in TypeScript. De UI
//  toont de maand met tijdzone-uitleg, zodat "1 augustus" niet stilzwijgend iets
//  anders betekent dan de teller meet.
//
//  TELCONTRACT (FR-2). Eén AI-ACTIE is één door een gebruiker geïnitieerde
//  functionele actie, die één of meer modelcalls mag veroorzaken. Interne
//  retries en meerdere modelstappen binnen dezelfde actie tellen NIET opnieuw.
//  OCR is een aparte grootheid: `ocr` reserveert pagina's en nul AI-acties, en
//  krijgt per POGING een eigen reservering (de provider factureert een retry
//  ook opnieuw).
//
//  Besluit 0180. Let op het onderscheid met besluit 0178 ("Verbruik & bundel"):
//  dát telt euro's uit `governance_log` ACHTERAF, dit telt AI-acties VÓÓR de
//  providercall. Verschillende grootheden, verschillende momenten — ze horen
//  elkaar niet te bevestigen.
// ============================================================================

/** De vier configureerbare quotumsleutels (public.ai_quota_config). */
export const QUOTA_SLEUTELS = [
  "gebruiker_maand",
  "fonds_maand",
  "globaal_maand",
  "ocr_fonds_maand",
] as const;

export type QuotaSleutel = (typeof QUOTA_SLEUTELS)[number];

/** Vastgestelde startwaarden (werkopdracht §2.2). Beheerder kan ze wijzigen. */
export const QUOTA_STANDAARD: Record<QuotaSleutel, number> = {
  gebruiker_maand: 150,
  fonds_maand: 500,
  globaal_maand: 1200,
  ocr_fonds_maand: 1000,
};

/** De vier onafhankelijk bedienbare kill switches (public.ai_kill_switch). */
export const SWITCH_SLEUTELS = ["globaal", "anthropic", "mistral", "openai"] as const;
export type SwitchSleutel = (typeof SWITCH_SLEUTELS)[number];

/**
 * Toestanden van een schakelaar.
 *
 *   actief ──stop──► gestopt ──aanvraag──► heractivering_aangevraagd
 *                        ▲                          │
 *                        └──afwijzen/intrekken──────┤
 *                                                   └──goedkeuren──► actief
 *
 * `afgewezen` is bewust GEEN schakelaartoestand maar de uitkomst van een
 * verzoek: na afwijzing staat de schakelaar gewoon weer op `gestopt`.
 */
export const SWITCH_STATUSSEN = ["actief", "gestopt", "heractivering_aangevraagd"] as const;
export type SwitchStatus = (typeof SWITCH_STATUSSEN)[number];

/** Uitkomsten van een heractiveringsverzoek (public.ai_heractivering_besluit). */
export const BESLUIT_SOORTEN = ["goedgekeurd", "afgewezen", "ingetrokken", "vervallen"] as const;
export type BesluitSoort = (typeof BESLUIT_SOORTEN)[number];

/** Levenscyclus van één logische actie (public.ai_actie). */
export const ACTIE_STATUSSEN = ["in_uitvoering", "voltooid", "mislukt", "verlopen"] as const;
export type ActieStatus = (typeof ACTIE_STATUSSEN)[number];

/**
 * Toegestane statusovergangen — alleen vooruit, nooit terug en nooit vanuit een
 * eindtoestand. De DB dwingt dit af met een kolomvries-trigger; deze tabel is de
 * spiegel ervan zodat de sanity beide kanten kan pinnen.
 */
export const ACTIE_OVERGANGEN: Record<ActieStatus, readonly ActieStatus[]> = {
  in_uitvoering: ["voltooid", "mislukt", "verlopen"],
  voltooid: [],
  mislukt: [],
  verlopen: [],
};

export function magOvergaan(van: ActieStatus, naar: ActieStatus): boolean {
  return ACTIE_OVERGANGEN[van].includes(naar);
}

// ── Actietypes ──────────────────────────────────────────────────────────────

/**
 * Bereik van een actietype.
 *
 *  `fonds`   — telt tegelijk voor gebruiker (indien aanwezig), fonds en globaal.
 *  `globaal` — telt UITSLUITEND globaal. Bewust een korte, expliciete lijst:
 *              `fonds_id = null` mag nooit een makkelijke quota-bypass worden
 *              (FR-2), dus alleen een actietype dat hier `globaal` is mág zonder
 *              fonds worden gereserveerd.
 */
export type Bereik = "fonds" | "globaal";

export type ActietypeSpec = {
  /** Telt dit actietype voor gebruiker+fonds+globaal, of alleen globaal? */
  bereik: Bereik;
  /** Aantal AI-acties dat één reservering verbruikt. `ocr` verbruikt er nul. */
  aiActies: 0 | 1;
  /** Mag dit type via `fn_ai_preflight` (sessiegebonden, auth.uid())? */
  viaGebruiker: boolean;
  /** Mag dit type via `fn_ai_preflight_systeem` (service-role, cron/worker)? */
  viaSysteem: boolean;
  /**
   * Leasetermijn in seconden. Blijft een actie hierna `in_uitvoering` — vrijwel
   * altijd door een crash halverwege — dan verklaart de eerstvolgende preflight
   * hem `verlopen` en mag een nieuwe poging door. De reeds geschreven
   * verbruiksregel blijft staan: conservatief tellen boven netjes tellen.
   */
  leaseSeconden: number;
};

/**
 * De volledige actietype-tabel. Een actietype dat hier niet staat wordt door de
 * preflight geweigerd (fail-closed) — er is geen impliciete default, zodat een
 * nieuw kostendragend pad niet stilzwijgend ongemeten kan blijven.
 */
export const ACTIETYPES = {
  // ── Tenantroutes: sessiegebonden, fondsgebonden ──────────────────────────
  chat: { bereik: "fonds", aiActies: 1, viaGebruiker: true, viaSysteem: false, leaseSeconden: 300 },
  agendapunt_voorbereiding: { bereik: "fonds", aiActies: 1, viaGebruiker: true, viaSysteem: false, leaseSeconden: 300 },
  besluit_concept: { bereik: "fonds", aiActies: 1, viaGebruiker: true, viaSysteem: false, leaseSeconden: 300 },
  afschrift_concept: { bereik: "fonds", aiActies: 1, viaGebruiker: true, viaSysteem: false, leaseSeconden: 300 },
  vergelijken: { bereik: "fonds", aiActies: 1, viaGebruiker: true, viaSysteem: false, leaseSeconden: 600 },
  notulen_bevestig: { bereik: "fonds", aiActies: 1, viaGebruiker: true, viaSysteem: false, leaseSeconden: 300 },
  embeddings_backfill: { bereik: "fonds", aiActies: 1, viaGebruiker: true, viaSysteem: false, leaseSeconden: 600 },
  reindex_backfill: { bereik: "fonds", aiActies: 1, viaGebruiker: true, viaSysteem: false, leaseSeconden: 900 },

  // ── Achtergrondverwerking: fondsgebonden, maar zonder gebruiker ──────────
  // De ingest-worker draait op cron met de service-role. Het fonds komt van de
  // job-rij (document_processing_jobs.fonds_id), niet van een sessie; er is
  // dus geen gebruiker om tegen af te rekenen, wel een fonds.
  document_ingest: { bereik: "fonds", aiActies: 1, viaGebruiker: false, viaSysteem: true, leaseSeconden: 900 },
  semantische_extractie: { bereik: "fonds", aiActies: 1, viaGebruiker: false, viaSysteem: true, leaseSeconden: 900 },

  // ── OCR: eigen grootheid, nul AI-acties ──────────────────────────────────
  // Reserveert het aantal pagina's dat WERKELIJK aan de OCR-provider wordt
  // aangeboden. Een document dat volledig uit de PDF-tekstlaag komt, komt hier
  // nooit langs en verbruikt dus niets. Per poging een eigen reservering.
  ocr: { bereik: "fonds", aiActies: 0, viaGebruiker: true, viaSysteem: true, leaseSeconden: 600 },

  // ── Platformbreed: geen fonds, telt alleen globaal ───────────────────────
  // Expliciet en auditbaar, precies zoals FR-2 vereist.
  generiek_curatie: { bereik: "globaal", aiActies: 1, viaGebruiker: false, viaSysteem: true, leaseSeconden: 900 },
  // OCR op de generieke (sector)bibliotheek. Die documenten horen bij géén
  // fonds, dus ze kunnen niet op een fondsquotum drukken — maar ongemeten mogen
  // ze evenmin blijven. Ze krijgen daarom hun eigen platformbrede paginabucket,
  // getoetst tegen dezelfde grens als een fonds.
  ocr_generiek: { bereik: "globaal", aiActies: 0, viaGebruiker: false, viaSysteem: true, leaseSeconden: 600 },
  aqlab_run: { bereik: "globaal", aiActies: 1, viaGebruiker: false, viaSysteem: true, leaseSeconden: 1800 },
  aqlab_adhoc: { bereik: "globaal", aiActies: 1, viaGebruiker: false, viaSysteem: true, leaseSeconden: 1800 },
} as const satisfies Record<string, ActietypeSpec>;

export type Actietype = keyof typeof ACTIETYPES;

/** Alle actietypes, gesorteerd — handig voor de sanity en de beheerweergave. */
export const ACTIETYPE_NAMEN = Object.keys(ACTIETYPES).sort() as Actietype[];

export function isActietype(waarde: string): waarde is Actietype {
  return Object.prototype.hasOwnProperty.call(ACTIETYPES, waarde);
}

/** Spec ophalen; `null` bij een onbekend type (de aanroeper faalt dan closed). */
export function specVoor(actietype: string): ActietypeSpec | null {
  return isActietype(actietype) ? ACTIETYPES[actietype] : null;
}

// ── Kalendermaand (UTC) ─────────────────────────────────────────────────────

/**
 * Maandsleutel `YYYY-MM-01` in UTC — de bucket waarover alle tellers lopen.
 * Spiegelt `date_trunc('month', now() at time zone 'UTC')::date` in SQL.
 */
export function maandSleutel(nu: Date): string {
  const jaar = nu.getUTCFullYear();
  const maand = String(nu.getUTCMonth() + 1).padStart(2, "0");
  return `${jaar}-${maand}-01`;
}

/** Eerste moment van de volgende kalendermaand in UTC. */
export function startVolgendeMaand(nu: Date): Date {
  return new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

/**
 * Seconden tot de volgende kalendermaand — de `Retry-After` bij een bereikt
 * maandquotum. Altijd minimaal 1, zodat een client nooit een 0 of negatieve
 * waarde krijgt op de laatste milliseconden van de maand.
 */
export function secondenTotVolgendeMaand(nu: Date): number {
  const ms = startVolgendeMaand(nu).getTime() - nu.getTime();
  return Math.max(1, Math.ceil(ms / 1000));
}

// ── Drempels en status ──────────────────────────────────────────────────────

/**
 * Waarschuwingsdrempels (werkopdracht §2.2): waarschuwen bij minimaal 50% en
 * minimaal 80%; blokkeren pas bij 100%. Een waarschuwing blokkeert dus niets.
 */
export const DREMPEL_WAARSCHUWING = 0.5;
export const DREMPEL_VERHOOGD = 0.8;

export type QuotaStatus = "ruim" | "waarschuwing" | "verhoogd" | "geblokkeerd";

export type QuotaStand = {
  gebruikt: number;
  limiet: number;
  /** Aandeel van het quotum, 0..n. Bij limiet 0 altijd 1 (alles geblokkeerd). */
  aandeel: number;
  resterend: number;
  status: QuotaStatus;
};

/**
 * Stand van één teller. `gebruikt >= limiet` blokkeert; een limiet van 0 betekent
 * "helemaal dicht" en niet "onbeperkt" — dat laatste zou een tikfout in de
 * beheer-UI in een stille bypass veranderen.
 */
export function beoordeelStand(gebruikt: number, limiet: number): QuotaStand {
  const veiligGebruikt = Math.max(0, gebruikt);
  const veiligLimiet = Math.max(0, limiet);
  const aandeel = veiligLimiet === 0 ? 1 : veiligGebruikt / veiligLimiet;
  const resterend = Math.max(0, veiligLimiet - veiligGebruikt);

  let status: QuotaStatus;
  if (veiligGebruikt >= veiligLimiet) status = "geblokkeerd";
  else if (aandeel >= DREMPEL_VERHOOGD) status = "verhoogd";
  else if (aandeel >= DREMPEL_WAARSCHUWING) status = "waarschuwing";
  else status = "ruim";

  return { gebruikt: veiligGebruikt, limiet: veiligLimiet, aandeel, resterend, status };
}

/** Woord + omschrijving per status. Kleur is nooit de enige drager (0097). */
export const STATUS_WOORD: Record<QuotaStatus, string> = {
  ruim: "Ruim",
  waarschuwing: "Let op",
  verhoogd: "Bijna vol",
  geblokkeerd: "Vol",
};

// ── Beslissing ──────────────────────────────────────────────────────────────

/** Redenen waarom een preflight kan weigeren. Gesaniteerd: geen tellerstanden. */
export type WeigerReden =
  | "onbekend_actietype"
  | "actietype_niet_toegestaan_op_dit_pad"
  | "fonds_ontbreekt"
  | "globaal_gestopt"
  | "provider_gestopt"
  | "model_niet_toegestaan"
  | "model_buiten_venster"
  | "quotum_gebruiker"
  | "quotum_fonds"
  | "quotum_globaal"
  | "quotum_ocr";

/** Tellerstanden van de huidige maand, zoals de DB ze aanlevert. */
export type Tellers = {
  gebruiker: number;
  fonds: number;
  globaal: number;
  ocrFonds: number;
};

export type Limieten = Record<QuotaSleutel, number>;

export type QuotaBeslissing =
  | { toegestaan: true }
  | { toegestaan: false; reden: WeigerReden };

/**
 * Zuivere quotumtoets — de spiegel van het tellergedeelte van
 * `fn_ai_reserveer_intern`. Volgorde is bewust: het meest omvattende quotum dat
 * geraakt wordt, wint niet — we melden het SMALSTE bereik eerst, want dat is de
 * enige melding waar de gebruiker zelf iets aan heeft ("u bent door uw eigen
 * maandtegoed heen" is bruikbaarder dan "het platform zit vol").
 *
 * De vergelijking is `+ gevraagd > limiet`: een actie die precies op de grens
 * uitkomt mag nog, een actie die eroverheen zou gaan niet.
 */
export function beoordeelQuota(
  actietype: Actietype,
  tellers: Tellers,
  limieten: Limieten,
  ocrPaginas: number
): QuotaBeslissing {
  const spec = ACTIETYPES[actietype];
  const gevraagd = spec.aiActies;

  if (spec.bereik === "fonds") {
    if (tellers.gebruiker + gevraagd > limieten.gebruiker_maand) {
      return { toegestaan: false, reden: "quotum_gebruiker" };
    }
    if (tellers.fonds + gevraagd > limieten.fonds_maand) {
      return { toegestaan: false, reden: "quotum_fonds" };
    }
  }

  if (tellers.globaal + gevraagd > limieten.globaal_maand) {
    return { toegestaan: false, reden: "quotum_globaal" };
  }

  if (ocrPaginas > 0 && tellers.ocrFonds + ocrPaginas > limieten.ocr_fonds_maand) {
    return { toegestaan: false, reden: "quotum_ocr" };
  }

  return { toegestaan: true };
}

/**
 * Is een model op dit moment toegestaan? Een regel zonder venster geldt
 * onbeperkt zolang `actief`; een regel MET venster is uitsluitend binnen
 * [start, eind) toegestaan. Na de eindtijd vervalt de toestemming vanzelf —
 * configuratie-expiratie, geen accountdeactivatie (FR-4).
 */
export type AllowlistRegel = {
  actief: boolean;
  vensterStart: string | null;
  vensterEind: string | null;
};

export function modelToegestaan(
  regel: AllowlistRegel | null | undefined,
  nu: Date
): { toegestaan: true } | { toegestaan: false; reden: "model_niet_toegestaan" | "model_buiten_venster" } {
  if (!regel || !regel.actief) return { toegestaan: false, reden: "model_niet_toegestaan" };
  if (regel.vensterStart === null && regel.vensterEind === null) return { toegestaan: true };
  if (regel.vensterStart === null || regel.vensterEind === null) {
    // Half ingevuld venster is een configuratiefout: fail-closed.
    return { toegestaan: false, reden: "model_buiten_venster" };
  }
  const t = nu.getTime();
  const start = new Date(regel.vensterStart).getTime();
  const eind = new Date(regel.vensterEind).getTime();
  if (Number.isNaN(start) || Number.isNaN(eind)) {
    return { toegestaan: false, reden: "model_buiten_venster" };
  }
  return t >= start && t < eind
    ? { toegestaan: true }
    : { toegestaan: false, reden: "model_buiten_venster" };
}

/** Is de lease van een lopende actie verstreken? */
export function isVerlopen(gestartOp: Date, actietype: Actietype, nu: Date): boolean {
  const lease = ACTIETYPES[actietype].leaseSeconden * 1000;
  return nu.getTime() - gestartOp.getTime() > lease;
}
