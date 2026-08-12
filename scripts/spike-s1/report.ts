// ============================================================================
//  report.ts — schrijf het meetrapport (Markdown) + faalpatronen.
// ----------------------------------------------------------------------------
//  Draai:  ./node_modules/.bin/tsx scripts/spike-s1/report.ts
//  Leest output/units.json + golden_set.json, berekent de metrieken (measure.ts)
//  en schrijft scripts/spike-s1/output/meetrapport.md met:
//   - cijfers per concept en per type,
//   - een G1-oordeel per concepttype + overall go/no-go-advies,
//   - een lijst faalpatronen (met de echte tekst) als input voor T7/T8.
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Unit, GoldenUnit } from "./types";
import { computeMetrieken, G1, type CelMetriek, type BeoordeeldeUnit } from "./measure";

const HIER = dirname(fileURLToPath(import.meta.url));

function pct(x: number | null): string {
  return x == null ? "—" : `${(x * 100).toFixed(0)}%`;
}

function rij(naam: string, c: CelMetriek, metG1: boolean): string {
  const g1 = metG1 ? ` | ${c.g1_green ? "🟢 groen" : "🔴 rood"}` : "";
  return (
    `| ${naam} | ${c.golden_total} | ${c.extracted_total} | ${pct(c.recall)} | ` +
    `**${pct(c.binding_precision)}** | ${pct(c.misbinding_rate)} | ${pct(
      c.value_accuracy
    )} | ${pct(c.evidence_accuracy)}${g1} |`
  );
}

function knip(s: string, n = 160): string {
  const enkel = s.replace(/\s+/g, " ").trim();
  return enkel.length > n ? enkel.slice(0, n) + "…" : enkel;
}

