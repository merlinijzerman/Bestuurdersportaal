// Volledige extractie-QA met dezelfde engine als de app (unpdf/pdfjs).
// Classificeert elke PDF: OK (tekstlaag) | OCR (geldig maar 0 tekst = beeld) |
// CORRUPT (invalid structure — OCR helpt niet) | FOUT (overig).
import { getDocumentProxy } from "unpdf";
import { readFile, readdir, writeFile } from "node:fs/promises";

const ROOT = "/sessions/inspiring-affectionate-tesla/mnt/MVP bestuurdersportaal/gedownloade_documenten";
const LEEG_PP = 50;

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.toLowerCase().endsWith(".pdf")) yield p;
  }
}

const rows = [];
for await (const pad of walk(ROOT)) {
  const org = pad.split("/").slice(-2)[0];
  const file = pad.split("/").pop();
  const rec = { org, file, status: "?", paginas: null, chars: 0, pp: 0 };
  try {
    const buf = await readFile(pad);
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const n = pdf.numPages;
    let chars = 0;
    for (let i = 1; i <= n; i++) {
      const c = await (await pdf.getPage(i)).getTextContent();
      chars += c.items.map((it) => it.str || "").join("").replace(/\s+/g, "").length;
    }
    rec.paginas = n; rec.chars = chars; rec.pp = n ? Math.round(chars / n) : 0;
    rec.status = rec.pp < LEEG_PP ? "OCR" : "OK";
  } catch (e) {
    rec.status = /invalid pdf structure/i.test(e.message) ? "CORRUPT" : "FOUT";
    rec.fout = String(e.message).slice(0, 60);
  }
  rows.push(rec);
}

// Dedup naar unieke basisnaam; beste status wint.
const basis = (n) => n.replace(/_\d+\.pdf$/i, ".pdf");
const rank = { OK: 3, OCR: 2, CORRUPT: 1, FOUT: 0 };
const best = {};
for (const r of rows) {
  const b = basis(r.file);
  if (!(b in best) || rank[r.status] > rank[best[b].status]) best[b] = r;
}
const uniq = Object.values(best);
const tel = (arr) => arr.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
const cAll = tel(rows), cU = tel(uniq);

console.log(`BESTANDEN: ${rows.length}  |  UNIEK: ${uniq.length}`);
console.log("ruwe bestanden:", JSON.stringify(cAll));
console.log("unieke docs   :", JSON.stringify(cU));
console.log("--- uniek per organisatie (alleen probleemstatussen) ---");
const per = {};
for (const r of uniq) if (r.status !== "OK") (per[r.org] ??= {}), (per[r.org][r.status] = (per[r.org][r.status] || 0) + 1);
for (const [o, c] of Object.entries(per)) console.log(`  ${o}:`, JSON.stringify(c));
console.log("--- unieke OCR-kandidaten (beeld-only) ---");
for (const r of uniq.filter((r) => r.status === "OCR").sort((a,b)=>a.org.localeCompare(b.org)))
  console.log(`  [OCR ${r.paginas}pg] ${r.org}/${basis(r.file).slice(0, 70)}`);
console.log("--- unieke CORRUPT (OCR helpt NIET; opnieuw downloaden) ---");
for (const r of uniq.filter((r) => r.status === "CORRUPT"))
  console.log(`  ${r.org}/${basis(r.file).slice(0, 70)}`);
await writeFile("/sessions/inspiring-affectionate-tesla/mnt/outputs/unpdf_scan.json", JSON.stringify(uniq, null, 2));
console.log("\nweggeschreven: unpdf_scan.json");
