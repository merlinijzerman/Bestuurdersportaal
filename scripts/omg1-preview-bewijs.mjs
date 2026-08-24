// ============================================================================
//  OMG-1 — uitvoeringsbewijs van de Preview-seed, in één handeling.
// ----------------------------------------------------------------------------
//  De acceptatie van OMG-1 is niet "het seedscript bestaat" maar "de seed is
//  gedraaid en W7 kon meten". Dit script levert de vier bewijsstukken die daar
//  vóór W7's rondgang aan vooraf gaan, zodat ze niet met de hand uit een
//  dashboard hoeven te worden overgeschreven:
//
//    1. tijdstip van een geslaagde eerste én tweede seed-run;
//    2. rijtelling per entiteit;
//    3. dat de tweede run dezelfde eindtoestand opleverde (idempotentie);
//    4. de ingest-/embeddingqueue en het AI-verbruik van de seed.
//
//  Het vijfde bewijsstuk — de W7-proef op besluitstatus, dissent,
//  segmentbevestiging en inbreng — loopt langs de UI en hoort daar; dit script
//  toont alleen dat de rijen waarop die proef leunt er staan.
//
//  UITSLUITEND PREVIEW. Dezelfde grendel als de seed, met één extra beperking:
//  `local` wordt hier óók geweigerd. Een lokale, ephemere stack levert geen
//  bewijs over de Preview-infrastructuur, en dat is precies wat OMG-1 mist.
//
//  Draaien:
//    SEED_DOELOMGEVING=preview node --env-file=.env.preview \
//      scripts/omg1-preview-bewijs.mjs
//
//  Print nooit sleutels of URL's — alleen de projectref, tellingen en tijden.
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { ENV, FONDS_ID, FIX } from "../tests/karakterisering/config.mjs";
import { bevestigVeiligeSeedDoelomgeving } from "../tests/karakterisering/seed-doelomgeving.mjs";
import { seed } from "../tests/karakterisering/seed.mjs";

const { doelomgeving, projectRef } = bevestigVeiligeSeedDoelomgeving({ url: ENV.url });
if (doelomgeving !== "preview") {
  throw new Error(
    `BEWIJS GEBLOKKEERD: dit script draait alleen tegen Preview, niet tegen '${doelomgeving}'. ` +
      "Een lokale stack levert geen bewijs over de Preview-infrastructuur."
  );
}

const admin = createClient(ENV.url, ENV.serviceKey, { auth: { persistSession: false } });

// ── Wat we tellen ───────────────────────────────────────────────────────────
//  Per entiteit: de tabel, het filter dat bij deze fixtureset hoort, en of het
//  een OMG-1-toevoeging is of een bestaande harnasfixture. Beide tellen mee:
//  de dekkingslijst leunt net zo goed op de bestaande rijen.
const ENTITEITEN = [
  { naam: "fondsen", tabel: "fondsen", kolom: "id", waarde: FONDS_ID, herkomst: "harnas" },
  { naam: "profielen (rolaccounts)", tabel: "profielen", kolom: "fonds_id", waarde: FONDS_ID, herkomst: "harnas" },
  { naam: "documenten", tabel: "documenten", kolom: "fonds_id", waarde: FONDS_ID, herkomst: "harnas + OMG-1" },
  { naam: "vergaderingen", tabel: "vergaderingen", kolom: "fonds_id", waarde: FONDS_ID, herkomst: "harnas" },
  { naam: "agendapunten", tabel: "agendapunten", kolom: "vergadering_id", waarde: FIX.vergadering1, herkomst: "harnas" },
  { naam: "procedures", tabel: "procedures", kolom: "fonds_id", waarde: FONDS_ID, herkomst: "harnas" },
  { naam: "procedure_afschriften", tabel: "procedure_afschriften", kolom: "fonds_id", waarde: FONDS_ID, herkomst: "harnas" },
  { naam: "risicos", tabel: "risicos", kolom: "fonds_id", waarde: FONDS_ID, herkomst: "harnas" },
  { naam: "gesprekken", tabel: "gesprekken", kolom: "fonds_id", waarde: FONDS_ID, herkomst: "harnas" },
  { naam: "procesmodellen", tabel: "procesmodellen", kolom: "fonds_id", waarde: FONDS_ID, herkomst: "harnas" },
  { naam: "gremia", tabel: "gremia", kolom: "fonds_id", waarde: FONDS_ID, herkomst: "harnas" },
  { naam: "expertises", tabel: "expertises", kolom: "fonds_id", waarde: FONDS_ID, herkomst: "harnas" },
  // ── de vier die OMG-1 toevoegt ──
  { naam: "notulen_segmenten", tabel: "notulen_segmenten", kolom: "fonds_id", waarde: FONDS_ID, herkomst: "OMG-1" },
  { naam: "agendapunt_inbreng", tabel: "agendapunt_inbreng", kolom: "agendapunt_id", waarde: FIX.agendapunt1, herkomst: "OMG-1" },
  { naam: "decision_objects", tabel: "decision_objects", kolom: "fonds_id", waarde: FONDS_ID, herkomst: "OMG-1" },
  { naam: "decision_dissent", tabel: "decision_dissent", kolom: "decision_id", waarde: FIX.previewDecision1, herkomst: "OMG-1" },
  { naam: "procedure_stappen", tabel: "procedure_stappen", kolom: "procedure_id", waarde: FIX.procedure1, herkomst: "OMG-1 (preview-only)" },
  { naam: "procedure_checklist", tabel: "procedure_checklist", kolom: "stap_id", waarde: FIX.previewProcedureStap1, herkomst: "OMG-1 (preview-only)" },
];

