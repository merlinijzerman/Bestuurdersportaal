// ============================================================================
//  Guardrailkader — de MACHINE-LEESBARE, canonieke weergave van ontwerp §7.3
//  (Rol Bestuursbureau ontwerp v0.3). T3, plateau A.
// ----------------------------------------------------------------------------
//  Bron van waarheid voor "wat mag de AI voor wie", programmatisch narekenbaar
//  (zie guardrailkader.sanity.ts). Eén lijst; documentatie elders verwijst hier
//  naar in plaats van de matrix te herhalen (ontwerp §7.8). De assurance-view
//  (/governance/assurance) rendert dit register zodat het fonds kan aantonen
//  welke guardrails per klasse zijn geborgd en afgetekend (FR-19).
//
//  DRIE DINGEN DIE DIT REGISTER HARD MAAKT:
//   1. De handhavingsklasse per guardrail (§7.2): H = hard (RLS/capability/type-
//      merk/runtime-weigering), D = deterministisch (server-side instructie/filter/
//      verplicht outputelement), M = modelgedrag (promptregel). Een guardrail is
//      zo sterk als de laag waarin hij is afgedwongen.
//   2. De KERNREGEL (§7.2, afgeleid van besluit 0098): geen compliance-relevante
//      guardrail mag UITSLUITEND in klasse M zitten. Waar dat toch zo is
//      (toon/formulering), is het een expliciet, met besluit aanvaard restrisico.
//      guardrailkader.sanity.ts bewijst deze regel programmatisch (FR-20).
//   3. De toetsverwijzing per guardrail: H/D → een geautomatiseerde test; M → de
//      evalset met menselijke aftekening. Zo is elke bewering herleidbaar naar
//      code of eval, niet naar een belofte in documentatie.
//
//  BEHEER (§7.8): wijzigen van een guardrail vergt een decisions/-entry, ook als
//  de wijziging klein lijkt. Een guardrail die zonder besluit verschuift is geen
//  guardrail. Verschuift dit register, dan kantelt de pin in guardrailkader.sanity.
// ============================================================================

/** De tenant-rollen uit de matrix §7.3. */
export type Rol = "B" | "V" | "Bh" | "BB";

/** Handhavingsklasse (§7.2). Een guardrail kan in meerdere klassen tegelijk zitten. */
export type Klasse = "H" | "D" | "M";

/** Toestand van een guardrail per rol in de matrix. */
export type MatrixWaarde = "ja" | "nee" | "voorwaardelijk" | "nvt";

/** Eén concrete toets die een (deel van een) guardrail aantoont. */
export interface Toets {
  /** De klasse die deze toets afdekt. */
  klasse: Klasse;
  /** Verwijzing naar het bewijs: een testbestand/-suite (H/D) of een evalset (M). */
  bewijs: string;
  /**
   * Aard van de toets. `geautomatiseerd` = deterministisch reproduceerbaar (H/D).
   * `evalset` = menselijke aftekening op vrije tekst (M) — nooit 100%.
   */
  aard: "geautomatiseerd" | "evalset";
}

/** Een aanvaard restrisico: een guardrail die (deels) op klasse M leunt zonder
 *  volledige H/D-tegenhanger. Alleen toegestaan mét besluit-referentie (§7.2). */
export interface Restrisico {
  reden: string;
  besluit: string;
}

/** Eén guardrail uit matrix §7.3. */
export interface Guardrail {
  /** "G1".."G23" — de canonieke nummering. */
  id: string;
  /** De guardrail in één zin, zoals in §7.3. */
  omschrijving: string;
  /** Per rol: geldt/permitteert de matrix deze guardrail? (§7.3-kolommen B/V/Bh/BB) */
  rollen: Record<Rol, MatrixWaarde>;
  /** De handhavingsklasse(n), §7.2. */
  klassen: Klasse[];
  /** Waar afgedwongen — de laatste kolom van §7.3 (herleidbaarheid). */
  waarAfgedwongen: string;
  /**
   * Is dit een compliance-relevante guardrail? Bepaalt of de kernregel §7.2 van
   * toepassing is (bronvermelding, afscherming persoonsgebonden info, herkomst
   * van een uitgaand stuk, human-in-the-loop, audit, misbruik/kosten, privacy).
   * Puur enablend/cosmetisch gedrag (bv. "mag duiden") is dat niet.
   */
  complianceRelevant: boolean;
  /** De toetsen die deze guardrail aantonen (per klasse ten minste één). */
  toetsen: Toets[];
  /** Aanwezig ⇔ de guardrail leunt (deels) op klasse M zonder volledige H/D-borging. */
  restrisico?: Restrisico;
  /** Het besluit dat deze guardrail vaststelt/beheert (§7.8). */
  besluit: string;
}

