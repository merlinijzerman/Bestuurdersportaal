// ============================================================================
//  Sanity-tests op de URL-ingang van de assistent (P1a C4, besluit 0201).
// ----------------------------------------------------------------------------
//  DEZE SUITE HEEFT EEN CONCRETE AANLEIDING. Tijdens de verhuizing van de
//  gesprekslaag hernoemde een zoek-en-vervang de closure-variabele `herkomst`
//  óók binnen de stringliteral `params.get("herkomst")`. Het gevolg: elke
//  `/ai?intent=fonds&herkomst=<module>` viel stil terug op "portaal", en het
//  auditspoor `bron_intent_herkomst` zou voortaan de verkeerde module dragen.
//
//  Niets ving dat. Niet `tsc` (het blijft een geldige string), niet de
//  componenttests (die stellen een gewone vraag), en niet een rooktest — want
//  de URL-afhandeling draait client-side, en er is bovendien géén knop in het
//  portaal die deze parameter zet (zie het ingangenregister: levend codepad,
//  dode ingang).
//
//  De les is niet "beter opletten" maar: een deeplink hoort een pure functie te
//  zijn die je kunt uitrekenen. Dat is wat hieronder wordt afgedwongen.
// ============================================================================

import assert from "node:assert/strict";
import {
  leesAssistentContextUitUrl,
  resolveerAssistentContext,
  type ContextLezer,
} from "./assistent-url-ingang";

let n = 0;
const check = (naam: string, fn: () => void | Promise<void>) => {
  const uit = fn();
  if (uit instanceof Promise) throw new Error(`${naam}: gebruik checkAsync`);
  n += 1;
  console.log(`  ✓ ${naam}`);
};
const wachtend: Promise<void>[] = [];
const checkAsync = (naam: string, fn: () => Promise<void>) => {
  wachtend.push(
    fn().then(() => {
      n += 1;
      console.log(`  ✓ ${naam}`);
    })
  );
};

console.log("assistent-url-ingang sanity-tests:");

// ── De pure parse ───────────────────────────────────────────────────────────

check("zonder parameters is er geen ingang en geen herkomst", () => {
  assert.deepEqual(leesAssistentContextUitUrl(""), { ingang: null, herkomst: null });
  assert.deepEqual(leesAssistentContextUitUrl("?x=1"), { ingang: null, herkomst: null });
});

check("de vier scope-ingangen worden herkend", () => {
  assert.deepEqual(leesAssistentContextUitUrl("?doc=d1").ingang, {
    soort: "document",
    documentId: "d1",
  });
  assert.deepEqual(leesAssistentContextUitUrl("?agendapunt=a1").ingang, {
    soort: "agendapunt",
    agendapuntId: "a1",
  });
  assert.deepEqual(leesAssistentContextUitUrl("?proces=p1").ingang, {
    soort: "proces",
    procedureId: "p1",
  });
  assert.deepEqual(leesAssistentContextUitUrl("?risicomatrix=1").ingang, {
    soort: "risicomatrix",
  });
});

check("de precedentie is doc → agendapunt → proces → risicomatrix", () => {
  // Gelijk aan het origineel: de takken stonden in deze volgorde en de eerste
  // die raak was, won.
  const alles = "?doc=d1&agendapunt=a1&proces=p1&risicomatrix=1";
  assert.equal(leesAssistentContextUitUrl(alles).ingang?.soort, "document");
  assert.equal(
    leesAssistentContextUitUrl("?agendapunt=a1&proces=p1&risicomatrix=1").ingang?.soort,
    "agendapunt"
  );
  assert.equal(
    leesAssistentContextUitUrl("?proces=p1&risicomatrix=1").ingang?.soort,
    "proces"
  );
});

// ── De herkomst-ingang: de regressie die dit alles heeft uitgelokt ──────────

check("?intent= + ?herkomst= levert de intentie ÉN de module", () => {
  assert.deepEqual(leesAssistentContextUitUrl("?intent=fonds&herkomst=risicomatrix"), {
    ingang: null,
    herkomst: { intent: "fonds", module: "risicomatrix" },
  });
  assert.deepEqual(
    leesAssistentContextUitUrl("?intent=algemeen&herkomst=bibliotheek").herkomst,
    { intent: "algemeen", module: "bibliotheek" }
  );
});

