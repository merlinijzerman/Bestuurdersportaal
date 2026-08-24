// ============================================================================
//  W8 — Differentiële classifier: "geen schema is strenger dan de code".
// ----------------------------------------------------------------------------
//  Het VANGNET van W8 (PLAN §5, ticket §3/§8). Niet structureel (de typeof-checks
//  parsen), maar DIFFERENTIEEL: bewijs dat elk conceptschema élke body accepteert
//  die de huidige code accepteert. De bekend-goede bodies komen uit het
//  karakteriseringsharnas (schema-corpus.mjs) — dat is groen, dus elke body erin
//  is per constructie een body die de route vandaag verwerkt.
//
//  Vier eisen per handler:
//    Eis 1  — het schema accepteert elke corpus-body van zijn handler.
//    MK1    — + een onbekende extra sleutel: moet nog steeds parsen (de code
//             negeert onbekende velden; een strikt object zou ze weigeren).
//    MK2    — een optioneel veld WEGLATEN (undefined) parseert; en een ONGEGuarde
//             veldwaarde op `null` zetten parseert (de code tolereert null waar
//             geen typeof-guard staat). `.optional()` ≠ `.nullable()`.
//    MK3    — een ONGEGuarde veldwaarde als string ("5" i.p.v. 5) parseert (de
//             code coerceert of gebruikt het ruw; alleen een typeof-number-guard
//             mag string weigeren, en dan is het schema net zo streng als de code).
//
//  NEGATIEVE CONTROLE (--selftest, en altijd meegedraaid): een bewust TE STRENG
//  schema MOET rood geven. Een classifier die nooit rood is geweest, is niet
//  aangetoond (zelfde discipline als de OMG-1-grendel).
//
//  Handlers zonder corpus-body (onderbedekt, PLAN §2.4) kunnen niet differentieel
//  bewezen worden; die worden GERAPPORTEERD als niet-geverifieerd, niet groen
//  gerekend. Dat is een eerlijke lacune, geen stil gat.
//
//  Gebruik:
//    node tests/karakterisering/schema-niet-strenger.mjs           # classificeer alles
//    node tests/karakterisering/schema-niet-strenger.mjs --json
//    node tests/karakterisering/schema-niet-strenger.mjs --selftest # alleen de negatieve controle
//  Exit 0 als (a) de negatieve controle rood werd én (b) geen enkel schema strenger
//  is dan de code; anders 1.
// ============================================================================
import { z } from "zod";
import { pathToFileURL } from "node:url";
import { bouwCorpus } from "./schema-corpus.mjs";
import { genereerSchemas } from "./schema-genereer.mjs";
import { leesSchemasUitCode } from "./schema-uit-code.mjs";

// ── De 21 slikkers, geclassificeerd (PLAN §2.5) ───────────────────────────────
//  Een `.catch(() => ({}))`-handler vangt kapotte JSON op met `{}`. Onder
//  ENFORCE_SCHEMA parseert de wrapper de body VÓÓR de handler, dus kapotte JSON
//  wordt straks een 400. Of dat een GEDRAGSWIJZIGING is, hangt af van wat de
//  handler vandaag met `{}` doet:
//    - 400't hij toch op een missend veld  → GEEN wijziging (hooguit andere melding);
//    - draait hij door tot een 2xx op `{}`  → WÉL een wijziging (succes nu, 400 straks).
//  Statisch geclassificeerd (bron-inspectie 2026-08-24); W9 BEVESTIGT elk per
//  harnas-snapshot (kapotte body, vlag uit → waargenomen status). Geen conflict
//  met Eis 1: de classifier toetst GEPARSEERDE bodies; een geldige `{}` blijft
//  door het schema geaccepteerd. Deze lijst registreert de sanctie expliciet
//  zodat ze niet stil tegen Eis 1 in gaat.
export const GESANCTIONEERDE_SLIKKERS = [
  "POST app/api/classificatie/[id]/terugdraai/route.ts",   // opmerking optioneel → draait door
  "POST app/api/notulen/segmenten/[id]/bevestig/route.ts", // idempotentie = header; reden optioneel
  "PUT app/api/organisatieprofiel/route.ts",               // alle velden optioneel → upsert → 200
  "POST app/api/procedures/[id]/afschrift/route.ts",       // optionele leeswijzer → draait door
  "PATCH app/api/profiel/route.ts",                         // partiële update, alle velden optioneel → {ok:true}
  "PATCH app/api/risicos/[id]/route.ts",                    // {} → foutcode "geen_wijziging" → 200
  "POST app/api/vergaderingen/[id]/archief/route.ts",      // actie defaultt naar "archiveren" → draait door
];

