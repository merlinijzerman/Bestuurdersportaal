// Vergelijk uitsluitend de inhoudelijke B0-kwaliteitsuitvoer mét en zonder de
// volledige HNSW-index. De twee runs staan in aparte lokale uitvoermappen.
import fs from "node:fs";
import path from "node:path";

const basis = process.argv[2];
const zonder = process.argv[3];
const stand = process.argv[4];
if (!basis || !zonder || !["b0", "b5000"].includes(stand)) {
  throw new Error("Gebruik: node r1b-vergelijk-indexstanden.mjs <basisdir> <zonderdir> b0|b5000");
}
const lees = (dir) => fs.readFileSync(path.join(dir, `kwaliteit-${stand}.jsonl`), "utf8")
  .trim().split("\n").map((line) => JSON.parse(line));
const a = lees(basis), b = lees(zonder);
const sleutel = (x) => `${x.route}|${x.cel}`;
const bMap = new Map(b.map((x) => [sleutel(x), x]));
const ontbreekt = a.filter((x) => !bMap.has(sleutel(x))).map(sleutel);
const verschil = a.filter((x) => bMap.has(sleutel(x)) &&
  JSON.stringify(x) !== JSON.stringify(bMap.get(sleutel(x)))).map(sleutel);
const routes = Object.fromEntries(["exact", "R0", "definitief"].map((route) => [route,
  { vragen: a.filter((x) => x.route === route).length,
    lekken: a.filter((x) => x.route === route).reduce((n, x) => n + x.lek, 0),
    buiten_filter: a.filter((x) => x.route === route).reduce((n, x) => n + x.buiten, 0) }]));
const result = { stand, basis: a.length, zonder: b.length, routes,
  ontbreekt, verschil, gelijk: a.length === b.length && !ontbreekt.length && !verschil.length };
console.log(JSON.stringify(result, null, 2));
if (!result.gelijk || Object.values(routes).some((x) => x.lekken || x.buiten_filter)) process.exitCode = 1;
