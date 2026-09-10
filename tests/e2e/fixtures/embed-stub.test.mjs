// ============================================================================
//  #349 F4-T1b — de embeddingstub en de gedeelde vectorizer.
// ----------------------------------------------------------------------------
//  Een stub die niet deterministisch is, of die andere vectoren levert dan de
//  seed, maakt een hybride golden waardeloos: de vectorarm zou dan ruis meten.
//  Deze suite bewaakt precies dat, plus de belofte dat de stub geen invoertekst
//  bewaart.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import { pseudoEmbedding, vectorLiteral, tokeniseer, STUB_DIMS } from "./embed-vector.mjs";
import { maakServer } from "./embed-stub.mjs";
import { EMBED_STUB_MODEL } from "./config.mjs";

const RENTE = "De renteafdekking van de matchingportefeuille is per ultimo verhoogd naar 60 procent van de verplichtingen.";
const PREMIE = "De premie voor het komende jaar is vastgesteld op 24 procent van de pensioengrondslag.";

const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

test("T1b — de vectorizer is deterministisch en heeft de juiste dimensie", () => {
  const a = pseudoEmbedding(RENTE);
  const b = pseudoEmbedding(RENTE);
  assert.equal(a.length, STUB_DIMS, "moet exact EMBED_DIMS (1024) zijn, anders weigert pgvector de kolom");
  assert.deepEqual(a, b, "zelfde tekst moet byte-identieke vectoren geven");
});

test("T1b — de vector is genormaliseerd, zodat cosinus en inproduct samenvallen", () => {
  const v = pseudoEmbedding(RENTE);
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-4, `L2-norm was ${norm}`);
});

test("T1b — gelijkenis is betekenisvol, niet willekeurig", () => {
  // Dit is de eigenschap die een hashing-vectorizer onderscheidt van een
  // hash-afgeleide willekeurige vector: teksten die woorden delen liggen
  // dichter bij elkaar. Zonder dit zou de RRF-fusie een stabiele maar
  // betekenisloze volgorde vastleggen.
  const vraag = pseudoEmbedding("renteafdekking");
  assert.ok(
    cos(vraag, pseudoEmbedding(RENTE)) > cos(vraag, pseudoEmbedding(PREMIE)),
    "de vraag 'renteafdekking' moet dichter bij de rentetekst liggen dan bij de premietekst"
  );
});

test("T1b — een lege tekst levert een geldige eenheidsvector, geen nulvector", () => {
  const v = pseudoEmbedding("");
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-6, "cosinus is ongedefinieerd op een nulvector");
});

test("T1b — stopwoorden en interpunctie beïnvloeden de vector niet", () => {
  assert.deepEqual(
    pseudoEmbedding("de renteafdekking van het fonds"),
    pseudoEmbedding("Renteafdekking, fonds!"),
    "tokenisatie moet stabiel zijn onder interpunctie, kapitalen en stopwoorden"
  );
  assert.deepEqual(tokeniseer("De renteafdekking van het fonds"), ["renteafdekking", "fonds"]);
});

test("T1b — de pgvector-literal heeft het formaat dat de RPC verwacht", () => {
  const lit = vectorLiteral(pseudoEmbedding("x"));
  assert.ok(lit.startsWith("[") && lit.endsWith("]"));
  assert.equal(lit.slice(1, -1).split(",").length, STUB_DIMS);
});

test("T1b — de stub spreekt de Mistral-vorm en levert per invoer één embedding", async () => {
  const server = maakServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const basis = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${basis}/v1/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: EMBED_STUB_MODEL, input: [RENTE, PREMIE] }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.length, 2);
    assert.deepEqual(body.data[0].embedding, pseudoEmbedding(RENTE),
      "de stub moet exact dezelfde vectorizer gebruiken als de seed");
    assert.equal(body.model, EMBED_STUB_MODEL);

    const tel = await (await fetch(`${basis}/_verzoeken`)).json();
    assert.equal(tel.verzoeken.length, 1);
    assert.deepEqual(tel.verzoeken[0], { model: EMBED_STUB_MODEL, aantal: 2, dims: STUB_DIMS });
    // De belofte: geen invoertekst in het testproces.
    assert.ok(!JSON.stringify(tel).includes("renteafdekking"), "de stub mag geen invoertekst bewaren");

    await fetch(`${basis}/_verzoeken`, { method: "DELETE" });
    const leeg = await (await fetch(`${basis}/_verzoeken`)).json();
    assert.deepEqual(leeg.verzoeken, []);
  } finally {
    server.close();
  }
});

test("T1b — een onbekend pad geeft 404, geen embedding", async () => {
  const server = maakServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`, { method: "POST", body: "{}" });
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});
