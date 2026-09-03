// ============================================================================
//  Sanity-tests op de streamreducer (P1a C3, besluit 0201).
// ----------------------------------------------------------------------------
//  De componenttest `tests/component/AssistentStream.component.test.tsx` toetst
//  hetzelfde pad dóór de UI heen. Deze suite zit eronder en dekt wat je in een
//  gerenderde component niet scherp krijgt: de exacte stand na elk event, en de
//  randgevallen die in productie zeldzaam maar wél voorkomen.
// ============================================================================

import assert from "node:assert/strict";
import {
  leegeStreamStand,
  leesStreamRegel,
  pasStreamEventToe,
  splitsStreamBuffer,
  type AssistentStreamEvent,
  type StreamStand,
  type StreamUitwerking,
} from "./assistent-stream";

let n = 0;
const check = (naam: string, fn: () => void) => {
  fn();
  n += 1;
  console.log(`  ✓ ${naam}`);
};

console.log("assistent-stream sanity-tests:");

/** Speelt een eventreeks af en geeft de eindstand + alle uitwerkingen terug. */
function speel(
  events: AssistentStreamEvent[],
  vraag = "Wat is onze dekkingsgraad?"
): { stand: StreamStand; uitwerkingen: StreamUitwerking[] } {
  let stand = leegeStreamStand();
  const uitwerkingen: StreamUitwerking[] = [];
  for (const evt of events) {
    const uit = pasStreamEventToe(stand, evt, vraag);
    stand = uit.stand;
    uitwerkingen.push(uit.uitwerking);
  }
  return { stand, uitwerkingen };
}

const META: AssistentStreamEvent = {
  type: "meta",
  modus: "documenten",
  antwoordmodus: "feitelijk",
  bronbasis: "Fondsdocumenten",
  bronnen: [
    {
      document_id: "d1",
      titel: "ABTN",
      bron: "Intern",
      pagina: 3,
      paragraaf: null,
      fragment: "…",
      heeft_origineel: true,
    },
  ],
};

// ── De gelukkige weg ────────────────────────────────────────────────────────

check("delta's stapelen tot één antwoordtekst", () => {
  const { stand } = speel([
    META,
    { type: "delta", text: "De dekkingsgraad " },
    { type: "delta", text: "is 118,4%." },
    { type: "done", log_id: "log-1" },
  ]);
  assert.equal(stand.volledig, "De dekkingsgraad is 118,4%.");
  assert.equal(stand.voltooid, true);
  assert.equal(stand.logId, "log-1");
  assert.equal(stand.modus, "documenten");
  assert.equal(stand.bronnen?.length, 1);
});

check("de eerste delta voegt toe, elke volgende herschrijft", () => {
  const { uitwerkingen } = speel([
    META,
    { type: "delta", text: "a" },
    { type: "delta", text: "b" },
    { type: "done" },
  ]);
  assert.deepEqual(
    uitwerkingen.map((u) => u.soort),
    ["geen", "voegToe", "herschrijf", "herschrijf"]
  );
});

check("het bericht van de EERSTE delta draagt nog geen voltooid en geen logId", () => {
  // Subtiel en bewust: pas het 'done'-event maakt een antwoord kopieerbaar.
  // Zou de eerste bubbel `voltooid: false` dragen i.p.v. het veld weg te laten,
  // dan is dat een gedragsverschil in de opgeslagen berichten (jsonb).
  const { uitwerkingen } = speel([META, { type: "delta", text: "a" }]);
  const eerste = uitwerkingen[1];
  assert.equal(eerste.soort, "voegToe");
  if (eerste.soort !== "voegToe") return;
  assert.ok(!("voltooid" in eerste.bericht));
  assert.ok(!("logId" in eerste.bericht));
});

check("meta vult de onderbouwing zonder een bericht te raken", () => {
  const { stand, uitwerkingen } = speel([META]);
  assert.deepEqual(uitwerkingen, [{ soort: "geen" }]);
  assert.equal(stand.onderbouwing?.bronbasis, "Fondsdocumenten");
  assert.equal(stand.onderbouwing?.aantalBronnen, 1);
  assert.equal(stand.aiToegevoegd, false);
});

// ── Randgevallen ────────────────────────────────────────────────────────────

check("een AFGEBROKEN stream blijft onvoltooid (besluit 0098 §4)", () => {
  // Geen 'done'. Zonder deze regel zou een half antwoord een kopieerknop met
  // een volledige herkomstregel krijgen — precies de schijnzekerheid die 0098
  // wegneemt.
  const { stand } = speel([META, { type: "delta", text: "De dekkings" }]);
  assert.equal(stand.volledig, "De dekkings");
  assert.equal(stand.voltooid, false);
  assert.equal(stand.logId, undefined);
});

check("'done' ná een verduidelijking doet helemaal niets", () => {
  const { stand, uitwerkingen } = speel([
    {
      type: "verduidelijking",
      vraag: "Voor uw fonds of in algemene zin?",
      opties: [
        { intent: "fonds", label: "Voor mijn fonds" },
        { intent: "algemeen", label: "In algemene zin" },
      ],
    },
    { type: "done", log_id: "log-x" },
  ]);
  assert.deepEqual(
    uitwerkingen.map((u) => u.soort),
    ["voegToe", "geen"]
  );
  // Geen voltooid-vlag en geen log-id: de terugvraag is geen antwoord.
  assert.equal(stand.voltooid, false);
  assert.equal(stand.logId, undefined);
  assert.equal(stand.verduidelijkingActief, true);
});