check("een herkomst zonder geldige slug valt terug op 'portaal'", () => {
  // De waarde landt in het auditspoor én als label in de UI: nooit vrije tekst.
  for (const ruw of [
    "",
    "Risicomatrix",              // hoofdletters
    "risico matrix",             // spatie
    "<script>",                  // markup
    "risico/../matrix",          // pad
  ]) {
    const uit = leesAssistentContextUitUrl(
      `?intent=fonds&herkomst=${encodeURIComponent(ruw)}`
    );
    assert.equal(uit.herkomst?.module, "portaal", `slug "${ruw}" niet geweigerd`);
  }
});

check("een te lange slug wordt AFGEKAPT, niet geweigerd", () => {
  // Vastgelegd omdat het verrassend is en makkelijk "op te schonen": de
  // afkapping op 40 tekens gebeurt VÓÓR de vormcontrole, dus 41 geldige tekens
  // leveren een geldige slug van 40 op in plaats van de terugval "portaal".
  // Dit is het gedrag van het origineel en blijft zo; wie het wil veranderen,
  // verandert daarmee wat er in het auditspoor belandt.
  const uit = leesAssistentContextUitUrl(`?intent=fonds&herkomst=${"a".repeat(41)}`);
  assert.equal(uit.herkomst?.module, "a".repeat(40));
});

check("een onbekende intent zet géén herkomst", () => {
  assert.equal(leesAssistentContextUitUrl("?intent=onzin&herkomst=portaal").herkomst, null);
  assert.equal(leesAssistentContextUitUrl("?herkomst=portaal").herkomst, null);
});

check("herkomst staat NAAST een scope-ingang, niet in plaats daarvan", () => {
  // Bewust: de scope-takken en de intentie-tak sloten elkaar in het origineel
  // niet uit. De route negeert de intentie bij een actieve scope, maar het
  // auditspoor draagt hem wel.
  const uit = leesAssistentContextUitUrl("?doc=d1&intent=fonds&herkomst=bibliotheek");
  assert.equal(uit.ingang?.soort, "document");
  assert.deepEqual(uit.herkomst, { intent: "fonds", module: "bibliotheek" });
});

// ── De resolver, tegen een stub ─────────────────────────────────────────────

/** Minimale stub: één vaste uitkomst per tabel, plus een aanroepenlogboek. */
function maakLezer(perTabel: Record<string, unknown>) {
  const gelezen: string[] = [];
  const lezer: ContextLezer = {
    from(tabel: string) {
      gelezen.push(tabel);
      const data = perTabel[tabel] ?? null;
      const bouwer = {
        eq: () => bouwer,
        order: () => bouwer,
        maybeSingle: () => Promise.resolve({ data }),
        then: (op: (w: { data: unknown }) => unknown) =>
          Promise.resolve({ data }).then(op),
      };
      return { select: () => bouwer as never };
    },
  };
  return { lezer, gelezen };
}

checkAsync("zonder ingang wordt er niets opgezocht", async () => {
  const { lezer, gelezen } = maakLezer({});
  const uit = await resolveerAssistentContext(lezer, null);
  assert.deepEqual(gelezen, []);
  assert.equal(uit.startSchoonGesprek, false);
  assert.deepEqual(uit.patch, {}, "zonder ingang wordt geen enkel veld aangeraakt");
});

checkAsync("?doc= zet de documentscope en start een schoon gesprek", async () => {
  const { lezer } = maakLezer({ documenten: { id: "d1", titel: "ABTN", actief: true } });
  const uit = await resolveerAssistentContext(lezer, {
    soort: "document",
    documentId: "d1",
  });
  assert.deepEqual(uit.patch.documentScope, { document_ids: ["d1"], titels: ["ABTN"] });
  assert.equal(uit.startSchoonGesprek, true);
});

checkAsync("een INACTIEF document levert geen scope", async () => {
  const { lezer } = maakLezer({ documenten: { id: "d1", titel: "Oud", actief: false } });
  const uit = await resolveerAssistentContext(lezer, {
    soort: "document",
    documentId: "d1",
  });
  assert.deepEqual(uit.patch, {}, "een inactief document raakt geen veld aan");
  assert.equal(uit.startSchoonGesprek, false);
});

checkAsync("een document zonder titel krijgt de terugvaltekst", async () => {
  const { lezer } = maakLezer({ documenten: { id: "d1" } });
  const uit = await resolveerAssistentContext(lezer, {
    soort: "document",
    documentId: "d1",
  });
  assert.deepEqual(uit.patch.documentScope?.titels, ["dit document"]);
});

