// ============================================================================
//  Module-scope — AI-modulecontext (besluit 0151)
// ----------------------------------------------------------------------------
//  PURE parsing + opmaak voor de `module_scope`: de expliciete objectcontext die
//  de client meestuurt en de server ONDER RLS resolveert. Drie soorten:
//
//    { soort: "proces",       procedure_id } — reikwijdte + fase van één dossier
//    { soort: "risicomatrix" }               — alle risico's van het fonds (breed)
//    { soort: "risico",       risico_id }    — verdieping op één risico (in-chat)
//
//  Net als document-scope.ts is deze module DB-vrij en zuiver testbaar
//  (module-scope.sanity.ts): de chat-route haalt de rijen op (RLS doet de
//  fonds-isolatie) en geeft ze hier door. De builders leveren BENOEMDE TEKST
//  (geen genummerde bron), mét een gedragsinstructie die MEEREIST in het blok —
//  zo blijft de op sha256 gepinde toon-systeemprompt byte-identiek (§2, §8).
//
//  Security: een gemanipuleerde procedure_id/risico_id van een ANDER fonds wordt
//  door RLS niet teruggegeven, valt buiten de meegegeven rijen, en de route
//  weigert (nooit een stille terugval naar fondsbrede data). De `risicomatrix`-
//  soort kent geen id: leeg fonds → expliciet "geen geregistreerde risico's",
//  legitiem leeg, geen weigering.
// ============================================================================

import { categorieLabel, NIVEAU_LABEL, type NiveauSlug } from "./risico-config";

// ── Contract ────────────────────────────────────────────────────────────────

export type ModuleScope =
  | { soort: "proces"; procedure_id: string }
  | { soort: "risicomatrix" }
  | { soort: "risico"; risico_id: string };

export type ModuleScopeSoort = ModuleScope["soort"];

/**
 * Parse + saneer het `module_scope`-veld uit de request-body. Vertrouwt niets:
 * onbekende soort of ontbrekend/leeg id → null (geen scope). De id-waarde wordt
 * server-side pas vertrouwd ná RLS-resolutie; deze functie normaliseert alleen
 * de vorm.
 */
export function parseModuleScope(raw: unknown): ModuleScope | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const soort = o.soort;
  if (soort === "risicomatrix") return { soort: "risicomatrix" };
  if (soort === "proces") {
    const id = typeof o.procedure_id === "string" ? o.procedure_id.trim() : "";
    return id ? { soort: "proces", procedure_id: id } : null;
  }
  if (soort === "risico") {
    const id = typeof o.risico_id === "string" ? o.risico_id.trim() : "";
    return id ? { soort: "risico", risico_id: id } : null;
  }
  return null;
}

// ── Datumopmaak (pure; geen `now`-afhankelijkheid) ──────────────────────────