/** Guarded velden mogen strenger zijn dan MK2/MK3 (de code weigert daar óók), dus
 *  die slaan we over bij de mutaties. `guarded` komt uit de generator. */
function toetsNietStrenger(schema, bodies, guarded = []) {
  const falen = [];
  const guardSet = new Set(guarded);

  for (const body of bodies) {
    // Eis 1 — accepteer de kale corpus-body.
    const basis = schema.safeParse(body);
    if (!basis.success) {
      falen.push({ eis: "1", body, reden: basis.error.issues.map((i) => `${i.path.join(".")}:${i.code}`) });
      continue; // vervolgmutaties zijn zinloos als de basis al faalt
    }
    const isObj = body && typeof body === "object" && !Array.isArray(body);

    // MK1 — onbekende extra sleutel.
    if (isObj) {
      const m1 = schema.safeParse({ ...body, __onbekend_veld__: "x" });
      if (!m1.success) falen.push({ eis: "MK1", body, reden: "onbekende sleutel geweigerd" });
    }

    // MK2 + MK3 — alleen op ONGEGuarde velden met een primitieve waarde.
    if (isObj) {
      for (const [veld, waarde] of Object.entries(body)) {
        if (guardSet.has(veld)) continue;
        // MK2: null i.p.v. de waarde.
        const m2 = schema.safeParse({ ...body, [veld]: null });
        if (!m2.success) falen.push({ eis: "MK2", body, veld, reden: "null geweigerd op ongeguard veld" });
        // MK3: getal → string.
        if (typeof waarde === "number") {
          const m3 = schema.safeParse({ ...body, [veld]: String(waarde) });
          if (!m3.success) falen.push({ eis: "MK3", body, veld, reden: "string geweigerd op ongeguard veld" });
        }
      }
      // MK2 — een optioneel veld weglaten moet parsen.
      const eersteVeld = Object.keys(body)[0];
      if (eersteVeld) {
        const zonder = { ...body };
        delete zonder[eersteVeld];
        const m2b = schema.safeParse(zonder);
        if (!m2b.success) falen.push({ eis: "MK2-weglaten", body, veld: eersteVeld, reden: "weglaten geweigerd" });
      }
    }
  }
  return { ok: falen.length === 0, falen };
}

// ── Negatieve controle: een bewust te streng schema MOET rood geven ───────────
function negatieveControle() {
  const teStreng = z.object({ verplicht: z.string().email() }).strict();
  const bekendGoed = [{ verplicht: "geen-email", extra: 1 }, {}];
  const uitkomst = toetsNietStrenger(teStreng, bekendGoed, []);
  // We VERWACHTEN falen. Groen = de controle deed zijn werk.
  return { detecteerde: !uitkomst.ok, aantalFalen: uitkomst.falen.length };
}

const args = process.argv.slice(2);
const jsonUit = args.includes("--json");
const alleenSelftest = args.includes("--selftest");
// --uit-code: toets de schema's zoals ze in de ROUTEBESTANDEN staan (de eindstand,
// TICKET-W9 stap 10) i.p.v. de generatoroutput. Zo bewijst de classifier iets wat
// ook echt in de code staat — ook ná handwerk.
const uitCode = args.includes("--uit-code");

const neg = negatieveControle();

if (alleenSelftest) {
  console.log(neg.detecteerde
    ? `✓ negatieve controle: te streng schema correct als ROOD gedetecteerd (${neg.aantalFalen} falen)`
    : `✗ negatieve controle FAALT: te streng schema kwam er groen doorheen — classifier bewijst niets`);
  process.exit(neg.detecteerde ? 0 : 1);
}