checkAsync("?agendapunt= zet de framing én de gekoppelde stukken", async () => {
  const { lezer } = maakLezer({
    agendapunten: { id: "a1", titel: "Vaststellen jaarrekening" },
    documenten: [
      { id: "s1", titel: "Jaarrekening" },
      { id: "s2", titel: null },
      { id: null, titel: "kapot" },
    ],
  });
  const uit = await resolveerAssistentContext(lezer, {
    soort: "agendapunt",
    agendapuntId: "a1",
  });
  assert.deepEqual(uit.patch.agendapuntContext, {
    id: "a1",
    titel: "Vaststellen jaarrekening",
  });
  // De rij zonder id valt weg; een stuk zonder titel krijgt de terugvaltekst.
  assert.deepEqual(uit.patch.documentScope, {
    document_ids: ["s1", "s2"],
    titels: ["Jaarrekening", "stuk"],
  });
});

checkAsync("een agendapunt zonder stukken houdt de framing, zonder scope", async () => {
  const { lezer } = maakLezer({ agendapunten: { id: "a1", titel: "Rondvraag" }, documenten: [] });
  const uit = await resolveerAssistentContext(lezer, {
    soort: "agendapunt",
    agendapuntId: "a1",
  });
  assert.equal(uit.patch.agendapuntContext?.titel, "Rondvraag");
  assert.equal(uit.patch.documentScope, null);
  assert.equal(uit.startSchoonGesprek, true);
});

checkAsync("?proces= draagt alleen de sleutel + een chip-label", async () => {
  const { lezer } = maakLezer({ procedures: { id: "p1", titel: "Invaren" } });
  const uit = await resolveerAssistentContext(lezer, {
    soort: "proces",
    procedureId: "p1",
  });
  assert.deepEqual(uit.patch.moduleScope, {
    soort: "proces",
    procedure_id: "p1",
    label: "Invaren",
  });
});

checkAsync("?risicomatrix=1 laadt de verdieplijst", async () => {
  const { lezer } = maakLezer({
    risicos: [
      { id: "r1", titel: "Renterisico" },
      { id: "r2", titel: null },
      { titel: "zonder id" },
    ],
  });
  const uit = await resolveerAssistentContext(lezer, { soort: "risicomatrix" });
  assert.deepEqual(uit.patch.moduleScope, { soort: "risicomatrix", label: "de risicomatrix" });
  assert.deepEqual(uit.patch.risicoLijst, [
    { id: "r1", titel: "Renterisico" },
    { id: "r2", titel: "risico" },
  ]);
});

checkAsync("een onbekend id levert de lege context, geen fout", async () => {
  const { lezer } = maakLezer({ procedures: null });
  const uit = await resolveerAssistentContext(lezer, {
    soort: "proces",
    procedureId: "bestaat-niet",
  });
  assert.deepEqual(uit.patch, {});
  assert.equal(uit.startSchoonGesprek, false);
});

checkAsync("?doc= laat een agendapunt-framing uit een hersteld gesprek STAAN", async () => {
  // Het origineel zette per tak alleen zijn eigen velden. Een patch met alleen
  // `documentScope` bewaart dat: `agendapuntContext` ontbreekt en wordt dus niet
  // aangeraakt. Zou hier een volledige context staan, dan wiste ?doc= de framing
  // van een net herstelde agendapunt-chat — zonder dat iemand het zou merken.
  const { lezer } = maakLezer({ documenten: { id: "d1", titel: "ABTN", actief: true } });
  const uit = await resolveerAssistentContext(lezer, { soort: "document", documentId: "d1" });
  assert.ok(!("agendapuntContext" in uit.patch));
  assert.ok(!("moduleScope" in uit.patch));
});

checkAsync("een kapotte deeplink maakt de assistent niet onbruikbaar", async () => {
  const stuk: ContextLezer = {
    from() {
      throw new Error("RLS weigerde de query");
    },
  };
  const uit = await resolveerAssistentContext(stuk, { soort: "document", documentId: "d1" });
  assert.deepEqual(uit.patch, {});
  assert.equal(uit.startSchoonGesprek, false);
});

void Promise.all(wachtend).then(() => {
  console.log(`\n${n} sanity-tests geslaagd.`);
});