check("de verduidelijkingsbubbel draagt de originele vraag mee", () => {
  // Een chipklik moet dezelfde vraag letterlijk opnieuw kunnen stellen.
  const { stand } = speel(
    [{ type: "verduidelijking", vraag: "Welke?", opties: [] }],
    "Mag ik bijstorten?"
  );
  assert.equal(
    stand.verduidelijkingBericht?.verduidelijking?.origineleVraag,
    "Mag ik bijstorten?"
  );
});

check("een vergelijkevent zonder resultaat voegt geen bericht toe", () => {
  const { stand, uitwerkingen } = speel([{ type: "vergelijking" }]);
  assert.deepEqual(uitwerkingen, [{ soort: "geen" }]);
  // aiToegevoegd staat wél op true, zodat het vangnet "geen antwoord ontvangen"
  // hierna niet alsnog slaat. Overgenomen uit het origineel.
  assert.equal(stand.aiToegevoegd, true);
  assert.equal(stand.verduidelijkingActief, true);
});

check("een fout vóór het antwoord wordt getoond, een fout erna genegeerd", () => {
  const voor = speel([{ type: "error", error: "Poort dicht." }]);
  assert.deepEqual(voor.uitwerkingen, [
    { soort: "voegToe", bericht: { rol: "ai", tekst: "Poort dicht." } },
  ]);

  const na = speel([
    META,
    { type: "delta", text: "Antwoord" },
    { type: "error", error: "Alsnog stuk." },
  ]);
  assert.equal(na.uitwerkingen[2].soort, "geen");
  assert.equal(na.stand.volledig, "Antwoord");
});

check("'done' zonder enige delta raakt de berichtenlijst niet", () => {
  // `schrijfAi()` had die guard; zonder AI-bubbel is er niets te herschrijven.
  const { uitwerkingen, stand } = speel([META, { type: "done" }]);
  assert.deepEqual(
    uitwerkingen.map((u) => u.soort),
    ["geen", "geen"]
  );
  assert.equal(stand.voltooid, true);
});

// ── Voortgang ───────────────────────────────────────────────────────────────

check("progress bouwt de voortgang op; de eerste delta wist hem", () => {
  const { stand: tijdens } = speel([
    { type: "progress", fase: "retrieval", status: "bezig", label: "Bronnen zoeken" },
    { type: "progress", fase: "retrieval", status: "klaar", label: "Bronnen", uitkomst: "4 bronnen" },
  ]);
  assert.equal(tijdens.voortgang?.klaar.length, 1);
  assert.equal(tijdens.voortgang?.klaar[0].uitkomst, "4 bronnen");

  const { stand: erna } = speel([
    { type: "progress", fase: "retrieval", status: "bezig", label: "Bronnen zoeken" },
    { type: "delta", text: "a" },
  ]);
  assert.equal(erna.voortgang, null);
  assert.equal(erna.antwoordGestart, true);
});

// ── Reflectie: uitsluitend server-controlled (FR-67) ────────────────────────

check("de reflectiestatus komt ALLEEN uit 'done'", () => {
  // De client mag hem nooit afleiden uit wat hij verstuurde (besluit 0110).
  const zonder = speel([
    META,
    { type: "delta", text: "a" },
    { type: "progress", fase: "generatie", status: "bezig" },
  ]);
  assert.equal(zonder.stand.reflectie, null);

  const met = speel([
    META,
    { type: "delta", text: "a" },
    { type: "done", reflectie: { status: "conceptweergave", beurt: 2 } },
  ]);
  assert.deepEqual(met.stand.reflectie, { status: "conceptweergave", beurt: 2 });
});

check("een 'done' zonder reflectieblok laat de bestaande status staan", () => {
  let stand = leegeStreamStand();
  stand = pasStreamEventToe(stand, META, "v").stand;
  stand = pasStreamEventToe(stand, { type: "delta", text: "a" }, "v").stand;
  stand = pasStreamEventToe(
    stand,
    { type: "done", reflectie: { status: "verdieping" } },
    "v"
  ).stand;
  assert.equal(stand.reflectie?.status, "verdieping");
  // beurt ontbrak in het event → undefined, zodat de hook hem niet overschrijft.
  assert.equal(stand.reflectie?.beurt, undefined);
});

// ── Framing van de stroom ───────────────────────────────────────────────────

check("splitsStreamBuffer houdt een half event over voor de volgende lezing", () => {
  const { delen, rest } = splitsStreamBuffer('data: {"a":1}\n\ndata: {"b"');
  assert.deepEqual(delen, ['data: {"a":1}']);
  assert.equal(rest, 'data: {"b"');
});

check("leesStreamRegel negeert lege regels en onleesbare JSON", () => {
  assert.equal(leesStreamRegel(""), null);
  assert.equal(leesStreamRegel("data: "), null);
  assert.equal(leesStreamRegel("data: {kapot"), null);
  assert.deepEqual(leesStreamRegel('data: {"type":"done"}'), { type: "done" });
  // Ook zonder het `data: `-voorvoegsel, zoals het origineel deed.
  assert.deepEqual(leesStreamRegel('{"type":"done"}'), { type: "done" });
});

console.log(`\n${n} sanity-tests geslaagd.`);
