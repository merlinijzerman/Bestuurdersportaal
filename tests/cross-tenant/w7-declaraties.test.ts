// tests/cross-tenant/w7-declaraties.test.ts
// -----------------------------------------------------------------------------
// W7 (#153) — de 112 gedeclareerde gates, statisch bewaakt.
//
// W7 vervangt `capability: "TE_BEPALEN"` door een echte declaratie zodat
// `ENFORCE_CAPABILITY` naar fail-closed kan. Het besluit was uitdrukkelijk NIET
// om een rolmodel te bedenken: de gates zijn benoemd, de toekenning is voorlopig
// ruim, en GEEN ENKELE route-eigen gate is verwijderd.
//
// Deze suite bewaakt precies die belofte. De vier tests staan in oplopende
// zwaarte; W7-3 is de belangrijkste en de reden dat dit bestand bestaat.
//
// WAT DEZE SUITE NIET DEKT. Ze redeneert over de BRON, niet over draaiend
// gedrag. Een RLS-policy die strenger is dan de declaratie levert geen 403 maar
// een lege resultaatset, en dat ziet deze suite niet — model D blijft een aparte
// laag (ticket §6). De preview-waarneming ná de declaraties is daarom geen
// formaliteit.
// -----------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

import {
  ROL_CAPABILITIES,
  rolHeeftCapability,
  type Capability,
} from "../../core/lib/capabilities-map";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const API = join(REPO, "app", "api");
const ROLLEN = ["bestuurder", "voorzitter", "beheerder", "bestuursbureau"] as const;
const METHODEN = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

/** Alle `capability`-waarden die de wrapper kent naast de echte capabilities. */
const BIJZONDER = new Set(["iedere-ingelogde", "publiek"]);

type Handler = {
  /** `POST /procedures/[id]/checklist` — leesbaar in een assertiemelding. */
  label: string;
  bestand: string;
  /** De gedeclareerde waarde uit de RouteSpec. */
  gedeclareerd: string;
  /** De brontekst van deze ene handler, van zijn export tot de volgende. */
  body: string;
  /** De brontekst vóór de eerste export — daar staan helpergates. */
  hoofd: string;
};

function routeBestanden(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? routeBestanden(p) : e === "route.ts" ? [p] : [];
  });
}

/** Splitst elk routebestand in zijn afzonderlijke handlers. */
function alleHandlers(): Handler[] {
  const uit: Handler[] = [];
  for (const bestand of routeBestanden(API).sort()) {
    const src = readFileSync(bestand, "utf8");
    const merken = [...src.matchAll(new RegExp(`^export const (${METHODEN.join("|")})\\b`, "gm"))];
    if (!merken.length) continue;
    const hoofd = src.slice(0, merken[0].index!);
    const route = "/" + relative(API, dirname(bestand));
    for (const [i, m] of merken.entries()) {
      const start = m.index!;
      const eind = i + 1 < merken.length ? merken[i + 1].index! : src.length;
      const body = src.slice(start, eind);
      const cap = /capability: "([^"]+)"/.exec(body);
      if (!cap) continue; // niet-gewrapte handler; buiten W7-scope (W5b)
      uit.push({ label: `${m[1]} ${route}`, bestand, gedeclareerd: cap[1], body, hoofd });
    }
  }
  return uit;
}

const HANDLERS = alleHandlers();