// De besluiten die het kader dragen (§7.8). Losse constanten zodat een
// hernummering hier centraal gebeurt en de sanity ze kan controleren.
const B_KADER = "0131"; // guardrailmatrix §7.3 canoniek + §7.2-kernregel (B-3b)
const B_NULGRENS = "0130"; // nulgrens G23 harde opleveringsvoorwaarde (B-3a)
const B_ROL = "0128"; // vierde tenant-rol bestuursbureau (T1)
const B_PRODUCEREN = "0129"; // producerende bureau-stand + Word-export (T2)

// Korte helpers voor de rollen-kolommen; houdt de matrix hieronder leesbaar.
const ALLE_JA: Record<Rol, MatrixWaarde> = { B: "ja", V: "ja", Bh: "ja", BB: "ja" };
const ALLEEN_BB: Record<Rol, MatrixWaarde> = { B: "nee", V: "nee", Bh: "nee", BB: "ja" };
const ALLE_NEE: Record<Rol, MatrixWaarde> = { B: "nee", V: "nee", Bh: "nee", BB: "nee" };
const BB_NVT_REST: Record<Rol, MatrixWaarde> = { B: "nvt", V: "nvt", Bh: "nvt", BB: "ja" };
const ALLEEN_BESTUUR: Record<Rol, MatrixWaarde> = { B: "ja", V: "ja", Bh: "ja", BB: "nvt" };

/**
 * De canonieke matrix §7.3, guardrail G1..G23. Elke wijziging hier laat de pin in
 * guardrailkader.sanity.ts kantelen en vergt een decisions/-entry (§7.8).
 */
