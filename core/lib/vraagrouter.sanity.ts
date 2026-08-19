import assert from "node:assert/strict";
import {
  bouwAnalyseplan,
  isModelRouterKandidaat,
  resolveerGenoemdDocument,
  routeerVraag,
  veiligeRouterTerugval,
  valideerModelroute,
  type VraagDekking,
} from "./vraagrouter";
import {
  bredeDekking,
  dekkingsInstructie,
  dekkingslabel,
  finaliseerRouteMetDekking,
  gerichteDekking,
  magVolledigeAnalyseAanbieden,
} from "./document-dekking";

type Case = { vraag: string; verwacht: VraagDekking; groep: string };

// 60 gelabelde vragen: 25 documentbreed, 25 gericht en 10 brede vragen zonder
// gevalideerde scope. Dit is een routermeetset, geen model-/antwoordeval.
const cases: Case[] = [
  { vraag: "Past het Transitieplan op alle relevante onderdelen aan op het implementatiekader?", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Controleer het Transitieplan integraal op effecten, compensatie, evenwichtigheid en opgebouwde aanspraken.", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Is het document volledig en intern consistent?", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Doorloop alle hoofdstukken en benoem ontbrekende onderbouwing.", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Welke risico’s, aannames en open punten bevat het hele plan?", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Toets het plan aan dit kader en maak per criterium een oordeel.", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Vat dit document volledig samen.", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Geef de rode draad en alle hoofdpunten uit het gehele rapport.", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Beoordeel integraal of de belangenafweging voldoende is onderbouwd.", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Analyseer het hele document op lacunes en inconsistenties.", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Sluit de volledige regeling aan bij het communicatiekader?", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Loop van begin tot eind na of alle criteria zijn behandeld.", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Welke besluiten worden in het hele stuk gevraagd?", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Welke risico's noemt het gehele document?", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Geef een volledige beoordeling van de uitvoerbaarheid.", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Toets alle onderdelen tegen het beoordelingskader.", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Zijn effecten en compensatie in alle hoofdstukken consistent uitgewerkt?", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Maak een integrale risicoanalyse van het document.", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Welke onderbouwing ontbreekt in het volledige plan?", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Evalueer het gehele stuk op besluitrijpheid.", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Geef de strekking van het hele document en benoem alle aandachtspunten.", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Beoordeel de samenhang tussen alle onderdelen van het plan.", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Controleer volledig of opgebouwde aanspraken voldoende terugkomen.", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Past het gehele beleidsplan bij alle eisen uit het kader?", verwacht: "volledig_document", groep: "breed" },
  { vraag: "Vat alle hoofdstukken samen en geef de belangrijkste risico's.", verwacht: "volledig_document", groep: "breed" },

  { vraag: "Wat staat op pagina 17 over compensatie?", verwacht: "targeted", groep: "gericht" },
  { vraag: "Welke datum noemt het document voor implementatie?", verwacht: "targeted", groep: "gericht" },
  { vraag: "Wie is verantwoordelijk voor communicatie?", verwacht: "targeted", groep: "gericht" },
  { vraag: "Vat alleen paragraaf 3.2 samen.", verwacht: "targeted", groep: "gericht" },
  { vraag: "Beoordeel uitsluitend de genoemde rekenrente.", verwacht: "targeted", groep: "gericht" },
  { vraag: "Noem het besluit over de transitiedatum.", verwacht: "targeted", groep: "gericht" },
  { vraag: "Welk percentage staat in artikel 4?", verwacht: "targeted", groep: "gericht" },
  { vraag: "Citeer letterlijk de bepaling op pagina 12.", verwacht: "targeted", groep: "gericht" },
  { vraag: "Wat is de deadline in paragraaf 6.1?", verwacht: "targeted", groep: "gericht" },
  { vraag: "Staat er iets over de premie?", verwacht: "targeted", groep: "gericht" },
  { vraag: "Welke uitvoerder wordt genoemd?", verwacht: "targeted", groep: "gericht" },
  { vraag: "Wanneer start fase twee?", verwacht: "targeted", groep: "gericht" },
  { vraag: "Hoeveel deelnemers betreft dit?", verwacht: "targeted", groep: "gericht" },
  { vraag: "Leg alleen het begrip invaardekkingsgraad uit.", verwacht: "targeted", groep: "gericht" },
  { vraag: "Analyseer specifiek de tabel op pagina 8.", verwacht: "targeted", groep: "gericht" },
  { vraag: "Beoordeel enkel de planning in hoofdstuk 2.", verwacht: "targeted", groep: "gericht" },
  { vraag: "Wat vermeldt paragraaf 9 over bezwaar?", verwacht: "targeted", groep: "gericht" },
  { vraag: "Welke termijn staat in artikel 12?", verwacht: "targeted", groep: "gericht" },
  { vraag: "Wie tekent het document?", verwacht: "targeted", groep: "gericht" },
  { vraag: "Wat is het genoemde bedrag?", verwacht: "targeted", groep: "gericht" },
  { vraag: "Citeer de exacte tekst over compensatie.", verwacht: "targeted", groep: "gericht" },
  { vraag: "Wat staat uitsluitend in de bijlage over uitvoering?", verwacht: "targeted", groep: "gericht" },
  { vraag: "Noem specifiek de drie mijlpalen.", verwacht: "targeted", groep: "gericht" },
  { vraag: "Welke datum staat bovenaan pagina 1?", verwacht: "targeted", groep: "gericht" },
  { vraag: "Wat zegt artikel 3 over de werkgever?", verwacht: "targeted", groep: "gericht" },

  { vraag: "Beoordeel dit plan integraal, maar ik heb nog geen document gekozen.", verwacht: "targeted", groep: "geen_scope" },
  { vraag: "Toets alle onderdelen aan het kader zonder documentscope.", verwacht: "targeted", groep: "geen_scope" },
  { vraag: "Vat het hele document samen.", verwacht: "targeted", groep: "geen_scope" },
  { vraag: "Welke onderbouwing ontbreekt in het volledige stuk?", verwacht: "targeted", groep: "geen_scope" },
  { vraag: "Controleer alle hoofdstukken.", verwacht: "targeted", groep: "geen_scope" },
  { vraag: "Maak een integrale risicoanalyse.", verwacht: "targeted", groep: "geen_scope" },
  { vraag: "Past het hele plan bij het kader?", verwacht: "targeted", groep: "geen_scope" },
  { vraag: "Evalueer de volledige regeling.", verwacht: "targeted", groep: "geen_scope" },
  { vraag: "Doorloop het document van begin tot eind.", verwacht: "targeted", groep: "geen_scope" },
  { vraag: "Zijn alle relevante onderdelen consistent?", verwacht: "targeted", groep: "geen_scope" },
];

let tp = 0;
let tn = 0;
let fp = 0;
let fn = 0;
for (const c of cases) {
  const metScope = c.groep !== "geen_scope";
  const route = routeerVraag(c.vraag, {
    scope: metScope ? "geselecteerd_document" : "fondscollectie",
    documentAantal: metScope ? 1 : 0,
  });
  const gotBreed = route.dekking !== "targeted";
  const wantBreed = c.verwacht !== "targeted";
  if (gotBreed && wantBreed) tp++;
  else if (!gotBreed && !wantBreed) tn++;
  else if (gotBreed) fp++;
  else fn++;
  assert.equal(route.dekking, c.verwacht, `${c.groep}: ${c.vraag}`);
}

const precision = tp / Math.max(1, tp + fp);
const recall = tp / Math.max(1, tp + fn);
const specificity = tn / Math.max(1, tn + fp);
const f1 = (2 * precision * recall) / Math.max(Number.EPSILON, precision + recall);
assert.ok(f1 >= 0.9, `macro veiligheids-F1 te laag: ${f1}`);
assert.ok(recall >= 0.95, `recall brede vragen te laag: ${recall}`);
assert.ok(specificity >= 0.95, `specificiteit targeted te laag: ${specificity}`);

// Reproduceerbaarheid: dezelfde complexe route tien keer exact gelijk.
const herhalingen = Array.from({ length: 10 }, () =>
  JSON.stringify(
    routeerVraag("Toets het volledige Transitieplan integraal aan alle criteria.", {
      scope: "geselecteerd_document",
      documentAantal: 1,
    })
  )
);
assert.equal(new Set(herhalingen).size, 1);

// Genoemde scope: uniek, ambigu en afwezig.
const docs = [
  { id: "t1", titel: "SPH Transitieplan" },
  { id: "i1", titel: "Implementatieplan 2027" },
];
assert.deepEqual(resolveerGenoemdDocument("Toets het Transitieplan integraal", docs), {
  status: "eenduidig",
  document: docs[0],
});
assert.equal(
  resolveerGenoemdDocument("Beoordeel het Transitieplan", [
    ...docs,
    { id: "t2", titel: "Transitieplan versie 2" },
  ]).status,
  "meerdere"
);
assert.equal(resolveerGenoemdDocument("Wat is de planning?", docs).status, "geen");

// Modelantwoord kan geen scope of uitputtend bewijs scheppen.
const ambigu = routeerVraag("Beoordeel dit stuk", {
  scope: "geselecteerd_document",
  documentAantal: 1,
});
assert.equal(isModelRouterKandidaat(ambigu), true);
const modelZonderScope = valideerModelroute(
  routeerVraag("Beoordeel dit", { documentAantal: 0 }),
  { taak: "volledigheidstoets", dekking: "volledig_document", vertrouwen: 0.9, signalen: [] },
  0
);
assert.equal(modelZonderScope?.dekking, "targeted");
assert.equal(veiligeRouterTerugval(ambigu).dekking, "targeted");

// Decompositie bevat de regressiethema's, maar claimt geen juridisch kader.
const plan = bouwAnalyseplan(
  routeerVraag("Toets het volledige plan aan het kader", {
    scope: "geselecteerd_document",
    documentAantal: 1,
  }),
  "Toets het volledige plan aan het kader"
);
assert.deepEqual(
  plan.map((c) => c.id),
  ["effecten", "compensatie", "evenwichtigheid", "opgebouwde_aanspraken", "uitvoering_planning"]
);

// Dekkingscontract: targeted kan nooit uitputtend worden; volledige verwerking wel.
const gericht = gerichteDekking(10);
assert.match(dekkingslabel(gericht), /Gericht gezocht/);
assert.match(dekkingsInstructie(gericht), /geen uitspraak over het volledige document/i);
assert.equal(finaliseerRouteMetDekking(ambigu, gericht).bewijsniveau, "onderbouwd");
const compleet = bredeDekking({ totaalPassages: 203, verwerktePassages: 203 });
assert.equal(compleet.volledig, true);
assert.equal(finaliseerRouteMetDekking(ambigu, compleet).bewijsniveau, "uitputtend");
const gedeeltelijk = bredeDekking({
  totaalPassages: 203,
  verwerktePassages: 160,
  totaalBatches: 8,
  verwerkteBatches: 7,
  afkapredenen: ["batch_timeout"],
});
assert.equal(gedeeltelijk.volledig, false);
assert.match(dekkingslabel(gedeeltelijk), /Gedeeltelijk/);
assert.match(dekkingsInstructie(gedeeltelijk), /geen conclusie/i);

assert.equal(
  magVolledigeAnalyseAanbieden({
    route: { ...ambigu, dekking: "targeted", taak: "uitleg" },
    dekking: gericht,
    documentIds: ["t1"],
    totaalPassages: 203,
    maximaalPassages: 5000,
    actief: true,
  }),
  true
);
assert.equal(
  magVolledigeAnalyseAanbieden({
    route: { ...ambigu, dekking: "targeted", taak: "feitopzoeking" },
    dekking: gericht,
    documentIds: ["t1"],
    totaalPassages: 203,
    maximaalPassages: 5000,
    actief: true,
  }),
  false
);

console.log("vraagrouter sanity-tests:");
console.log(`  meetset: ${cases.length} vragen`);
console.log(`  confusion matrix: TP=${tp} FP=${fp} FN=${fn} TN=${tn}`);
console.log(
  `  precision=${precision.toFixed(3)} recall=${recall.toFixed(3)} specificity=${specificity.toFixed(3)} f1=${f1.toFixed(3)}`
);
console.log("  ✓ routecontract, scope-resolutie, modelgrenzen, decompositie en dekking");