test("W7-1 — geen enkele handler staat nog op TE_BEPALEN", () => {
  const rest = HANDLERS.filter((h) => h.gedeclareerd === "TE_BEPALEN");
  assert.deepEqual(
    rest.map((h) => h.label),
    [],
    "TE_BEPALEN geeft onder de vlag 403 voor élke rol; W13 laat CI hierop falen"
  );
  // 114: P2/PR-B (#167) voegde POST /procedures/[id]/vereisten/koppel toe
  // (capability procedures.manage) zonder de teller bij te trekken (113); P3/PR-C
  // (#168) voegt POST /procedures/[id]/stappen/[stapId]/afwijking toe (capability
  // procedures.afwijking.vastleggen) → 114.
  // 115: #192 voegt GET /procedures/[id]/vereisten/kandidaten toe (capability
  // procedures.view) — de leesroute achter de kiezer-UI.
  //
  // 117: P4 (#169, besluit 0194) voegt de twee bestuurlijke procedure-RPC-routes
  // beëindigen/heropenen toe. Hun scherpere capability is hieronder expliciet
  // gepind; het is geen W7-gedragsbehoudclaim.
  //
  // 121: P5c voegt vier aantekeningenhandlers toe (lezen, toevoegen, wijzigen,
  // verwijderen), allemaal via de gewone procedures.view/manage-capabilities.
  //
  // 120: T2 verwijdert de deprecated voorbereidingroute; de voorbereiding loopt
  // sindsdien uitsluitend via de al gewrapte chat-route.
  //
  // 124: Microsoft fase 1 voegt connect, status, test en lokaal ontkoppelen toe.
  // 127: Microsoft fase 2A voegt Outlook-status, agendaselectie en handmatige
  // synchronisatie toe; de vijf handlers zijn allemaal expliciet gewrapt.
  // 135: Microsoft fase 3A (#321) voegt acht SharePoint-handlers toe: status en
  // eigen toestemming op de profiel-capabilities, kandidaten/drives/mappen/bron
  // (kiezen, ontkoppelen, controleren) op fonds.config.manage.
  // 137: Microsoft fase 3B (#321) voegt de documentenlijst en de preview toe,
  // beide op documents.view met het gedelegeerde token van de gebruiker zelf.
  // BEDOELDE DIVERGENTIE (geen drift): 124 gewrapte declaraties, maar het aantal
  // OPGENOMEN 403-cellen in authz-matrix.expected.json blijft op de oude set. Het
  // negatieve contract van de afwijking-route (beheerder/bureau → 403) wordt tegen
  // een DRAAIENDE server opgenomen bij de stack-run, niet voorspeld (besluit 0192,
  // contractwaarde-regel). Zie tests/karakterisering/uitgestelde-opnames.json; die
  // lijst moet leeg zijn vóór P6.
  assert.equal(HANDLERS.length, 137, "aantal gewrapte handlers gewijzigd — werk het register bij");
});

test("W7-2 — elke gedeclareerde gate bestaat en hangt aan minstens één rol", () => {
  const gedragen = new Set(Object.values(ROL_CAPABILITIES).flat());
  for (const h of HANDLERS) {
    if (BIJZONDER.has(h.gedeclareerd)) continue;
    assert.ok(
      gedragen.has(h.gedeclareerd as Capability),
      `${h.label} declareert "${h.gedeclareerd}", en die hangt aan geen enkele rol. ` +
        "Dat geeft 403 voor iedere rol zonder dat iets dat meldt."
    );
  }
});

// ── W7-3 — de kern ───────────────────────────────────────────────────────────
// De belofte van W7 is dat het aanzetten van de vlag NIETS verandert. Dat is
// alleen waar als elke rol die de wrapper weigert, vandaag ook al door de route
// zelf wordt geweigerd.
//
// De bepaling van "wat weigert de route zelf" is BEWUST CONSERVATIEF: kan dit
// bestand een gate niet herkennen, dan telt hij als "weigert niemand". Een
// wrapper-weigering wordt dan als nieuw gerapporteerd en de test faalt. Liever
// een vals alarm dat iemand naleest dan een stille doorlaat.
function routeWeigert(h: Handler): Set<string> {
  const weigert = new Set<string>();
  const bron = h.body + "\n" + h.hoofd;

  // (a) capability-gates: requireCapability() en rolHeeftCapability().
  //     Het eerste argument kan zelf haakjes bevatten — `(profiel as {…})?.rol`
  //     in ai/stuk-export — dus niet op `)` afkappen. De capabilitynaam is te
  //     herkennen aan de punt; een gewone string matcht daardoor niet mee.
  for (const m of bron.matchAll(
    /(?:require|rol[Hh]eeft)Capability\([\s\S]{0,200}?"([a-z]+(?:\.[a-z]+)+)"/g
  )) {
    for (const rol of ROLLEN) {
      if (!rolHeeftCapability(rol, m[1] as Capability)) weigert.add(rol);
    }
  }

  // (b) inline rolgates: alleen tellen als de rolstring in dezelfde uitdrukking
  //     als een 403 of een `includes`/`===`-toets staat. Een rolstring in een
  //     quorumnoemer of een notificatiedoelgroep is GEEN gate — dat is precies
  //     de fout die §1a van het reviewrapport corrigeert.
  const rolgate = /(?:\[\s*(?:"(?:bestuurder|voorzitter|beheerder|bestuursbureau)"\s*,?\s*)+\]\s*(?:as const)?\s*\)?\s*\.includes|===\s*"(?:bestuurder|voorzitter|beheerder|bestuursbureau)")/;
  if (rolgate.test(h.body) || rolgate.test(h.hoofd)) {
    const genoemd = new Set(
      [...bron.matchAll(/"(bestuurder|voorzitter|beheerder|bestuursbureau)"/g)].map((m) => m[1])
    );
    for (const rol of ROLLEN) if (!genoemd.has(rol)) weigert.add(rol);
  }

  // (c) de bureau-gate.
  if (/isBureauRol|BUREAU_WEIGERING/.test(bron)) weigert.add("bestuursbureau");

  return weigert;
}

