// ============================================================================
//  report.ts — schrijf het meetrapport (Markdown) + faalpatronen.
// ----------------------------------------------------------------------------
//  Draai:  ./node_modules/.bin/tsx scripts/spike-s1/report.ts
//  Leest output/units.json + golden_set.json, berekent de metrieken (measure.ts)
//  en schrijft scripts/spike-s1/output/meetrapport.md met:
//   - cijfers per concept en per type (document×concept-granulariteit),
//   - een G1-oordeel per concept + overall go/no-go-advies,
//   - faalpatronen (met de echte tekst) als input voor T7/T8.
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Unit, GoldenUnit } from "./types";
import { computeMetrieken, G1, type CelMetriek } from "./measure";

const HIER = dirname(fileURLToPath(import.meta.url));

function pct(x: number | null): string {
  return x == null ? "—" : `${(x * 100).toFixed(0)}%`;
}

function rij(naam: string, c: CelMetriek, metG1: boolean): string {
  const g1 = metG1 ? ` | ${c.g1_green ? "🟢 groen" : "🔴 rood"}` : "";
  return (
    `| ${naam} | ${c.golden_cells} | ${c.extracted_total} | ${pct(c.recall)} | ` +
    `**${pct(c.binding_precision)}** | ${pct(c.misbinding_rate)} | ${pct(
      c.evidence_accuracy
    )} | ${c.correct}/${c.misbound}/${c.spurious}${g1} |`
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
      `uit ${documenten.length} document(en); golden op documentniveau ` +
      `(${golden.length} document×concept-cellen).\n`
  );
  L.push(
    "**Granulariteit:** document × concept. Per cel is er één canonieke waarde + " +
      "een distractor-lijst. `C/M/S` = CORRECT / MISBOUND / SPURIOUS. Op dit niveau " +
      "valt waarde-accuraatheid samen met binding-precision (één juiste waarde per cel).\n"
  );
  L.push(
    `**G1-drempels** (precision-first): bindings-precision ≥ ${pct(
      G1.binding_precision
    )}, bron-accuraatheid ≥ ${pct(G1.evidence_accuracy)}. Recall wordt gerapporteerd, ` +
      "geen harde drempel.\n"
  );

  // ── Per concept ──
  L.push("## Per concept\n");
  L.push("| concept | #cellen | #extract | recall | bind-precision | misbinding | bron | C/M/S | G1 |");
  L.push("|---|--:|--:|--:|--:|--:|--:|:--:|:--:|");
  for (const [naam, c] of Object.entries(m.perConcept)) L.push(rij(naam, c, true));
  L.push("");

  // ── Per type ──
  L.push("## Per type\n");
  L.push("| type | #cellen | #extract | recall | bind-precision | misbinding | bron | C/M/S | G1 |");
  L.push("|---|--:|--:|--:|--:|--:|--:|:--:|:--:|");
  for (const [t, c] of Object.entries(m.perType))
    if (c.golden_cells > 0 || c.extracted_total > 0) L.push(rij(t, c, true));
  L.push("");

  // ── Overall ──
  L.push("## Overall\n");
  L.push("| | #cellen | #extract | recall | bind-precision | misbinding | bron | C/M/S |");
  L.push("|---|--:|--:|--:|--:|--:|--:|:--:|");
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
        "start-catalogus met de groene concepten; stel de rode uit tot na extractie-/" +
        "normalisatie-verbetering."
    );
  } else {
    L.push(
      "**Advies: G1 ROOD.** Zelfs de schone numerieke/datum-concepten halen de bindings-" +
        "precision niet. Los eerst extractie/normalisatie/disambiguatie op (evt. menselijke " +
        "reviewstap) vóór T7/T8."
    );
  }
  L.push("");

  // ── Faalpatronen ──
  L.push("## Faalpatronen (input voor T7/T8)\n");

  const misbound = m.beoordeeld.filter((u) => u.status === "MISBOUND");
  faalBlok(
    L,
    "🔴 Foutbindingen (distractor aan concept gebonden — de gevaarlijke fout)",
    misbound,
    (u) =>
      `\`${u.concept}\` · ${u.document} · bond distractor \`${JSON.stringify(
        u.matched_distractor
      )}\` i.p.v. canoniek \`${JSON.stringify(u.golden_canonical)}\` · raw \`${u.value_raw}\` · ` +
      `"${knip(u.evidence)}"`
  );

  const spurious = m.beoordeeld.filter((u) => u.status === "SPURIOUS");
  faalBlok(
    L,
    "🟠 Spurious (waarde noch canoniek noch bekende distractor — norm-fout/afgeleide/hallucinatie)",
    spurious,
    (u) =>
      `\`${u.concept}\` · ${u.document} · raw \`${u.value_raw}\` → norm \`${JSON.stringify(
        u.value_normalized
      )}\`${u.norm_ok ? "" : " (norm faalde)"} · "${knip(u.evidence)}"`
  );

  const evidenceFout = m.beoordeeld.filter((u) => !u.evidence_ok);
  faalBlok(
    L,
    "🟠 Bron-fouten (evidence niet letterlijk in paginatekst — hallucinatie-risico)",
    evidenceFout,
    (u) => `\`${u.concept}\` · ${u.document} p${u.page} · "${knip(u.evidence)}"`
  );

  faalBlok(
    L,
    "🔵 Gemiste cellen (geen CORRECTe extractie — recall-verlies)",
    m.gemisteCellen,
    (g) =>
      `\`${g.concept}\` · ${g.document}${g.status ? ` [${g.status}]` : ""} · ` +
      `canoniek \`${JSON.stringify(g.canonical)}\``
  );

  const uit = join(HIER, "output", "meetrapport.md");
  writeFileSync(uit, L.join("\n") + "\n");
  console.log(`Meetrapport geschreven → ${uit}`);
  console.log(
    `Samenvatting: ${groen.length}/${Object.keys(m.perConcept).length} concepten G1-groen; ` +
      `overall bind-precision ${pct(m.overall.binding_precision)}, ` +
      `misbinding ${pct(m.overall.misbinding_rate)}.`
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
  for (const it of items.slice(0, 50)) L.push(`- ${render(it)}`);
  if (items.length > 50) L.push(`- … en nog ${items.length - 50} meer`);
  L.push("");
}

main();