export const GUARDRAILKADER: readonly Guardrail[] = [
  {
    id: "G1",
    omschrijving: "Assistent mag duiden, samenvatten, spiegelen, kritische vragen stellen",
    rollen: ALLE_JA,
    klassen: ["D", "M"],
    waarAfgedwongen: "Bestaande modi en taakinstructies",
    complianceRelevant: false,
    besluit: B_KADER,
    toetsen: [
      { klasse: "D", bewijs: "core/lib/generatie-kern.sanity.ts (modus-assemblage)", aard: "geautomatiseerd" },
      { klasse: "M", bewijs: "evals/organisatieprofiel-gedrag.md", aard: "evalset" },
    ],
  },
  {
    id: "G2",
    omschrijving: "Assistent mag concepttekst voor een stuk produceren",
    rollen: ALLEEN_BB,
    klassen: ["H", "D"],
    waarAfgedwongen: "Capability ai.stukvoorbereiding; taakinstructie alleen samengesteld bij die capability",
    complianceRelevant: true,
    besluit: B_PRODUCEREN,
    toetsen: [
      { klasse: "H", bewijs: "core/lib/capabilities.sanity.ts + tests/cross-tenant/bureau-rolgrenzen.test.ts", aard: "geautomatiseerd" },
      { klasse: "D", bewijs: "core/lib/stukvoorbereiding.sanity.ts", aard: "geautomatiseerd" },
    ],
  },
  {
    id: "G3",
    omschrijving: "Assistent mag een voorstel of aanbeveling formuleren (uitsluitend als voorstel ván het bureau áán het bestuur)",
    rollen: ALLEEN_BB,
    klassen: ["D", "M"],
    waarAfgedwongen: "Samengestelde instructie (D); formulering (M)",
    complianceRelevant: true,
    besluit: B_PRODUCEREN,
    toetsen: [
      { klasse: "D", bewijs: "core/lib/stukvoorbereiding.sanity.ts (voorstel-niet-besluit)", aard: "geautomatiseerd" },
      { klasse: "M", bewijs: "evals/stuk-voorbereiden-gedrag.md", aard: "evalset" },
    ],
  },
  {
    id: "G4",
    omschrijving: "Assistent mag nooit een besluit nemen, vaststellen of namens het bestuur spreken",
    rollen: ALLE_NEE,
    klassen: ["D", "M"],
    waarAfgedwongen: "Universeel; geen enkele taak stelt iets vast in de data",
    complianceRelevant: true,
    besluit: B_KADER,
    toetsen: [
      { klasse: "D", bewijs: "core/lib/stukvoorbereiding.sanity.ts (concept ter bewerking, geen vaststelling)", aard: "geautomatiseerd" },
      { klasse: "M", bewijs: "evals/stuk-voorbereiden-gedrag.md + evals/organisatieprofiel-gedrag.md", aard: "evalset" },
    ],
  },
  {
    id: "G5",
    omschrijving: "Bronbereik fondsdocumenten + generieke bibliotheek",
    rollen: ALLE_JA,
    klassen: ["H"],
    waarAfgedwongen: "RLS + bestaande bronintentie",
    complianceRelevant: true,
    besluit: B_KADER,
    toetsen: [
      { klasse: "H", bewijs: "tests/cross-tenant/*.test.ts + supabase/checks/2026_07_31_r1_structurele_gates.sql", aard: "geautomatiseerd" },
    ],
  },
  {
    id: "G6",
    omschrijving: "Bronbereik live gezaghebbende webbronnen (whitelist)",
    rollen: ALLEEN_BB,
    klassen: ["H"],
    waarAfgedwongen: "Capability ai.deskresearch én WEB_RETRIEVAL_ACTIEF (§7.6, B-8) — T4",
    complianceRelevant: true,
    besluit: B_ROL,
    toetsen: [
      { klasse: "H", bewijs: "core/lib/capabilities.sanity.ts (ai.deskresearch alleen BB); webpad-gate T4", aard: "geautomatiseerd" },
    ],
  },
  {
    id: "G7",
    omschrijving: "Modelkennis toegestaan, altijd gemarkeerd als [Algemene kennis]",
    rollen: ALLE_JA,
    klassen: ["D"],
    waarAfgedwongen: "assistant-source.ts (detectie/auditsignaal); markering opgedragen in de systeemprompt",
    complianceRelevant: true,
    besluit: B_KADER,
    restrisico: {
      reden:
        "De deterministische borging is de DETECTIE van de [Algemene kennis]-markering " +
        "(assistant-source.ts) als auditsignaal — niet een harde afdwinging. Het daadwerkelijk " +
        "márkeren van modelkennis wordt door de systeemprompt aan het model opgedragen en leunt " +
        "dus op modelgedrag. Aanvaard restrisico; te hardenen (server-side invoeging/blokkade) of " +
        "formeel te herclassificeren naar D+M. Gesignaleerd bij de T3 ai-governance-review.",
      besluit: B_KADER,
    },
    toetsen: [
      { klasse: "D", bewijs: "core/lib/assistant-source.ts + sanity (detectie [Algemene kennis], audit-only)", aard: "geautomatiseerd" },
    ],
  },
  {
    id: "G8",
    omschrijving: "Modelkennis mag niet gebruikt worden om een gat in een conceptstuk te dichten (verboden voor BB)",
    rollen: { B: "nvt", V: "nvt", Bh: "nvt", BB: "nee" },
    klassen: ["D", "M"],
    waarAfgedwongen: 'Verplichte sectie "Aannames en open punten" (D); regel in de instructie (M)',
    complianceRelevant: true,
    besluit: B_PRODUCEREN,
    toetsen: [
      { klasse: "D", bewijs: "core/lib/stukvoorbereiding.sanity.ts (SLOTSECTIE niet-uitzetbaar; niet dichten met algemene kennis)", aard: "geautomatiseerd" },
      { klasse: "M", bewijs: "evals/stuk-voorbereiden-gedrag.md (faalmodus stilzwijgend invullen)", aard: "evalset" },
    ],
  },
  {
    id: "G9",
    omschrijving: "Persoonlijke inbreng, dissent en individueel stemgedrag komen nooit in de AI-context",
    rollen: ALLE_JA,
    klassen: ["H"],
    waarAfgedwongen: "AI-paden lezen deze tabellen niet (§3); voor BB bovendien RLS-afgeschermd (M2/M3)",
    complianceRelevant: true,
    besluit: B_ROL,
    restrisico: {
      reden:
        "De H-borging geldt de AI-CONTEXT (de stem-/inbreng-/dissenttabellen worden niet in de " +
        "AI-paden gelezen; RLS M2/M3) en is daar geverifieerd. Individueel stemgedrag lekt echter " +
        "BUITEN de AI-context: de bevroren stemmingen.uitslag.per_stemgerechtigde (jsonb) en " +
        "decision_audit_snapshots zijn fondsbreed leesbaar, en de weergavekanalen zijn slechts " +
        "klasse-D afgeschermd. FR-4 is daarmee niet aantoonbaar gehaald (OP-T1-7/8). Bewust " +
        "uitgesteld restrisico; een structurele fix raakt de bevroren auditvorm.",
      besluit: B_ROL,
    },
    toetsen: [
      { klasse: "H", bewijs: "tests/cross-tenant/bureau-rolgrenzen.test.ts + supabase/checks/2026_08_05_bb_rolgrenzen.sql (AI-context)", aard: "geautomatiseerd" },
    ],
  },
  {
    id: "G10",
    omschrijving: "Privé-voorbereidingen van een ander komen nooit in de AI-context",
    rollen: ALLE_JA,
    klassen: ["H"],
    waarAfgedwongen: 'Policy "eigen voorbereiding"',
    complianceRelevant: true,
    besluit: B_KADER,
    toetsen: [
      { klasse: "H", bewijs: "tests/cross-tenant/*.test.ts (eigen voorbereiding)", aard: "geautomatiseerd" },
    ],
  },
  {
    id: "G11",
    omschrijving: "Elke bewering uit bronnen draagt [Bron N]",
    rollen: ALLE_JA,
    klassen: ["D"],
    waarAfgedwongen: "citatie-validatie in retrieval_meta (anti-dangling); markering per bewering = modelgedrag",
    complianceRelevant: true,
    besluit: B_KADER,
    restrisico: {
      reden:
        "De deterministische controle is de ANTI-DANGLING-telling (citaties.ongeldig = geen [Bron N] " +
        "buiten het bronbereik). Dát élke bewering een [Bron N] draagt (dekking-per-bewering) is niet " +
        "deterministisch getoetst en blijft modelgedrag. Aanvaard restrisico; afgedekt via de evalset. " +
        "Gesignaleerd bij de T3 ai-governance-review.",
      besluit: B_KADER,
    },
    toetsen: [
      { klasse: "D", bewijs: "core/lib/generatie-kern.ts (citaties.ongeldig, anti-dangling) + evals reviewtabel (dekking-per-bewering, menselijk)", aard: "geautomatiseerd" },
    ],
  },
  {
    id: "G12",
    omschrijving: "Anti-fabricage: alleen daadwerkelijk opgehaalde bronnen mogen worden getoond of geciteerd",
    rollen: ALLE_JA,
    klassen: ["H", "D"],
    waarAfgedwongen: "Kernbesluit assistant-source.ts",
    complianceRelevant: true,
    besluit: B_KADER,
    toetsen: [
      { klasse: "H", bewijs: "core/lib/assistant-source.ts", aard: "geautomatiseerd" },
      { klasse: "D", bewijs: "citaties.ongeldig = 0 (evals reviewtabel, FR-11)", aard: "geautomatiseerd" },
    ],
  },
  {
    id: "G13",
    omschrijving: 'Verplichte slotsectie "Aannames en open punten"',
    rollen: BB_NVT_REST,
    klassen: ["D"],
    waarAfgedwongen: "Bouwfunctie van de instructie; niet uitzetbaar",
    complianceRelevant: true,
    besluit: B_PRODUCEREN,
    toetsen: [
      { klasse: "D", bewijs: "core/lib/stukvoorbereiding.sanity.ts (slotsectie is laatste kop, niet weg te laten)", aard: "geautomatiseerd" },
    ],
  },
  {
    id: "G14",
    omschrijving: "Kopiëren naar het klembord met verplichte bronnenlijst + herkomstregel; niet gelogd",
    rollen: ALLE_JA,
    klassen: ["H"],
    waarAfgedwongen: "bouwKopie() type-merk + heeftVerplichteHerkomst() (besluit 0098)",
    complianceRelevant: true,
    besluit: "0098",
    toetsen: [
      { klasse: "H", bewijs: "core/lib/antwoord-klembord.ts + sanity (type-merk/herkomst)", aard: "geautomatiseerd" },
    ],
  },
  {
    id: "G15",
    omschrijving: "Word-export met verplichte bronnenlijst + herkomstregel",
    rollen: ALLEEN_BB,
    klassen: ["H"],
    waarAfgedwongen: "Capability ai.stukvoorbereiding; zelfde constructiepatroon als G14",
    complianceRelevant: true,
    besluit: B_PRODUCEREN,
    toetsen: [
      { klasse: "H", bewijs: "core/lib/antwoord-docx.ts + capability-gate (app/api/ai/stuk-export/route.ts)", aard: "geautomatiseerd" },
    ],
  },
  {
    id: "G16",
    omschrijving: "Word-export wordt wél geregistreerd in governance_export_log",
    rollen: BB_NVT_REST,
    klassen: ["D"],
    waarAfgedwongen: "Serverroute; besluitpunt B-4 (log_word_export)",
    complianceRelevant: true,
    besluit: B_PRODUCEREN,
    toetsen: [
      { klasse: "D", bewijs: "app/api/ai/stuk-export/route.ts → RPC log_word_export() (governance_export_log)", aard: "geautomatiseerd" },
    ],
  },
  {
    id: "G17",
    omschrijving: "Volledige interactielogging in governance_log, inclusief promptvariant",
    rollen: ALLE_JA,
    klassen: ["D"],
    waarAfgedwongen: "Bestaande logging + retrieval_meta.bureau",
    complianceRelevant: true,
    besluit: B_KADER,
    toetsen: [
      { klasse: "D", bewijs: "app/api/chat/route.ts (retrieval_meta.bureau.promptvariant) + evals auditspoor", aard: "geautomatiseerd" },
    ],
  },
  {
    id: "G18",
    omschrijving: "Profielsturing prioriteert, filtert niet — de collectieve feitenbasis blijft compleet",
    rollen: ALLE_JA,
    klassen: ["D", "M"],
    waarAfgedwongen: "profielsturing.ts (instructie expliciet); restrisico in klasse M",
    complianceRelevant: true,
    besluit: B_KADER,
    restrisico: {
      reden: "De D-laag legt de instructie vast, maar of het model werkelijk prioriteert i.p.v. filtert is modelgedrag zonder volwaardige D-tegenhanger. Bewust aanvaard, afgedekt via de evalset.",
      besluit: B_KADER,
    },
    toetsen: [
      { klasse: "D", bewijs: "core/lib/profielsturing.ts + sanity (instructie prioriteert, filtert niet)", aard: "geautomatiseerd" },
      { klasse: "M", bewijs: "evals/organisatieprofiel-gedrag.md", aard: "evalset" },
    ],
  },
  {
    id: "G19",
    omschrijving: "Geen juridisch of financieel advies; het portaal geeft ondersteuning, geen advies",
    rollen: ALLE_JA,
    klassen: ["M"],
    waarAfgedwongen: "AI-governance-kader; restrisico expliciet",
    complianceRelevant: true,
    besluit: B_KADER,
    restrisico: {
      reden: "Uitsluitend klasse M: er is geen H/D-tegenhanger die 'advies' deterministisch onderscheidt van 'ondersteuning'. Bewust aanvaard restrisico (§7.2/§7.3), afgedekt via de evalset met menselijke aftekening; nooit 100%.",
      besluit: B_KADER,
    },
    toetsen: [
      { klasse: "M", bewijs: "evals/organisatieprofiel-gedrag.md + evals/stuk-voorbereiden-gedrag.md", aard: "evalset" },
    ],
  },
  {
    id: "G20",
    omschrijving: "Webinhoud is data, nooit instructie (prompt-injectie)",
    rollen: BB_NVT_REST,
    klassen: ["D"],
    waarAfgedwongen: "bron-afbakening.ts (per-request sentinel + neutraliseerBrontekst); SP_BRON_VERTROUWEN is de aanvullende promptregel",
    complianceRelevant: true,
    besluit: "0072",
    restrisico: {
      reden:
        "De deterministische maatregel is de per-request sentinel + neutraliseerBrontekst " +
        "(bron-afbakening.ts): die voorkomt block-spoofing van de bronafbakening. Dát het model " +
        "injectie-instructies in de brontekst NEGEERT (gehoorzaamheid) leunt op SP_BRON_VERTROUWEN " +
        "(promptregel = modelgedrag). Aanvaard restrisico op de gehoorzaamheid; volledige " +
        "injectie-/SEC-11-evals volgen bij T4 (deskresearch). Gesignaleerd bij de T3 ai-governance-review.",
      besluit: B_KADER,
    },
    toetsen: [
      { klasse: "D", bewijs: "core/lib/bron-afbakening.ts (sentinel + neutraliseerBrontekst); SP_BRON_VERTROUWEN (M-aanvulling) — injectie-evals T4", aard: "geautomatiseerd" },
    ],
  },
  {
    id: "G21",
    omschrijving: "Geen PII naar externe zoekprovider",
    rollen: BB_NVT_REST,
    klassen: ["H"],
    waarAfgedwongen: "pii-gate.ts, blokkeert vóór verzending",
    complianceRelevant: true,
    besluit: B_ROL,
    toetsen: [
      { klasse: "H", bewijs: "core/lib/pii-gate.ts + pii-gate.sanity.ts", aard: "geautomatiseerd" },
    ],
  },
  {
    id: "G22",
    omschrijving: "Rate limit op AI-gebruik (BB: 20/5 min + aparte limiet op deskresearch)",
    rollen: ALLE_JA,
    klassen: ["H"],
    waarAfgedwongen: "rate-limit.ts; fail-open bij DB-storing (bestaande, gedocumenteerde keuze — R11)",
    complianceRelevant: true,
    besluit: B_KADER,
    toetsen: [
      { klasse: "H", bewijs: "core/lib/rate-limit.ts + rate-limit.sanity.ts", aard: "geautomatiseerd" },
    ],
  },
  {
    id: "G23",
    omschrijving: "Nulgrens: het assistentgedrag van bestaande rollen wijzigt niet door dit increment",
    rollen: ALLEEN_BESTUUR,
    klassen: ["D"],
    waarAfgedwongen: "Diff-eis + regressiepoort, §7.5 en FR-9",
    complianceRelevant: true,
    besluit: B_NULGRENS,
    toetsen: [
      { klasse: "D", bewijs: "core/lib/generatie-kern.sanity.ts (sha256-pins) + evals/nulgrens-regressiepoort.md", aard: "geautomatiseerd" },
    ],
  },
] as const;

