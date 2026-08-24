// ============================================================================
//  W9 — Schema's uit de CODE lezen (voor de classifier over de eindstand).
// ----------------------------------------------------------------------------
//  De differentiële classifier (schema-niet-strenger.mjs) draaide in W8 over de
//  GENERATOROUTPUT. Na de W9-codemod staan de schema's in de routebestanden, en
//  na handwerk kunnen die afwijken van wat de generator opleverde. Stap 10 van het
//  ticket eist daarom dat de classifier de EINDSTAND toetst: de schema's zoals ze
//  in de code staan.
//
//  Dit leest het `schema:`-literal per handler uit de bron en EVALUEERT het met
//  `z` in scope (de literals zijn zelfstandige zod-expressies). Zo hoeven de
//  routemodules — die server-only deps meetrekken — niet geïmporteerd te worden.
//
//  Gebruik: geïmporteerd door schema-niet-strenger.mjs (--uit-code); als CLI toont
//  het per handler het geëxtraheerde literal.
// ============================================================================
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { bouwInventaris } from "./schema-inventaris.mjs";

/** Extraheert het schema-literal dat volgt op `schema:` binnen een spec-tekst,
 *  brace/paren/bracket-diepte-bewust zodat `z.object({...}).passthrough()` heel
 *  blijft. Stopt op de `}` die op diepte 0 de spec sluit. */
function leesSchemaLiteral(specTekst) {
  const pos = specTekst.indexOf("schema:");
  if (pos < 0) return null;
  let i = pos + "schema:".length;
  while (i < specTekst.length && /\s/.test(specTekst[i])) i++;
  const start = i;
  let diepte = 0;
  for (; i < specTekst.length; i++) {
    const c = specTekst[i];
    if (c === "{" || c === "(" || c === "[") diepte++;
    else if (c === ")" || c === "]") diepte--;
    else if (c === "}") {
      if (diepte === 0) break; // de spec-sluiter
      diepte--;
    }
  }
  return specTekst.slice(start, i).trim().replace(/,\s*$/, "");
}

/** Geeft de spec-tekst ({ ... }) voor één handler uit een bronbestand. Voor een
 *  inline withXRoute-spec: het object direct na `withXRoute(`. Voor een machineroute
 *  met named SPEC-const: de `const SPEC = { ... }`-definitie. */
function specTekstVoor(src, h) {
  if (h.wrapper === "withMachineRoute") {
    const m = /const\s+\w+\s*=\s*\{/.exec(src);
    if (!m) return null;
    return objectVanaf(src, src.indexOf("{", m.index));
  }
  const re = new RegExp(`export const ${h.methode}\\s*=\\s*withFondsRoute\\(\\s*\\{`);
  const m = re.exec(src);
  if (!m) return null;
  return objectVanaf(src, src.indexOf("{", m.index));
}

/** Het brace-gebalanceerde object vanaf de open-accolade op `open`. */
function objectVanaf(src, open) {
  let diepte = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") diepte++;
    else if (src[i] === "}") {
      diepte--;
      if (diepte === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

/** Map<`METHOD bestand`, {schema, bron, handler}> voor alle body-lezende handlers,
 *  met de schema's zoals ze in de CODE staan. `"geen-body"` → overgeslagen. */
export function leesSchemasUitCode() {
  const inv = bouwInventaris();
  const bronCache = new Map();
  const map = new Map();
  for (const h of inv) {
    if (!h.bodyLezend || h.wrapper === "GEEN") continue;
    if (!bronCache.has(h.bestand)) bronCache.set(h.bestand, readFileSync(h.bestand, "utf8"));
    const src = bronCache.get(h.bestand);
    const specTekst = specTekstVoor(src, h);
    if (!specTekst) continue;
    const literal = leesSchemaLiteral(specTekst);
    if (!literal || literal === '"geen-body"') continue;
    let schema;
    try {
      schema = new Function("z", `return (${literal});`)(z);
    } catch (e) {
      throw new Error(`Kon schema-literal niet evalueren voor ${h.methode} ${h.bestand}: ${e.message}\n  ${literal}`);
    }
    // guarded = velden die het schema TYPEERT (z.string/number/boolean i.p.v. unknown),
    // afgeleid uit het literal. Zelfde begrip als in de generator; de classifier
    // slaat mutatieklassen over op guarded velden.
    const guarded = (h.velden || []).filter((v) =>
      new RegExp(`${JSON.stringify(v)}:\\s*z\\.(string|number|boolean)\\(`).test(literal)
    );
    map.set(`${h.methode} ${h.bestand}`, { schema, bron: literal, guarded, handler: h });
  }
  return map;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const map = leesSchemasUitCode();
  console.log(`Schema's uit de code — ${map.size} body-lezende handlers\n`);
  for (const [sleutel, { bron }] of [...map.entries()].sort()) {
    console.log(`// ${sleutel}`);
    console.log(`${bron.slice(0, 120)}${bron.length > 120 ? " …" : ""}\n`);
  }
}