// Wat er NIET mag zijn: stemmingen blijven ongezaaid (VEN-2). Een gevulde lijst
// zou maskeren dat de module uit staat, dus dit is een assertie en geen telling.
const MOET_LEEG = [{ naam: "stemmingen", tabel: "stemmingen", kolom: "fonds_id", waarde: FONDS_ID }];

// Kostenbewijs: de seed hoort geen ingest, embedding of modelcall te veroorzaken.
const KOSTEN = [
  { naam: "document_processing_jobs (ingestqueue)", tabel: "document_processing_jobs", kolom: "fonds_id", waarde: FONDS_ID },
  // document_chunks draagt geen fonds_id; filteren op de geseede documenten zelf.
  {
    naam: "document_chunks (embeddings)",
    tabel: "document_chunks",
    kolom: "document_id",
    waarde: [FIX.document1, FIX.documentIntrekken, FIX.notulenDocument1],
    meervoud: true,
  },
  { naam: "governance_log (AI-verbruik)", tabel: "governance_log", kolom: "fonds_id", waarde: FONDS_ID },
];

async function tel(spec) {
  let q = admin.from(spec.tabel).select("*", { count: "exact", head: true });
  q = spec.meervoud ? q.in(spec.kolom, spec.waarde) : q.eq(spec.kolom, spec.waarde);
  const { count, error } = await q;
  if (error) return { ...spec, aantal: null, fout: error.message };
  return { ...spec, aantal: count ?? 0 };
}

async function meet(lijst) {
  const uit = [];
  for (const spec of lijst) uit.push(await tel(spec));
  return uit;
}