/** Leesbare datum (dag maand jaar). Ongeldige/lege input → "". */
export function datumKort(d: string | null | undefined): string {
  if (!d) return "";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

function niveauTekst(niveau: string | null | undefined): string {
  const n = (niveau ?? "").toLowerCase();
  return (NIVEAU_LABEL as Record<string, string>)[n] ?? (niveau ? String(niveau) : "onbekend");
}

// ── Rij-typen zoals de route ze (onder RLS) aanlevert ───────────────────────

export type RisicoRij = {
  id: string;
  categorie: string;
  titel: string;
  toelichting: string | null;
  kans: number;
  impact: number;
  niveau: string;
  type_risico: string;
  status: string; // 'actief' | 'gesloten'
  eigenaar_naam: string | null;
  volgende_beoordeling: string | null;
  gesloten_op: string | null;
  sluit_motivering: string | null;
};

/** Eén regel uit risico_log, met de titel van het bijbehorende risico erbij. */
export type RisicoLogRij = {
  risico_id: string;
  risico_titel: string;
  event_type: string;
  payload: unknown;
  actor_naam: string | null;
  tijdstip: string | null;
};

export type MaatregelRij = {
  beschrijving: string;
  status: string;
  verantwoordelijke: string | null;
};

export type ProcedureRij = {
  id: string;
  titel: string;
  status: string;
  template_code: string | null;
  beschrijving: string | null;
};

export type DecisionRij = {
  besluitvraag: string | null;
  aanleiding: string | null;
  scope: string | null;
  governance_orgaan: string | null;
  complexiteit: string | null;
  risiconiveau: string | null;
  mandaatgevoelig: boolean | null;
  toezichtgevoelig: boolean | null;
  beleidsafwijking: boolean | null;
  ai_risicoklasse: string | null;
  status: string | null;
};

export type StapRij = {
  volgorde: number;
  naam: string;
  beschrijving: string | null;
  status: string; // 'open' | 'actief' | 'afgerond'
};

export type RequirementRij = {
  label: string;
  requirement_type: string;
  verplicht: boolean | null;
  blokkerend: boolean | null;
};

export type BewijsRij = {
  document_id: string | null;
  titel: string | null;
  documenttype: string | null;
};

// ── Meereizende instructies (human-in-the-loop; §4/§8) ──────────────────────

const RISICO_INSTRUCTIE =
  "Gebruik deze risicohistorie om te signaleren wat er speelt en speelde en waarom de " +
  "weging is verschoven — put uit de actieve én gesloten risico's en de motiveringen in " +
  'het logboek. Signaleer ("dit stond eerder op hoog omdat…", "dit is gesloten omdat…", ' +
  '"dit staat nog open") — draag nooit een besluit of opdracht op. Wordt naar de weging van ' +
  "een risico gevraagd: spiegel de geregistreerde kans, impact en het niveau en de motiveringen " +
  "achter eerdere verschuivingen, en benoem de open punten — draag nooit een eigen weging op als " +
  'besluit ("dit hoort op hoog"); de weging is aan het bestuur. Kent een verschuiving of sluiting ' +
  "geen motivering, benoem dat expliciet in plaats van er een te veronderstellen. Deze historie " +
  "omvat uitsluitend geregistreerde risico's en logboek-motiveringen; opgetreden incidenten die " +
  "niet als risico zijn vastgelegd, staan er niet in. Spreekt deze stand een genotuleerd besluit " +
  "of document tegen, benoem dan beide en kies niet stilzwijgend.";

const PROCES_INSTRUCTIE =
  "Gebruik deze dossiergegevens om de reikwijdte en de stand van het proces te benoemen en de " +
  "gekoppelde stukken samen te vatten. Signaleer wat de besluitvraag is, welke stap loopt en wat " +
  "de huidige stap vraagt — draag nooit een besluit of opdracht op. Baseer inhoudelijke uitspraken " +
  "over de stukken uitsluitend op de genummerde bronnen [Bron N]; ontbreekt een stuk, benoem dat. " +
  "Spreekt de dossierstand een genotuleerd besluit of document tegen, benoem dan beide en kies " +
  "niet stilzwijgend.";

// ── Logregel-normalisatie ───────────────────────────────────────────────────
//  risico_log kent meerdere event-vormen (besluit 0151 §0):
//   - risico_gewijzigd : payload {diff:{veld:{oud,nieuw}}, motivering, raakt_weging}
//   - risico_gesloten  : payload {motivering}
//   - niveau_gewijzigd : LEGACY (seed) payload {van, naar, motivering}
//  Alleen weging-/sluitregels zijn hier relevant.

const WEEG_DIFF_VELDEN = ["niveau", "kans", "impact", "niveau_handmatig"] as const;

/** Beschrijf één logregel als leesbare zin, of null als hij niet ter zake doet. */
export function beschrijfLogRegel(
  log: RisicoLogRij
): { tekst: string; isWeging: boolean } | null {
  const p = (log.payload && typeof log.payload === "object" ? log.payload : {}) as Record<
    string,
    unknown
  >;
  const wanneer = datumKort(log.tijdstip);
  const wie = log.actor_naam ? ` door ${log.actor_naam}` : "";
  const prefix = `«${log.risico_titel}»${wanneer ? `, ${wanneer}` : ""}${wie}: `;
  const motiveringTekst = (m: unknown): string => {
    const s = typeof m === "string" ? m.trim() : "";
    return s ? ` Motivering: ${s}` : " Motivering: (geen opgegeven)";
  };

  if (log.event_type === "risico_gewijzigd") {
    const diff = (p.diff && typeof p.diff === "object" ? p.diff : {}) as Record<
      string,
      { oud?: unknown; nieuw?: unknown }
    >;
    const delen: string[] = [];
    for (const veld of WEEG_DIFF_VELDEN) {
      const d = diff[veld];
      if (d && (d.oud !== undefined || d.nieuw !== undefined)) {
        const label = veld === "niveau_handmatig" ? "niveau (handmatig)" : veld;
        delen.push(`${label} ${String(d.oud)}→${String(d.nieuw)}`);
      }
    }
    if (delen.length === 0) return null; // wijziging zonder weegveld — niet ter zake
    return { tekst: `${prefix}${delen.join(", ")}.${motiveringTekst(p.motivering)}`, isWeging: true };
  }

  if (log.event_type === "niveau_gewijzigd") {
    // Legacy seed-vorm.
    const van = p.van !== undefined ? String(p.van) : "?";
    const naar = p.naar !== undefined ? String(p.naar) : "?";
    return { tekst: `${prefix}niveau ${van}→${naar}.${motiveringTekst(p.motivering)}`, isWeging: true };
  }

  if (log.event_type === "risico_gesloten") {
    return { tekst: `${prefix}gesloten.${motiveringTekst(p.motivering)}`, isWeging: false };
  }

  return null;
}

// ── Blok-builder: risicomatrix (breed, compact) ─────────────────────────────

/**
 * Fondsbreed risico-blok: alle risico's per thema (actief compact, gesloten als
 * één-regel-samenvatting) + de N recentste weging-/sluitregels uit het logboek.
 *
 * @param risicos   Alle risico's van het fonds (RLS), actief + gesloten.
 * @param logs      risico_log-regels (RLS), reeds op tijdstip aflopend gesorteerd.
 * @param maxLog    Bovengrens op het aantal weging-/sluitregels (default 15).
 */
export function bouwRisicomatrixBlok(
  risicos: RisicoRij[],
  logs: RisicoLogRij[],
  maxLog = 15
): string {
  const kop =
    "=== RISICOMATRIX VAN HET FONDS — HISTORIE & STAND (context — geen genummerde bron; " +
    "dit is de geregistreerde risico-stand van uw fonds, geen vastgesteld besluit) ===";

  if (risicos.length === 0) {
    return `${kop}\n\nEr zijn voor dit fonds geen risico's geregistreerd.\n\n${RISICO_INSTRUCTIE}`;
  }

  // Groepeer per thema in de vaste volgorde van de matrix.
  const themas = [
    "financieel_actuarieel",
    "governance_organisatie",
    "operationeel_datakwaliteit",
    "informatie_communicatie",
  ];
  const secties: string[] = [];
  for (const thema of themas) {
    const inThema = risicos.filter((r) => r.categorie === thema);
    if (inThema.length === 0) continue;
    const actief = inThema.filter((r) => r.status !== "gesloten");
    const gesloten = inThema.filter((r) => r.status === "gesloten");
    const regels: string[] = [];
    for (const r of actief) {
      regels.push(
        `- «${r.titel}» — niveau ${niveauTekst(r.niveau)} (kans ${r.kans}/5 × impact ${r.impact}/5), ` +
          `${r.type_risico}${r.eigenaar_naam ? `; eigenaar ${r.eigenaar_naam}` : ""}` +
          `${r.volgende_beoordeling ? `; volgende beoordeling ${datumKort(r.volgende_beoordeling)}` : ""}.` +
          `${r.toelichting ? ` ${String(r.toelichting).slice(0, 180)}` : ""}`
      );
    }
    for (const r of gesloten) {
      regels.push(
        `- [GESLOTEN] «${r.titel}» — laatst op niveau ${niveauTekst(r.niveau)}` +
          `${r.gesloten_op ? `, gesloten ${datumKort(r.gesloten_op)}` : ""}.` +
          `${r.sluit_motivering ? ` Reden: ${String(r.sluit_motivering).slice(0, 180)}` : ""}`
      );
    }
    secties.push(`THEMA «${categorieLabel(thema)}»:\n${regels.join("\n")}`);
  }

  // Wegingsgeschiedenis fondsbreed, begrensd.
  const wegingRegels: string[] = [];
  for (const log of logs) {
    if (wegingRegels.length >= maxLog) break;
    const beschreven = beschrijfLogRegel(log);
    if (beschreven) wegingRegels.push(`- ${beschreven.tekst}`);
  }
  const wegingBlok =
    wegingRegels.length > 0
      ? `\n\nWEGINGSGESCHIEDENIS (waarom een risico van niveau veranderde — de ${wegingRegels.length} recentste weegveld-/sluitregels):\n${wegingRegels.join("\n")}`
      : "";

  return `${kop}\n\n${secties.join("\n\n")}${wegingBlok}\n\n${RISICO_INSTRUCTIE}`;
}

// ── Blok-builder: één risico (verdieping) ───────────────────────────────────

/**
 * Verdiepingsblok op één risico: de volledige weging-/sluithistorie + maatregelen.
 *
 * @param risico  Het risico (RLS).
 * @param logs    De VOLLEDIGE risico_log van dit risico (RLS), aflopend gesorteerd.
 * @param maatregelen  De maatregelen van dit risico (RLS).
 */
export function bouwRisicoBlok(
  risico: RisicoRij,
  logs: RisicoLogRij[],
  maatregelen: MaatregelRij[]
): string {
  const kop =
    `=== RISICO «${risico.titel}» — VERDIEPING (context — geen genummerde bron; ` +
    "geregistreerde risicostand, geen vastgesteld besluit) ===";

  const kern =
    `Thema: ${categorieLabel(risico.categorie)}. Niveau ${niveauTekst(risico.niveau)} ` +
    `(kans ${risico.kans}/5 × impact ${risico.impact}/5), ${risico.type_risico}. ` +
    `Status ${risico.status === "gesloten" ? "gesloten" : "actief"}` +
    `${risico.eigenaar_naam ? `; eigenaar ${risico.eigenaar_naam}` : ""}` +
    `${risico.volgende_beoordeling ? `; volgende beoordeling ${datumKort(risico.volgende_beoordeling)}` : ""}.` +
    `${risico.toelichting ? `\nToelichting: ${risico.toelichting}` : ""}` +
    `${risico.status === "gesloten" && risico.sluit_motivering ? `\nReden van sluiten: ${risico.sluit_motivering}` : ""}`;

  const historieRegels: string[] = [];
  for (const log of logs) {
    const beschreven = beschrijfLogRegel(log);
    if (beschreven) historieRegels.push(`- ${beschreven.tekst}`);
  }
  const historieBlok =
    historieRegels.length > 0
      ? `\n\nVOLLEDIGE WEGINGSGESCHIEDENIS:\n${historieRegels.join("\n")}`
      : "\n\nVOLLEDIGE WEGINGSGESCHIEDENIS: geen weging-wijzigingen geregistreerd.";

  const maatregelRegels = maatregelen.map(
    (m) =>
      `- ${m.beschrijving} (${m.status}${m.verantwoordelijke ? `, ${m.verantwoordelijke}` : ""})`
  );
  const maatregelBlok =
    maatregelRegels.length > 0 ? `\n\nBEHEERMAATREGELEN:\n${maatregelRegels.join("\n")}` : "";

  return `${kop}\n\n${kern}${historieBlok}${maatregelBlok}\n\n${RISICO_INSTRUCTIE}`;
}

// ── Blok-builder: proces (reikwijdte + fase) ────────────────────────────────

function classificatieRegel(d: DecisionRij): string {
  const kenmerken: string[] = [];
  if (d.mandaatgevoelig) kenmerken.push("mandaatgevoelig");
  if (d.toezichtgevoelig) kenmerken.push("toezichtgevoelig");
  if (d.beleidsafwijking) kenmerken.push("beleidsafwijking");
  const kenmerkTekst = kenmerken.length > 0 ? `, ${kenmerken.join(", ")}` : "";
  return (
    `Classificatie: complexiteit ${d.complexiteit ?? "onbekend"}, risiconiveau ` +
    `${d.risiconiveau ?? "onbekend"}${kenmerkTekst}; AI-risicoklasse ${d.ai_risicoklasse ?? "onbekend"}.` +
    `${d.governance_orgaan ? ` Governance-orgaan: ${d.governance_orgaan}.` : ""}`
  );
}

/**
 * Proces-contextblok: reikwijdte + fase uit het Decision Object en de huidige
 * stap, plus de gekoppelde stukken als [Bron N]-set (die de route apart als
 * document-scope zet). Bewust GEEN vervuld/niet-vervuld-oordeel over de
 * requirements: dat vergt de readiness-engine en zou hier schijnzekerheid geven —
 * de labels gaan neutraal mee als "wat deze stap vraagt".
 *
 * @param heeftBronnen  Of er doorzoekbare gekoppelde stukken zijn (bepaalt de
 *                      bronbasis-melding). De titels komen uit `bewijs`.
 */
export function bouwProcesBlok(args: {
  procedure: ProcedureRij;
  decision: DecisionRij | null;
  huidigeStap: StapRij | null;
  requirements: RequirementRij[];
  bewijs: BewijsRij[];
  heeftBronnen: boolean;
}): string {
  const { procedure, decision, huidigeStap, requirements, bewijs, heeftBronnen } = args;

  const kop =
    `=== PROCES «${procedure.titel}» — REIKWIJDTE & STAND (context — geen genummerde bron; ` +
    "dit is de dossierstand in het portaal, geen vastgesteld besluit) ===";

  const regels: string[] = [];
  if (decision) {
    if (decision.besluitvraag) regels.push(`Centrale besluitvraag: ${decision.besluitvraag}`);
    if (decision.aanleiding) regels.push(`Aanleiding: ${decision.aanleiding}`);
    if (decision.scope) regels.push(`Reikwijdte: ${decision.scope}`);
    regels.push(classificatieRegel(decision));
    regels.push(
      `Status dossier: ${decision.status ?? procedure.status}.` +
        (huidigeStap
          ? ` Huidige stap: «${huidigeStap.naam}» (${huidigeStap.status})${huidigeStap.beschrijving ? ` — ${huidigeStap.beschrijving}` : ""}.`
          : "")
    );
  } else {
    // Geen Decision Object gekoppeld — val terug op de procedure zelf.
    if (procedure.beschrijving) regels.push(`Omschrijving: ${procedure.beschrijving}`);
    regels.push(
      `Status dossier: ${procedure.status}.` +
        (huidigeStap
          ? ` Huidige stap: «${huidigeStap.naam}» (${huidigeStap.status})${huidigeStap.beschrijving ? ` — ${huidigeStap.beschrijving}` : ""}.`
          : "")
    );
  }

  if (requirements.length > 0) {
    const reqRegels = requirements.map(
      (r) => `- ${r.label}${r.blokkerend ? " (blokkerend)" : ""}`
    );
    regels.push(`Wat deze stap vraagt:\n${reqRegels.join("\n")}`);
  }

  // Gekoppelde stukken: benoem ze; de INHOUD komt uit de [Bron N]-retrieval.
  const stukRegels = bewijs
    .filter((b) => b.titel)
    .map((b) => `- «${b.titel}»${b.documenttype ? ` (${b.documenttype})` : ""}`);
  const stukBlok = heeftBronnen
    ? `\n\nGekoppelde stukken (hieronder als genummerde bron [Bron N] doorzoekbaar):\n${stukRegels.join("\n")}`
    : "\n\n(Aan dit dossier zijn nog geen doorzoekbare stukken gekoppeld. Beantwoord op basis " +
      "van bovenstaande dossiergegevens en, waar passend, uw algemene kennis — doorzoek niet de " +
      "hele bibliotheek en suggereer geen stukken die er niet zijn.)";

  return `${kop}\n\n${regels.join("\n")}${stukBlok}\n\n${PROCES_INSTRUCTIE}`;
}
