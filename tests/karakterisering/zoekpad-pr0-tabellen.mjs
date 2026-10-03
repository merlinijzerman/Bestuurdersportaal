// ============================================================================
//  PR 0 zoekpad-herontwerp — LOKAAL MEETONDERZOEK (geen CI).
//  Zet de JSON-uitvoer van zoekpad-pr0-meting.mjs om in markdown-tabellen voor
//  ZOEKPAD-HERONTWERP-PR0-RAPPORT.md. Puur lezen; geen database.
//    node tests/karakterisering/zoekpad-pr0-tabellen.mjs [--uit <dir>] [--standen b0,b5000,cpu025]
// ============================================================================
import fs from "node:fs";
import path from "node:path";

const arg = (naam, std) => { const i = process.argv.indexOf(`--${naam}`); return i > 0 ? process.argv[i + 1] : std; };
const UIT = arg("uit", "tests/karakterisering/uitvoer/zoekpad-pr0");
const STANDEN = arg("standen", "b0,b5000,cpu025").split(",");
const lees = (f) => (fs.existsSync(path.join(UIT, f)) ? JSON.parse(fs.readFileSync(path.join(UIT, f), "utf8")) : null);
const fmt = (x) => (x == null ? "–" : typeof x === "number" ? (Number.isInteger(x) ? String(x) : x.toFixed(1)) : String(x));

for (const stand of STANDEN) {
  const m = lees(`meting-${stand}-samenvatting.json`);
  if (!m) continue;
  console.log(`\n### Meting — stand \`${stand}\` (ms per aanroep; buffers = shared hit+read)\n`);
  const varianten = [...new Set(m.map((r) => r.variant))];
  for (const jwt of [...new Set(m.map((r) => r.jwt))]) {
    console.log(`\n**JWT ≈ ${jwt === "09" ? "0,9" : "1,5"} kB**\n`);
    console.log("| variant | " + [...new Set(m.map((r) => r.route))].map((r) => `${r} p50 / p95 / max / buffers`).join(" | ") + " |");
    const routes = [...new Set(m.map((r) => r.route))];
    console.log("|---|" + routes.map(() => "---").join("|") + "|");
    for (const v of varianten) {
      const cellen = routes.map((route) => {
        const r = m.find((x) => x.route === route && x.jwt === jwt && x.variant === v);
        if (!r || !r.n) return "–";
        return `${fmt(r.p50)} / ${fmt(r.p95)} / ${fmt(r.max)} / ${fmt(r.buffers_gem)}${r.fouten ? ` (${r.fouten} fouten)` : ""}`;
      });
      console.log(`| ${v} | ${cellen.join(" | ")} |`);
    }
  }
  // Per pilotvraag (JWT 0,9 kB), strikt + verslapt + hybride.
  console.log(`\n**Per pilotvraag (JWT 0,9 kB), p50 / p95 ms**\n`);
  const pilots = ["bedoeling", "norm", "gecombineerd", "reglement"];
  const routes = [...new Set(m.map((r) => r.route))];
  for (const v of ["strikt", "verslapt", "hybride", "hybride_iteratief"]) {
    console.log(`\n_${v}_\n`);
    console.log("| vraag | " + routes.join(" | ") + " |");
    console.log("|---|" + routes.map(() => "---").join("|") + "|");
    for (const pv of pilots) {
      const cellen = routes.map((route) => {
        const r = m.find((x) => x.route === route && x.jwt === "09" && x.variant === v);
        const q = r?.per_vraag?.[pv];
        return q?.n ? `${fmt(q.p50)} / ${fmt(q.p95)}` : "–";
      });
      console.log(`| ${pv} | ${cellen.join(" | ")} |`);
    }
  }
}

for (const stand of STANDEN) {
  const l = lees(`lekmatrix-${stand}.json`);
  if (!l) continue;
  console.log(`\n### Lek-/pariteitsmatrix — stand \`${stand}\` (lekken: ${l.lekken})\n`);
  const scen = [...new Set(Object.values(l.matrix).flatMap((a) => Object.keys(a).map((k) => k.split("/")[0])))];
  console.log("| actor | route | " + scen.join(" | ") + " |");
  console.log("|---|---|" + scen.map(() => "---").join("|") + "|");
  for (const [actor, cellen] of Object.entries(l.matrix)) {
    for (const route of ["R0", "R1", "R2"]) {
      const rij = scen.map((s) => {
        const c = cellen[`${s}/${route}`];
        if (!c) return "–";
        if (c.uitkomst) return c.uitkomst;
        return `${c.n}/${c.verwacht_n}${c.lek ? ` **LEK ${c.buiten_verwachting}**` : c.ontbrekend ? ` (−${c.ontbrekend})` : " ✓"}`;
      });
      console.log(`| ${actor} | ${route} | ${rij.join(" | ")} |`);
    }
  }
  console.log(`\n_Negatieve controles (p_lek) — stand \`${stand}\`_\n`);
  console.log("| p_lek | scenario | R1 | R2 |");
  console.log("|---|---|---|---|");
  const keys = [...new Set(Object.keys(l.negatieve_controles).map((k) => k.split("/")[0]))];
  for (const k of keys) {
    const a = l.negatieve_controles[`${k}/R1`], b = l.negatieve_controles[`${k}/R2`];
    const t = (c) => (!c ? "–" : c.fout ? `fout: ${c.fout}` : c.rood ? `rood (${c.buiten_verwachting} buiten)` : c.rls_dekt ? "niet rood — RLS dekt" : "NIET ROOD");
    console.log(`| ${k} | ${a?.scenario ?? b?.scenario} | ${t(a)} | ${t(b)} |`);
  }
  if (l.bevindingen?.length) console.log("\nBevindingen: " + l.bevindingen.map((b) => `\`${b}\``).join("; "));
}

for (const stand of STANDEN) {
  const v = lees(`vector-${stand}.json`);
  if (!v) continue;
  console.log(`\n### Vector — stand \`${stand}\` (recall@40 t.o.v. exacte KNN mét filters; ms p50; buffers)\n`);
  console.log("| fonds | vq | scope | route | variant | teruggegeven | recall@40 | p50 ms | buffers |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const r of v) console.log(`| ${r.fonds} | ${r.vq} | ${r.scope} | ${r.route} | ${r.variant} | ${r.teruggegeven} | ${r.recall_at_40} | ${fmt(r.p50)} | ${r.buffers_gem} |`);
}

for (const stand of STANDEN) {
  const i = lees(`invariantie-${stand}-vs-b0.json`);
  if (!i) continue;
  console.log(`\n### Invariantie fonds A — \`${stand}\` t.o.v. \`b0\`\n`);
  console.log("| scenario/route | id's b0 | id's nu | id's gelijk | scores gelijk |");
  console.log("|---|---|---|---|---|");
  for (const [k, r] of Object.entries(i)) console.log(`| ${k} | ${r.ids_b0} | ${r.ids_nu} | ${r.ids_gelijk ? "ja" : "**nee**"} | ${r.scores_gelijk ? "ja" : "**nee**"} |`);
}

for (const stand of STANDEN) {
  const h = lees(`hypothesen-${stand}.json`);
  if (!h) continue;
  console.log(`\n### Hypothesen-metingen — stand \`${stand}\`\n`);
  console.log("```json\n" + JSON.stringify(h, null, 1) + "\n```");
}
