import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { census, REGISTER_PAD } from "../karakterisering/retrieval-census.mjs";

// #322 F4-T1 — de retrievalkern heeft vandaag een klein, bekend aantal directe
// aanroepers. Dit register bevriest ze vóór de verplaatsing achter het
// gemeenschappelijke contract (T2). Een nieuwe aanroeper, een nieuw symbool of
// een directe zoek-RPC buiten het register maakt de gate rood; een verdwenen
// aanroeper ook (stale entry), zodat het register nooit stil verwatert.
const register = JSON.parse(readFileSync(REGISTER_PAD, "utf8")) as { census: Record<string, unknown> };

test("F4-census — directe aanroepers van de retrievalkern zijn exact het bevroren register", () => {
  const nu = census();
  const verwacht = register.census;
  const nieuw = Object.keys(nu).filter((b) => !(b in verwacht));
  const verdwenen = Object.keys(verwacht).filter((b) => !(b in nu));
  assert.deepEqual(nieuw, [], `nieuwe directe aanroeper(s) buiten het register: ${nieuw.join(", ")} — motiveer en regenereer met node tests/karakterisering/retrieval-census.mjs --schrijf`);
  assert.deepEqual(verdwenen, [], `stale registerentry: ${verdwenen.join(", ")} — regenereer het register`);
  assert.deepEqual(nu, verwacht, "symbolen/RPC's/tabellen per aanroeper zijn gewijzigd — motiveer en regenereer het register");
});

test("F4-census — zoek-RPC's leven uitsluitend in rag.ts; directe document_chunks-lezers op het antwoordpad zijn bekend", () => {
  const nu = census();
  const directeRpc = Object.entries(nu).filter(([, e]) => (e as { rpcs: string[] }).rpcs.length > 0).map(([b]) => b);
  assert.deepEqual(directeRpc, [], `zoek-RPC buiten de kern: ${directeRpc.join(", ")}`);
  // Bevinding F4-T1 (geen aanname): de chatroute leest document_chunks ook
  // rechtstreeks, buiten rag.ts om. T2 brengt dat achter de adapter; tot die
  // tijd is dit de enige route op het antwoordpad met directe tabeltoegang.
  const antwoordpad = Object.entries(nu)
    .filter(([b, e]) => b.startsWith("app/api/") && (e as { tabellen: string[] }).tabellen.length > 0 && !/backfill|classificatie/.test(b))
    .map(([b]) => b).sort();
  assert.deepEqual(antwoordpad, ["app/api/chat/route.ts"]);
});

test("F4-census — de vier productie-ingangen van zoekRelevanteChunksMetMeta zijn bekend", () => {
  const nu = census();
  const ingangen = Object.entries(nu)
    .filter(([, e]) => ((e as { modules: Record<string, string[]> }).modules.rag ?? []).includes("zoekRelevanteChunksMetMeta"))
    .map(([b]) => b).sort();
  assert.deepEqual(ingangen, ["app/api/chat/route.ts", "app/api/zoeken/route.ts", "core/lib/vergelijk-productie.ts"]);
});
