// Fase 3: zet grote paginatitels (elke <h1>) op font-serif (Newsreader).
// Body en overige koppen/labels blijven font-sans (Inter).
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const files = execSync(`grep -rIl '<h1 className="' app`, { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);

let count = 0;
for (const file of files) {
  let src = readFileSync(file, "utf8");
  const before = src;
  // Voeg 'font-serif ' toe direct na de openingsquote van de h1-className,
  // tenzij die al aanwezig is.
  src = src.replace(/<h1 className="(?!font-serif\b)/g, () => {
    count++;
    return '<h1 className="font-serif ';
  });
  if (src !== before) writeFileSync(file, src);
}
console.log(`font-serif toegevoegd aan ${count} h1-titels in ${files.length} bestanden.`);