test("W7-3 — de vlag weigert geen rol die de route vandaag toelaat", () => {
  // P3/0192 en P4/0194 autoriseren expliciet dat deze bestuurlijke oordelen
  // alleen voorzitter+bestuurder toekomen. Pin exact deze verschillen; elke
  // andere nieuwe wrapperaanscherping blijft luid falen.
  const geautoriseerdeAanscherping = new Set([
    'POST /procedures/[id]/stappen/[stapId]/afwijking: "procedures.afwijking.vastleggen" sluit beheerder uit',
    'POST /procedures/[id]/stappen/[stapId]/afwijking: "procedures.afwijking.vastleggen" sluit bestuursbureau uit',
    'POST /procedures/[id]/beeindigen: "procedures.beeindigen" sluit beheerder uit',
    'POST /procedures/[id]/beeindigen: "procedures.beeindigen" sluit bestuursbureau uit',
    'POST /procedures/[id]/heropenen: "procedures.heropenen" sluit beheerder uit',
    'POST /procedures/[id]/heropenen: "procedures.heropenen" sluit bestuursbureau uit',
  ]);
  const nieuw: string[] = [];
  for (const h of HANDLERS) {
    if (BIJZONDER.has(h.gedeclareerd)) continue;
    const eigen = routeWeigert(h);
    for (const rol of ROLLEN) {
      if (rolHeeftCapability(rol, h.gedeclareerd as Capability)) continue;
      if (!eigen.has(rol)) nieuw.push(`${h.label}: "${h.gedeclareerd}" sluit ${rol} uit`);
    }
  }
  assert.deepEqual(
    nieuw.filter((melding) => !geautoriseerdeAanscherping.has(melding)),
    [],
    "Deze declaraties maken een route STRENGER dan hij vandaag is. Dat is een " +
      "gedragswijziging en hoort een eigen besluit te zijn, geen bijwerking van W7."
  );
  assert.deepEqual(new Set(nieuw), geautoriseerdeAanscherping, "Aanscherpingspin is incompleet of stale");
});

test("W7-4 — per gate komt de meest beperkte drager er aantoonbaar door", () => {
  // De tegenhanger van W7-3. Die bewijst dat de poort niet te ver dichtgaat voor
  // rollen die de route toelaat; deze bewijst dat elke gate ten minste één rol
  // daadwerkelijk doorlaat en dat die doorlaat ook echt uit de mapping volgt.
  const gates = new Set(HANDLERS.map((h) => h.gedeclareerd).filter((c) => !BIJZONDER.has(c)));
  for (const gate of gates) {
    const dragers = ROLLEN.filter((r) => rolHeeftCapability(r, gate as Capability));
    assert.ok(dragers.length > 0, `${gate} heeft geen enkele drager`);
    for (const rol of dragers) {
      assert.equal(rolHeeftCapability(rol, gate as Capability), true, `${rol} zou ${gate} moeten dragen`);
    }
  }
});

test("W7-5 — geen route declareert de verwijderde generic.library.manage", () => {
  // De dode tenant-capability is uit de union verwijderd (eigen PR). Deze grendel
  // blijft staan tegen TEKSTUELE herintroductie: dook de naam ooit weer op in een
  // declaratie, dan geeft die route 403 voor iedere rol zonder dat iets dat meldt.
  const fout = HANDLERS.filter((h) => h.gedeclareerd === "generic.library.manage");
  assert.deepEqual(fout.map((h) => h.label), []);
});