function main() {
  const unitsPad = join(HIER, "output", "units.json");
  const goldenPad = join(HIER, "golden_set.json");
  if (!existsSync(unitsPad)) {
    console.error("output/units.json ontbreekt — draai eerst extract.ts.");
    process.exit(1);
  }
  const units: Unit[] = JSON.parse(readFileSync(unitsPad, "utf8"));
  const golden: GoldenUnit[] = existsSync(goldenPad)
    ? JSON.parse(readFileSync(goldenPad, "utf8"))
    : [];
  if (golden.length === 0) {
    console.error("golden_set.json is leeg — geen ground truth om tegen te meten.");
    process.exit(1);
  }

  const m = computeMetrieken(units, golden);
  const documenten = [...new Set(units.map((u) => u.document))];

  const L: string[] = [];
  L.push("# S1 — Meetrapport: extractie + conceptbinding\n");
  L.push(
    `> Gegenereerd door \`report.ts\`. Bron: ${units.length} geëxtraheerde unit(s) ` +
      `uit ${documenten.length} document(en), ${golden.length} golden unit(s).\n`
  );
  L.push(
    `**G1-drempels** (precision-first): bindings-precision ≥ ${pct(
      G1.binding_precision
    )}, waarde-accuraatheid ≥ ${pct(G1.value_accuracy)}, bron-accuraatheid ≥ ${pct(
      G1.evidence_accuracy
    )}. Recall wordt gerapporteerd, geen harde drempel.\n`
  );

  // ── Per concept ──
  L.push("## Per concept\n");
  L.push(
    "| concept | #golden | #extract | recall | bind-precision | misbinding | waarde | bron | G1 |"
  );
  L.push("|---|--:|--:|--:|--:|--:|--:|--:|:--:|");
  for (const [naam, c] of Object.entries(m.perConcept)) L.push(rij(naam, c, true));
  L.push("");

  // ── Per type ──
  L.push("## Per type\n");
  L.push(
    "| type | #golden | #extract | recall | bind-precision | misbinding | waarde | bron | G1 |"
  );
  L.push("|---|--:|--:|--:|--:|--:|--:|--:|:--:|");
  for (const [t, c] of Object.entries(m.perType))
    if (c.golden_total > 0 || c.extracted_total > 0) L.push(rij(t, c, true));
  L.push("");

  // ── Overall ──
  L.push("## Overall\n");
  L.push("| | #golden | #extract | recall | bind-precision | misbinding | waarde | bron |");
  L.push("|---|--:|--:|--:|--:|--:|--:|--:|");
  L.push(rij("alles", m.overall, false));
  L.push("");

  // ── G1-advies ──
  L.push("## G1 — go/no-go-advies\n");
  const groen = Object.entries(m.perConcept).filter(([, c]) => c.g1_green);
  const rood = Object.entries(m.perConcept).filter(([, c]) => !c.g1_green);
  const schoonNumeriekGroen = Object.entries(m.perConcept).some(
    ([, c]) =>
      c.g1_green && (c.type === "percentage" || c.type === "date" || c.type === "amount")
  );
  L.push(
    groen.length > 0
      ? `**Halen de drempels (start-catalogus):** ${groen.map(([n]) => `\`${n}\``).join(", ")}.`
      : "**Geen enkel concept haalt alle G1-drempels.**"
  );
  L.push(
    rood.length > 0
      ? `**Halen de drempels (nog) niet:** ${rood.map(([n]) => `\`${n}\``).join(", ")}.`
      : "**Alle geteste concepten halen de drempels.**"
  );
  L.push("");
  if (schoonNumeriekGroen) {
    L.push(
      "**Advies: G1 GROEN (door naar T7/T8).** Er is een levensvatbare, betrouwbare " +
        "subset: minimaal één schoon numeriek/datum-concept haalt de drempels. Bouw de " +
        "start-catalogus met de groene concepten; stel de rode uit tot na extractie-" +
        "verbetering."
    );
  } else {
    L.push(
      "**Advies: G1 ROOD.** Zelfs de schone numerieke/datum-concepten halen de bindings-" +
        "precision niet. Los eerst de extractie/binding op (normalisatie, disambiguatie, " +
        "menselijke reviewstap) vóór T7/T8."
    );
  }
  L.push(
    "\n> Let op: de golden set kan onvolledig zijn; UNMATCHED-extracties tellen tegen " +
      "precision maar kunnen ook gemiste golden-labels zijn. Loop de faalpatronen na " +
      "vóór het definitieve oordeel.\n"
  );

  // ── Faalpatronen ──
  L.push("## Faalpatronen (input voor T7/T8)\n");

  const misbound = m.beoordeeld.filter((u) => u.status === "MISBOUND");
  faalBlok(
    L,
    "🔴 Foutbindingen (waarde aan verkeerd concept — de gevaarlijke fout)",
    misbound,
    (u) =>
      `\`${u.concept}\` ⟵ hoort bij \`${u.misbound_naar}\` · ${u.document} p${u.page} · ` +
      `waarde \`${u.value_raw}\` · "${knip(u.evidence)}"`
  );

  const waardeFout = m.beoordeeld.filter(
    (u) => u.status === "CORRECT" && u.value_ok === false
  );
  faalBlok(
    L,
    "🟠 Waarde-fouten (correct gebonden, foute genormaliseerde waarde)",
    waardeFout,
    (u) =>
      `\`${u.concept}\` · ${u.document} p${u.page} · geëxtraheerd \`${JSON.stringify(
        u.value_normalized
      )}\` vs golden \`${JSON.stringify(u.golden_value)}\` · raw \`${u.value_raw}\``
  );

  const evidenceFout = m.beoordeeld.filter((u) => !u.evidence_ok);
  faalBlok(
    L,
    "🟠 Bron-fouten (evidence niet letterlijk in paginatekst — hallucinatie-risico)",
    evidenceFout,
    (u) => `\`${u.concept}\` · ${u.document} p${u.page} · "${knip(u.evidence)}"`
  );

  const unmatched = m.beoordeeld.filter((u) => u.status === "UNMATCHED");
  faalBlok(
    L,
    "⚪ Zonder golden-match (hallucinatie óf gemist golden-label — handmatig triëren)",
    unmatched,
    (u) =>
      `\`${u.concept}\` · ${u.document} p${u.page} · waarde \`${u.value_raw}\` · ` +
      `"${knip(u.evidence)}"`
  );

  faalBlok(
    L,
    "🔵 Gemiste golden units (recall-verlies — niet gevonden door extractie)",
    m.gemistGolden,
    (g) =>
      `\`${g.concept}\` · ${g.document} p${g.page} · waarde \`${JSON.stringify(
        g.value_normalized
      )}\` · "${knip(g.evidence)}"`
  );

  const uit = join(HIER, "output", "meetrapport.md");
  writeFileSync(uit, L.join("\n") + "\n");
  console.log(`Meetrapport geschreven → ${uit}`);
  console.log(
    `Samenvatting: ${groen.length}/${Object.keys(m.perConcept).length} concepten G1-groen; ` +
      `overall bind-precision ${pct(m.overall.binding_precision)}.`
  );
}

function faalBlok<T>(
  L: string[],
  titel: string,
  items: T[],
  render: (t: T) => string
): void {
  L.push(`### ${titel} — ${items.length}\n`);
  if (items.length === 0) {
    L.push("_geen_\n");
    return;
  }
  for (const it of items.slice(0, 40)) L.push(`- ${render(it)}`);
  if (items.length > 40) L.push(`- … en nog ${items.length - 40} meer`);
  L.push("");
}

main();
