// ============================================================================
//  §15-matrix — portaalcontext privacy/tenant-invarianten (app-laag, besluit 0085).
// ----------------------------------------------------------------------------
//  De gedeelde contexthelper (core/lib/portaalcontext.ts) leest over meerdere
//  tenant-tabellen heen voor het AI-startpunt én de homepage. Twee invarianten
//  zijn load-bearing en worden hier via bron-inspectie vastgezet, zodat een
//  latere refactor ze niet stilzwijgend kan verbreden:
//
//   (1) PRIVACY-SINGLE-LOCK: de RLS-policy op agendapunt_inbreng is FONDS-breed
//       (niet user-scoped). "Agendapunten zonder eigen inbreng" mag daarom
//       uitsluitend de EIGEN inbreng tellen — de app-side .eq("gebruiker_id", …)
//       is de enige grendel. Verdwijnt die, dan lekt de telling co-leden.
//   (2) FONDS-SCOPE: de nieuwe documenten-read is fonds-bibliotheek + actief;
//       geen generiek (die zou platform-breed leesbaar zijn) en geen fonds uit
//       de URL — de helper leidt het fonds af via haalFondsSessie of een
//       server-side doorgegeven sessie.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/portaalcontext-privacy.test.ts
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const hier = dirname(fileURLToPath(import.meta.url));
const lees = (...p: string[]) => readFileSync(join(hier, "..", "..", ...p), "utf8");

const bron = lees("core", "lib", "portaalcontext.ts");

// ── (1) Privacy single-lock op agendapunt_inbreng ───────────────────────────

test("portaalcontext — eigen-inbreng-telling filtert op gebruiker_id (privacy single-lock)", () => {
  // De read op agendapunt_inbreng moet expliciet op de eigen gebruiker filteren.
  assert.match(
    bron,
    /from\("agendapunt_inbreng"\)[\s\S]*?\.eq\("gebruiker_id",\s*userId\)/,
    "agendapunt_inbreng moet .eq(\"gebruiker_id\", userId) dragen — anders lekt de telling co-leden"
  );
});

test("portaalcontext — leest geen tekst/inhoud van inbreng, alleen agendapunt_id (dataminimalisatie)", () => {
  // De select op inbreng haalt uitsluitend agendapunt_id op (voor de telling),
  // nooit de tekst van andermans of eigen inbreng in dit pad.
  assert.match(
    bron,
    /from\("agendapunt_inbreng"\)\s*\.select\("agendapunt_id"\)/,
    "inbreng-read mag alleen agendapunt_id selecteren"
  );
});

// ── (2) Fonds-scope + geen fonds uit de URL ─────────────────────────────────

test("portaalcontext — documenten-read is fonds-bibliotheek + actief (geen generiek, geen cross-tenant)", () => {
  assert.match(
    bron,
    /from\("documenten"\)[\s\S]*?\.eq\("bibliotheek",\s*"fonds"\)/,
    "documenten-read moet tot bibliotheek='fonds' beperkt zijn (generiek uitgesloten)"
  );
  assert.match(
    bron,
    /from\("documenten"\)[\s\S]*?\.eq\("actief",\s*true\)/,
    "documenten-read moet tot actieve stukken beperkt zijn"
  );
});

test("portaalcontext — fonds komt uit de sessie (haalFondsSessie), nooit uit een parameter/URL", () => {
  assert.match(
    bron,
    /haalFondsSessie\(\)/,
    "de default-tak moet het fonds via haalFondsSessie() afleiden"
  );
  // Geen enkel signaal dat het fonds uit een request/searchParam wordt gelezen.
  assert.doesNotMatch(
    bron,
    /searchParams|req\.|request\.|new URL\(/,
    "de helper mag geen fonds/id uit een request/URL afleiden"
  );
});

test("portaalcontext — uitsluitend de anon-key RLS-client (geen service-role)", () => {
  assert.match(bron, /createServerSupabase\(\)/, "moet de anon-key SSR-client gebruiken");
  assert.doesNotMatch(
    bron,
    /service[_-]?role|SUPABASE_SERVICE|createServiceClient/i,
    "de helper mag nooit de service-role-key gebruiken (RLS omzeilen)"
  );
});