// ── Classificeer alle body-lezende handlers ───────────────────────────────────
const schemas = uitCode ? leesSchemasUitCode() : genereerSchemas();
const corpus = bouwCorpus();
const corpusPerHandler = new Map(corpus.handlers.map((h) => [h.handler, h.bodies]));

const resultaten = [];
for (const [sleutel, gen] of schemas) {
  const bodies = corpusPerHandler.get(sleutel);
  if (!bodies || bodies.length === 0) {
    resultaten.push({ handler: sleutel, status: "niet-geverifieerd", reden: "geen corpus-body (onderbedekt)" });
    continue;
  }
  const uit = toetsNietStrenger(gen.schema, bodies, gen.guarded);
  // Guarded-honesty: een getypeerd (guarded) veld is de ENIGE plek waar W8
  // aanscherpt. Raakt geen enkele corpus-body dat veld met een waarde, dan is die
  // aanscherping ONBEWEZEN — de differentiële toets kan hem niet weerleggen. Dat is
  // geen fout, maar het moet zichtbaar zijn (W9-handwerk verifieert die velden).
  const guardedOnbewezen = (gen.guarded || []).filter(
    (g) => !bodies.some((b) => b && typeof b === "object" && b[g] !== undefined)
  );
  resultaten.push({
    handler: sleutel,
    status: uit.ok ? "niet-strenger" : "STRENGER",
    bodies: bodies.length,
    onderbedekt: bodies.length <= 1,
    guardedOnbewezen,
    falen: uit.falen,
  });
}

const strenger = resultaten.filter((r) => r.status === "STRENGER");
const nietGeverifieerd = resultaten.filter((r) => r.status === "niet-geverifieerd");
const geverifieerd = resultaten.filter((r) => r.status === "niet-strenger");

if (jsonUit) {
  console.log(JSON.stringify({ negatieveControle: neg, resultaten }, null, 2));
} else {
  console.log(`Differentiële classifier — ${schemas.size} conceptschema's getoetst tegen de harnas-corpus\n`);
  console.log(neg.detecteerde
    ? `  ✓ negatieve controle: te streng schema werd ROOD (${neg.aantalFalen} falen) — classifier is aangetoond`
    : `  ✗ negatieve controle FAALT — classifier bewijst niets`);
  console.log(`\n  niet-strenger (bewezen) : ${geverifieerd.length}`);
  console.log(`  STRENGER (schema te streng): ${strenger.length}`);
  console.log(`  niet-geverifieerd (geen corpus-body): ${nietGeverifieerd.length}`);
  const metGuardedOnbewezen = geverifieerd.filter((r) => r.guardedOnbewezen?.length);
  const guardedOnbewezenTotaal = metGuardedOnbewezen.reduce((n, r) => n + r.guardedOnbewezen.length, 0);
  console.log(`\n  guarded-onbewezen (getypeerd veld niet in corpus → W9 verifieert): ${guardedOnbewezenTotaal} veld(en) over ${metGuardedOnbewezen.length} handler(s)`);
  for (const r of metGuardedOnbewezen) console.log(`    - ${r.handler}: ${r.guardedOnbewezen.join(", ")}`);
  console.log(`\n  gesanctioneerde slikkers (kapotte JSON → 400, draaien nu door op {}): ${GESANCTIONEERDE_SLIKKERS.length}`);
  for (const s of GESANCTIONEERDE_SLIKKERS) console.log(`    - ${s}`);
  if (strenger.length) {
    console.log(`\n  ✗ STRENGER dan de code — schema weigert een geaccepteerde body:`);
    for (const r of strenger) {
      console.log(`    - ${r.handler}`);
      for (const f of r.falen.slice(0, 3)) {
        console.log(`        eis ${f.eis}${f.veld ? ` veld=${f.veld}` : ""}: ${JSON.stringify(f.reden)}  body=${JSON.stringify(f.body).slice(0, 80)}`);
      }
    }
  }
}

// Exit rood als de negatieve controle niet detecteerde, óf een schema strenger is.
process.exit(neg.detecteerde && strenger.length === 0 ? 0 : 1);
