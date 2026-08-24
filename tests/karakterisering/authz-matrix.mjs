// ============================================================================
//  W7 — autorisatiematrix: het contract tussen declaratie en waarneming.
// ----------------------------------------------------------------------------
//  Dit bestand bevat GEEN verwachtingen; het bevat de PURE afbeelding
//  scenario → gewrapte handler, plus de afleiding van de zou-uitkomst onder
//  `ENFORCE_CAPABILITY=on`. Zo is er één bron voor:
//
//    • de generator die `authz-matrix.expected.json` schrijft,
//    • de statische test die dat bestand tegen de code toetst,
//    • de flag-on-runner die het tegen de draaiende server toetst.
//
//  Bewust PURE JS zonder TS-import: de karakteriseringsrunner draait onder
//  kaal `node`, niet onder tsx. De capability-check wordt daarom INGESPOTEN
//  (`rolHeeftCapability`) in plaats van hier geïmporteerd — de statische test
//  levert de echte functie aan, de runner leest het bevroren JSON.
// ============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const HIER = dirname(fileURLToPath(import.meta.url));
const API = join(HIER, "..", "..", "app", "api");
const METHODEN = ["GET", "POST", "PATCH", "PUT", "DELETE"];

/** De drie ladderrollen plus het bureau. `anon` valt met 401 vóór de poort en
 *  is dus nooit een capability-beslissing. */
export const LADDERROLLEN = ["bestuurder", "voorzitter", "beheerder", "bestuursbureau"];

function routeBestanden(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? routeBestanden(p) : e === "route.ts" ? [p] : [];
  });
}

/**
 * Alle gewrapte handlers als {method, route, capability, patroon}. `patroon` is
 * een regex die een concreet scenariopad (zonder `/api`) matcht ongeacht de
 * parameternaam — `[id]`, `[rid]`, `[afschriftId]` matchen alle één segment.
 */
export function gewrapteHandlers() {
  const uit = [];
  for (const bestand of routeBestanden(API).sort()) {
    const src = readFileSync(bestand, "utf8");
    const merken = [...src.matchAll(new RegExp(`^export const (${METHODEN.join("|")})\\b`, "gm"))];
    const route = "/" + relative(API, dirname(bestand));
    for (const [i, m] of merken.entries()) {
      const body = src.slice(m.index, i + 1 < merken.length ? merken[i + 1].index : src.length);
      const cap = /capability: "([^"]+)"/.exec(body);
      if (!cap) continue;
      const patroon = new RegExp(
        "^" + route.replace(/\[[^\]]+\]/g, "[^/]+").replace(/\//g, "\\/") + "$"
      );
      uit.push({ method: m[1], route, capability: cap[1], patroon });
    }
  }
  return uit;
}

/** Vindt de gewrapte handler voor een scenario, of null (niet-gewrapt / machine-
 *  route / bewust ongeldig pad — alle drie buiten W7-scope). */
export function handlerVoor(handlers, method, path) {
  const p = path.replace(/^\/api/, "").split("?")[0];
  return handlers.find((h) => h.method === method && h.patroon.test(p)) ?? null;
}

/**
 * De zou-uitkomst van één scenario onder de vlag, gegeven de capability-check.
 * Retourneert één van:
 *   { klasse: "buiten-scope" }              — geen gewrapte handler
 *   { klasse: "anon" }                      — 401 vóór de poort; vlag verandert niets
 *   { klasse: "403", capability }           — de poort weigert deze rol
 *   { klasse: "onveranderd", capability }   — de poort laat door; route-eigen gedrag blijft
 */
export function zouUitkomst(scenario, handlers, rolHeeftCapability) {
  const h = handlerVoor(handlers, scenario.method, scenario.path);
  if (!h) return { klasse: "buiten-scope" };
  if (scenario.rol === "anon") return { klasse: "anon" };
  const toegestaan =
    h.capability === "iedere-ingelogde" ||
    h.capability === "publiek" ||
    rolHeeftCapability(scenario.rol, h.capability);
  return toegestaan
    ? { klasse: "onveranderd", capability: h.capability }
    : { klasse: "403", capability: h.capability };
}

/**
 * Bouwt de volledige matrix als gesorteerde, leesbare lijst — één regel per
 * scenario dat een gewrapte handler raakt. Dit is het bevroren contract.
 */
export function bouwMatrix(scenarios, handlers, rolHeeftCapability) {
  const rijen = [];
  for (const s of scenarios) {
    const u = zouUitkomst(s, handlers, rolHeeftCapability);
    if (u.klasse === "buiten-scope") continue;
    const h = handlerVoor(handlers, s.method, s.path);
    rijen.push({
      slug: s.slug,
      method: s.method,
      route: h.route,
      rol: s.rol,
      capability: u.capability ?? null,
      vlagAan: u.klasse === "403" ? "403" : "onveranderd",
    });
  }
  rijen.sort((a, b) => a.slug.localeCompare(b.slug));
  return rijen;
}