// ── Afgeleide, pure helpers (voor de assurance-view en de sanity) ────────────

/** Alle guardrails die (deels) op klasse M leunen. */
export function guardrailsMetModelgedrag(): Guardrail[] {
  return GUARDRAILKADER.filter((g) => g.klassen.includes("M"));
}

/**
 * De kernregel §7.2, programmatisch: een compliance-relevante guardrail mag niet
 * UITSLUITEND in klasse M zitten, tenzij het restrisico expliciet met besluit is
 * aanvaard. Geeft de guardrails terug die de regel schenden (leeg = groen).
 *
 * BEPERKING (gesignaleerd bij de T3 ai-governance-review): deze check toetst de
 * KLASSE-LABELS, niet of de geclaimde H/D-borging de guardrail volledig afdwingt.
 * Een guardrail waarvan de D-borging feitelijk detectie/auditsignaal is (bv. G7, G11)
 * of waarvan de echte D elders zit (G20), draagt daarom een expliciet `restrisico`
 * dat de modelgedrag-component eerlijk benoemt. Zo blijft de assurance-view herleidbaar
 * i.p.v. schijnzeker. Een formele herclassificatie van die klassen vergt een
 * decisions/-entry (§7.8) en is een opdrachtgeversbesluit.
 */
export function schendtKernregel(): Guardrail[] {
  return GUARDRAILKADER.filter((g) => {
    if (!g.complianceRelevant) return false;
    const heeftHardeBorging = g.klassen.includes("H") || g.klassen.includes("D");
    if (heeftHardeBorging) return false;
    // Uitsluitend klasse M: alleen toegestaan mét aanvaard restrisico (§7.2).
    return !g.restrisico;
  });
}

/**
 * De aftekenstatus van een guardrail voor de assurance-view.
 *  • "geautomatiseerd" — alle klassen zijn H/D; geborgd via een deterministische test.
 *  • "evalset"         — bevat een M-component; aftekening via de evalset (mens).
 * De M-component is per definitie nooit "hard" afgetekend; de assurance-view toont
 * de evalset-verwijzing + of de aftekening staat/gepland is (WS6, buiten de code).
 */
export function aftekenAard(g: Guardrail): "geautomatiseerd" | "evalset" {
  return g.klassen.includes("M") ? "evalset" : "geautomatiseerd";
}