function tijd() {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

// ── Twee dingen die een RIJTELLING niet ziet ────────────────────────────────
//  Een telling van 1 vóór en 1 ná zegt niets over de INHOUD van die ene rij.
//  Twee velden veranderen wél tussen runs en bepalen of een tweede waarnemer
//  op dezelfde uitgangspositie begint als de eerste.

/** Workflowstatus van de preview-fixture. De seed zet `status` bewust alleen
 *  bij de eerste insert (statusovergangen zijn bewaakt en niet omkeerbaar), dus
 *  een handmatige rondgang die de status opschuift laat die staan. Dat is een
 *  legitieme keuze én een breuk met "Preview vanaf leeg reproduceerbaar": de
 *  volgende waarnemer begint waar de vorige ophield. Meten, niet verzwijgen. */
async function besluitStatus() {
  const { data, error } = await admin
    .from("decision_objects")
    .select("status")
    .eq("id", FIX.previewDecision1)
    .maybeSingle();
  if (error) return `FOUT: ${error.message}`;
  return data?.status ?? "(geen rij)";
}

/** Host→fonds-mapping. Zonder rij in `tenant_domains` is de gevulde dataset
 *  niet via de Preview-UI bereikbaar — precies de blokkade van 23-08 15:06.
 *  De seed maakt die rij NIET; hij is met de hand aangelegd. Dit is dus de
 *  reproduceerbaarheidscontrole: bouw Preview opnieuw op en dit valt om. */
async function hostMapping() {
  const { count, error } = await admin
    .from("tenant_domains")
    .select("*", { count: "exact", head: true })
    .eq("fonds_id", FONDS_ID)
    .eq("actief", true);
  if (error) return { aantal: null, fout: error.message };
  return { aantal: count ?? 0 };
}

// ── Uitvoering ──────────────────────────────────────────────────────────────
console.log(`OMG-1 uitvoeringsbewijs — projectref ${projectRef} (${doelomgeving})\n`);

const statusVooraf = await besluitStatus();

const run1Start = tijd();
await seed(admin);
const run1Eind = tijd();
const na1 = await meet(ENTITEITEN);
const kosten1 = await meet(KOSTEN);
const status1 = await besluitStatus();

const run2Start = tijd();
await seed(admin);
const run2Eind = tijd();
const na2 = await meet(ENTITEITEN);
const kosten2 = await meet(KOSTEN);
const status2 = await besluitStatus();
const leeg = await meet(MOET_LEEG);
const host = await hostMapping();

// ── Oordeel ─────────────────────────────────────────────────────────────────
const drift = na1
  .map((r, i) => ({ naam: r.naam, run1: r.aantal, run2: na2[i].aantal }))
  .filter((r) => r.run1 !== r.run2);
const kostenDrift = kosten1
  .map((r, i) => ({ naam: r.naam, run1: r.aantal, run2: kosten2[i].aantal }))
  .filter((r) => r.run1 !== r.run2);
const leegFout = leeg.filter((r) => (r.aantal ?? 0) > 0);
const ontbreekt = na2.filter((r) => (r.aantal ?? 0) === 0 || r.fout);

// ── Rapport, plakklaar onder issue #148 ─────────────────────────────────────
const R = [];
R.push("### Uitvoeringsbewijs Preview-seed\n");
R.push(`Projectref: \`${projectRef}\` · doelomgeving: \`${doelomgeving}\`\n`);
R.push("| Run | Start (UTC) | Eind (UTC) |");
R.push("|---|---|---|");
R.push(`| 1 | ${run1Start} | ${run1Eind} |`);
R.push(`| 2 | ${run2Start} | ${run2Eind} |`);
R.push("\n#### Rijtelling per entiteit\n");
R.push("| Entiteit | Herkomst | Na run 1 | Na run 2 |");
R.push("|---|---|---:|---:|");
for (const [i, r] of na1.entries()) {
  R.push(`| ${r.naam} | ${r.herkomst} | ${r.fout ? "FOUT" : r.aantal} | ${na2[i].fout ? "FOUT" : na2[i].aantal} |`);
}
R.push("\n#### Idempotentie\n");
R.push(
  drift.length === 0
    ? "Tweede run gaf dezelfde eindtoestand: **elke entiteit ongewijzigd**."
    : `**AFWIJKING** — ${drift.map((d) => `${d.naam}: ${d.run1} → ${d.run2}`).join("; ")}`
);
R.push("\n#### Kosten van de seed\n");
R.push("| Wat | Na run 1 | Na run 2 |");
R.push("|---|---:|---:|");
for (const [i, r] of kosten1.entries()) {
  R.push(`| ${r.naam} | ${r.fout ? "n.v.t." : r.aantal} | ${kosten2[i].fout ? "n.v.t." : kosten2[i].aantal} |`);
}
R.push(
  kostenDrift.length === 0
    ? "\nGeen enkele teller liep op tussen de twee runs: de seed veroorzaakt **geen ingest, geen embedding en geen modelcall**."
    : `\n**LET OP** — een tellerliep op: ${kostenDrift.map((d) => `${d.naam}: ${d.run1} → ${d.run2}`).join("; ")}`
);
R.push("\n#### Uitgangspositie: wat een rijtelling niet ziet\n");
R.push("| Wat | Vóór run 1 | Na run 1 | Na run 2 |");
R.push("|---|---|---|---|");
R.push(`| status van het preview-besluit | ${statusVooraf} | ${status1} | ${status2} |`);
if (statusVooraf !== "(geen rij)" && statusVooraf !== "concept" && status2 === statusVooraf) {
  R.push(
    `\n**De seed heeft de status NIET teruggezet** (\`${statusVooraf}\`). Dat is bewust — ` +
      "statusovergangen zijn bewaakt en niet omkeerbaar — maar het betekent dat een tweede " +
      "waarnemer níet op dezelfde uitgangspositie begint als de eerste. Wie Preview echt vanaf " +
      "leeg wil reproduceren, moet de rij eerst verwijderen. Zie OMG-1 §7, criterium " +
      '"Preview vanaf leeg reproduceerbaar".'
  );
}
R.push("\n#### Bereikbaarheid via de UI (tenant_domains)\n");
R.push(
  host.fout
    ? `Niet te bepalen: ${host.fout}`
    : host.aantal > 0
      ? `${host.aantal} actieve host→fonds-mapping voor het testfonds. **Deze rij maakt de seed niet** — ` +
        "hij is met de hand aangelegd en verdwijnt bij een herbouw van Preview vanaf leeg."
      : "**GEEN actieve host→fonds-mapping.** De gevulde dataset is dan niet via de Preview-UI " +
        "bereikbaar en een routeproef levert geen bewijs over capability-handhaving — de blokkade " +
        "van 23-08 15:06."
);
R.push("\n#### VEN-2: stemmingen blijven ongezaaid\n");
R.push(
  leegFout.length === 0
    ? "Bevestigd: nul stemmingen. De modulevlag bepaalt de zichtbaarheid, geen lege lijst."
    : `**FOUT** — er staan stemmingen: ${leegFout.map((r) => `${r.naam}=${r.aantal}`).join(", ")}`
);
if (ontbreekt.length > 0) {
  R.push("\n#### Ontbrekende fixtures\n");
  for (const r of ontbreekt) R.push(`- ${r.naam}: ${r.fout ?? "0 rijen"}`);
}

const rapport = R.join("\n");
console.log(rapport);

const gefaald =
  drift.length > 0 || leegFout.length > 0 || ontbreekt.length > 0 || (host.aantal ?? 0) === 0;
if (gefaald) {
  console.error("\nBEWIJS NIET SLUITEND — zie de gemarkeerde regels hierboven.");
  process.exitCode = 1;
}
