// ============================================================================
//  #349 F4-T1b — lokale embeddingstub (Mistral-vorm).
// ----------------------------------------------------------------------------
//  Zonder deze stub valt de retrievalketen lokaal en in CI deterministisch terug
//  op full-text search (`embedding_query_success: false`), en blijft het hybride
//  pad — in productie het PRIMAIRE pad — ongekarakteriseerd. Dat was de lacune
//  die #348 expliciet openliet en die besluit 0213 (R3) als eigen tranche belegt.
//
//  De stub spreekt precies het stukje Mistral-API dat `core/lib/embeddings.ts`
//  gebruikt: `POST /v1/embeddings` met `{model, input}` → `{data:[{embedding}]}`.
//  De vectoren komen uit `embed-vector.mjs`, dezelfde module die de W1-seed op de
//  chunkteksten toepast — anders zou de vectorarm ruis meten in plaats van
//  gelijkenis.
//
//  Hij bewaart NOOIT invoertekst. Het aantal verzoeken en de modelnaam zijn het
//  enige dat teruggelezen kan worden; dat is genoeg om te bewijzen dat de
//  vraag-embedding daadwerkelijk is opgehaald, zonder promptinhoud in een
//  testproces te bewaren (zelfde lijn als de WP4-providerstub).
// ============================================================================
import http from "node:http";
import { pathToFileURL } from "node:url";
import { pseudoEmbedding, STUB_DIMS } from "./embed-vector.mjs";

export const EMBED_STUB_POORT = 8791;

/** Inhoudsvrije telling: hoeveel embeddingverzoeken, met welk model. */
const verzoeken = [];
const MAX_VERZOEKEN = 50;

function json(res, status, body) {
  const tekst = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(tekst) });
  res.end(tekst);
}

export function maakServer() {
  return http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/_verzoeken") {
      return json(res, 200, { verzoeken });
    }
    if (req.method === "DELETE" && req.url === "/_verzoeken") {
      verzoeken.length = 0;
      return json(res, 200, { gewist: true });
    }
    if (req.method !== "POST" || !req.url.startsWith("/v1/embeddings")) {
      return json(res, 404, { error: { message: "embed-stub: onbekend pad" } });
    }

    let ruw = "";
    for await (const stuk of req) ruw += stuk;
    let body;
    try {
      body = JSON.parse(ruw);
    } catch {
      return json(res, 400, { error: { message: "embed-stub: ongeldige JSON" } });
    }

    const input = Array.isArray(body.input) ? body.input : [body.input];
    if (verzoeken.length >= MAX_VERZOEKEN) verzoeken.shift();
    // Uitsluitend vorm — nooit de tekst zelf.
    verzoeken.push({ model: body.model ?? null, aantal: input.length, dims: STUB_DIMS });

    return json(res, 200, {
      id: "embd-stub",
      object: "list",
      model: body.model ?? "mistral-embed",
      data: input.map((tekst, i) => ({
        object: "embedding",
        index: i,
        embedding: pseudoEmbedding(tekst),
      })),
      usage: { prompt_tokens: 0, total_tokens: 0 },
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  maakServer().listen(EMBED_STUB_POORT, "127.0.0.1", () => {
    process.stdout.write(`F4-T1b embeddingstub luistert op 127.0.0.1:${EMBED_STUB_POORT}\n`);
  });
}
