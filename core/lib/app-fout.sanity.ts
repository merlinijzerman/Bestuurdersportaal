// ============================================================
//  Sanity-tests voor core/lib/app-fout.ts (P5, monitoringbasis).
//
//  Het zwaartepunt ligt op de NEGATIEVE CONTROLE: acceptatiecriterium 2 van de
//  werkopdracht eist dat een foutregel aantoonbaar géén prompt-, document- of
//  deelnemergegevens bevat. Dat "aantoonbaar" is precies dit bestand — de
//  fixtures hieronder zijn vijandig bedoeld: ze stoppen echte gevoelige inhoud
//  in een Error en eisen dat er niets van overleeft.
//
//  Een test die alleen bevestigt dat de gelukkige weg werkt, bewijst niets over
//  een lek. Daarom staat bij elke redactietest óók de assertie dat de payload
//  zelf niet meer voorkomt in het record — als hele string én als losse
//  kenmerkende fragmenten.
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/app-fout.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  MAX_MELDING,
  MAX_WOORDEN,
  MELDING_ONDERDRUKT,
  RUW_MAX,
  bouwAppFout,
  contextSleutels,
  leidCategorieAf,
  leidFoutcodeAf,
  leidFouttypeAf,
  leidSeverityAf,
  saniteerMelding,
  type AppFoutRecord,
} from "./app-fout";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

/** Alles wat het record aan tekst draagt, als één doorzoekbare string. */
function alleTekst(rec: AppFoutRecord): string {
  return [
    rec.label,
    rec.categorie,
    rec.severity,
    rec.fouttype ?? "",
    rec.foutcode ?? "",
    rec.meldingKort ?? "",
    rec.contextSleutels.join(" "),
    rec.correlatieId ?? "",
    String(rec.httpStatus ?? ""),
  ].join(" | ");
}

/** Eist dat geen enkel fragment van de payload het record heeft gehaald. */
function eisGeenLek(rec: AppFoutRecord, fragmenten: string[], geval: string) {
  const tekst = alleTekst(rec).toLowerCase();
  for (const fragment of fragmenten) {
    assert.equal(
      tekst.includes(fragment.toLowerCase()),
      false,
      `LEK (${geval}): "${fragment}" staat in het foutrecord → ${alleTekst(rec)}`
    );
  }
}

console.log("app-fout sanity-tests:");

// ── Negatieve controle: gevoelige inhoud mag nergens landen ─────────────────

test("NEGATIEF — promptfragment in de melding lekt niet", () => {
  const prompt =
    "Je bent een bestuurlijke assistent voor Stichting Pensioenfonds Horizon. " +
    "Beantwoord uitsluitend op basis van de meegeleverde fondsdocumenten en " +
    "verwijs bij elke bewering naar de bron waaruit die volgt.";
  const rec = bouwAppFout({
    label: "chat.POST",
    error: new Error(`Modelaanroep mislukt voor prompt: ${prompt}`),
    httpStatus: 500,
  });
  eisGeenLek(
    rec,
    ["bestuurlijke assistent", "Pensioenfonds Horizon", "fondsdocumenten", prompt],
    "prompt"
  );
  assert.equal(rec.meldingKort, MELDING_ONDERDRUKT);
});

test("NEGATIEF — documentinhoud in de melding lekt niet", () => {
  const document =
    "Het bestuur heeft op 14 maart besloten de dekkingsgraad-ondergrens te " +
    "verlagen naar 104 procent, waarmee de indexatieambitie voor het lopende " +
    "jaar wordt losgelaten.";
  const rec = bouwAppFout({
    label: "documents.her-extract.POST",
    error: new Error(`Extractie mislukt voor: ${document}`),
    httpStatus: 500,
  });
  eisGeenLek(
    rec,
    ["dekkingsgraad", "indexatieambitie", "het bestuur heeft", document],
    "documentinhoud"
  );
  assert.equal(rec.meldingKort, MELDING_ONDERDRUKT);
});

test("NEGATIEF — deelnemergegevens (naam, BSN, e-mail, geboortedatum) lekken niet", () => {
  const rec = bouwAppFout({
    label: "documents.upload.POST",
    error: new Error(
      "Verwerking mislukt voor 123456782 (a.dejong@voorbeeld.nl)"
    ),
    httpStatus: 500,
  });
  eisGeenLek(
    rec,
    ["123456782", "a.dejong@voorbeeld.nl", "voorbeeld.nl", "dejong"],
    "deelnemergegevens"
  );
});

test("NEGATIEF — Supabase-rijdump (kolomnamen + waarden) lekt niet", () => {
  // Vorm van een echte PostgrestError. `details` en `hint` zijn precies de
  // velden waar Supabase kolomnamen en rij-inhoud in zet.
  const rec = bouwAppFout({
    label: "procedures.dossier.GET",
    error: {
      code: "23505",
      message: 'duplicate key value violates unique constraint "documenten_pkey"',
      details:
        'Key (id, fonds_id, titel)=(9f2c1b44-7d3e-4a10-9c55-8e21b0f4a7d2, ' +
        "3b7e9a10-0c22-4f81-a6de-55c1f2b83a90, Herstelplan DNB 2026) already exists.",
      hint: "Controleer documenten.titel op duplicaten binnen hetzelfde fonds.",
    },
    httpStatus: 500,
  });
  eisGeenLek(
    rec,
    [
      "Herstelplan DNB 2026",
      "9f2c1b44-7d3e-4a10-9c55-8e21b0f4a7d2",
      "3b7e9a10-0c22-4f81-a6de-55c1f2b83a90",
      "documenten.titel",
      "Controleer documenten",
      "already exists",
    ],
    "Supabase-rijdump"
  );
  // De code zelf is wél waardevol en veilig — dat is de hele winst.
  assert.equal(rec.foutcode, "23505");
  assert.equal(rec.fouttype, "PostgrestError");
});

test("NEGATIEF — contextWAARDEN gaan nooit mee, alleen de sleutels", () => {
  const rec = bouwAppFout({
    label: "chat.POST",
    error: new Error("mislukt"),
    httpStatus: 500,
    context: {
      vraag: "Wat is onze actuele beleidsdekkingsgraad?",
      documentId: "9f2c1b44-7d3e-4a10-9c55-8e21b0f4a7d2",
      gebruikerEmail: "voorzitter@horizon.nl",
    },
  });
  assert.deepEqual(rec.contextSleutels, ["vraag", "documentId", "gebruikerEmail"]);
  eisGeenLek(
    rec,
    [
      "beleidsdekkingsgraad",
      "9f2c1b44-7d3e-4a10-9c55-8e21b0f4a7d2",
      "voorzitter@horizon.nl",
    ],
    "contextwaarden"
  );
});

test("NEGATIEF — een willekeurig object wordt niet geserialiseerd", () => {
  // Zou JSON.stringify hier toeslaan, dan lag de hele payload in de tabel.
  const rec = bouwAppFout({
    label: "zoeken.POST",
    error: { vraag: "Wat staat er in het herstelplan?", fondsId: "geheim-1" },
    httpStatus: 500,
  });
  assert.equal(rec.meldingKort, null);
  eisGeenLek(rec, ["herstelplan", "geheim-1"], "objectdump");
});

// ── Redactiepijplijn per klasse ─────────────────────────────────────────────

test("redactie — UUID's worden vervangen", () => {
  const uit = saniteerMelding(
    new Error("rij 9f2c1b44-7d3e-4a10-9c55-8e21b0f4a7d2 niet gevonden")
  );
  assert.ok(uit && uit.includes("<uuid>"), `verwacht <uuid>, kreeg: ${uit}`);
  assert.equal(uit.includes("9f2c1b44"), false);
});

test("redactie — e-mailadressen worden vervangen", () => {
  const uit = saniteerMelding(new Error("afzender a.dejong@voorbeeld.nl geweigerd"));
  assert.ok(uit && uit.includes("<email>"), `verwacht <email>, kreeg: ${uit}`);
  assert.equal(uit.includes("voorbeeld.nl"), false);
});

test("redactie — URL behoudt alleen de host, niet pad of query", () => {
  const uit = saniteerMelding(
    new Error("GET https://api.voorbeeld.nl/v1/deelnemers/44?bsn=123456782 faalde")
  );
  assert.ok(uit && uit.includes("https://api.voorbeeld.nl"), `kreeg: ${uit}`);
  assert.equal(uit.includes("deelnemers"), false);
  assert.equal(uit.includes("123456782"), false);
});

test("redactie — quoted literals worden geneutraliseerd (kolom-/tabelnamen, waarden)", () => {
  const uit = saniteerMelding(
    new Error('column "beleidsdekkingsgraad" of relation "stuurinfo" does not exist')
  );
  assert.ok(uit, "verwacht een melding");
  assert.equal(uit.includes("beleidsdekkingsgraad"), false);
  assert.equal(uit.includes("stuurinfo"), false);
  // De vorm van de fout blijft leesbaar — dat is het punt van redigeren i.p.v. weggooien.
  assert.ok(uit.includes("does not exist"), `kreeg: ${uit}`);
});

test("redactie — lange cijferreeksen worden vervangen, korte getallen blijven", () => {
  const uit = saniteerMelding(new Error("batch 7 faalde op record 123456782"));
  assert.ok(uit && uit.includes("<n>"), `kreeg: ${uit}`);
  assert.equal(uit!.includes("123456782"), false);
  assert.ok(uit!.includes("7"), "een los klein getal is geen persoonsgegeven");
});

// ── Vormeisen ───────────────────────────────────────────────────────────────

test("vormeis — ruwe melding langer dan RUW_MAX wordt onderdrukt, niet geredigeerd", () => {
  const uit = saniteerMelding(new Error("a".repeat(RUW_MAX + 1)));
  assert.equal(uit, MELDING_ONDERDRUKT);
});

test("vormeis — meer dan MAX_WOORDEN woorden leest als proza en wordt onderdrukt", () => {
  const proza = Array.from({ length: MAX_WOORDEN + 1 }, (_, i) => `woord${i}`).join(" ");
  assert.equal(saniteerMelding(new Error(proza)), MELDING_ONDERDRUKT);
});

test("vormeis — precies MAX_WOORDEN woorden blijft behouden (randgeval)", () => {
  const grens = Array.from({ length: MAX_WOORDEN }, (_, i) => `w${i}`).join(" ");
  assert.equal(saniteerMelding(new Error(grens)), grens);
});

test("vormeis — melding wordt nooit langer dan MAX_MELDING", () => {
  // Eén lang woord: haalt de woordeis wél, de lengte-eis niet.
  const lang = "x".repeat(RUW_MAX - 1);
  const uit = saniteerMelding(new Error(lang));
  assert.ok(uit !== null);
  assert.ok(uit!.length <= MAX_MELDING, `lengte ${uit!.length} > ${MAX_MELDING}`);
});

test("vormeis — alleen de eerste regel telt (een stacktrace lekt niet mee)", () => {
  const uit = saniteerMelding(
    new Error("kan niet verbinden\n    at Object.<anonymous> (/var/task/app/api/chat/route.ts:1461:20)")
  );
  assert.equal(uit, "kan niet verbinden");
});

test("vormeis — lege of ontbrekende melding geeft null, niet een lege string", () => {
  assert.equal(saniteerMelding(null), null);
  assert.equal(saniteerMelding(undefined), null);
  assert.equal(saniteerMelding(new Error("")), null);
  assert.equal(saniteerMelding(new Error("   ")), null);
});

// ── Categorisering ──────────────────────────────────────────────────────────

test("categorie — HTTP-status wint van de labelconventie", () => {
  assert.equal(leidCategorieAf("chat.POST", new Error("x"), 401, null), "auth_sessie");
  assert.equal(leidCategorieAf("chat.POST", new Error("x"), 403, null), "autorisatie");
  assert.equal(leidCategorieAf("chat.POST", new Error("x"), 429, null), "rate_limiting");
  assert.equal(leidCategorieAf("chat.POST", new Error("x"), 400, null), "validatie");
});

test("categorie — labelconventie dekt de bestaande routelabels", () => {
  const gevallen: Array<[string, string]> = [
    ["documents.upload.POST", "upload_bestandsveiligheid"],
    ["documents.her-extract.POST", "extractie_ocr"],
    ["notulen.segmenteer.POST", "extractie_ocr"],
    ["documents.embeddings-backfill.POST", "embedding_indexering"],
    ["documents.reindex-backfill.POST", "embedding_indexering"],
    ["catalogus.import", "embedding_indexering"],
    ["chat.POST", "retrieval_ai"],
    ["zoeken.POST", "retrieval_ai"],
    ["aqlab.worker", "retrieval_ai"],
  ];
  for (const [label, verwacht] of gevallen) {
    assert.equal(
      leidCategorieAf(label, new Error("x"), 500, null),
      verwacht,
      `label ${label}`
    );
  }
});

test("categorie — een SQLSTATE wint van de labelconventie", () => {
  assert.equal(
    leidCategorieAf("chat.POST", { code: "23505", message: "x" }, 500, "23505"),
    "database_integriteit"
  );
});

test("categorie — netwerkfouten worden externe afhankelijkheid", () => {
  const netwerk = Object.assign(new Error("connect ECONNREFUSED"), {
    code: "ECONNREFUSED",
  });
  assert.equal(
    leidCategorieAf("chat.POST", netwerk, 500, "ECONNREFUSED"),
    "externe_afhankelijkheid"
  );
});

test("categorie — een expliciete override wint van elke afleiding", () => {
  const rec = bouwAppFout({
    label: "chat.POST",
    error: new Error("x"),
    httpStatus: 429,
    categorie: "retrieval_ai",
  });
  assert.equal(rec.categorie, "retrieval_ai");
});

// ── Severity ────────────────────────────────────────────────────────────────

test("severity — 5xx is hoog, 4xx is laag, auth/autorisatie is middel", () => {
  assert.equal(leidSeverityAf("retrieval_ai", 500, null), "hoog");
  assert.equal(leidSeverityAf("validatie", 400, null), "laag");
  assert.equal(leidSeverityAf("auth_sessie", 401, null), "middel");
  assert.equal(leidSeverityAf("autorisatie", 403, null), "middel");
});

test("severity — infrastructuur-SQLSTATE is kritiek, ook bij een 500", () => {
  assert.equal(leidSeverityAf("database_integriteit", 500, "08006"), "kritiek");
  assert.equal(leidSeverityAf("database_integriteit", 500, "57014"), "kritiek");
  // 42P01 = undefined_table → migratie niet gedraaid; dat moet meteen opvallen.
  assert.equal(leidSeverityAf("database_integriteit", 500, "42P01"), "kritiek");
  // Een gewone unieke-sleutelschending is dat níet.
  assert.equal(leidSeverityAf("database_integriteit", 500, "23505"), "hoog");
});

test("severity — een expliciete override wint", () => {
  const rec = bouwAppFout({
    label: "rate-limit.chat",
    error: new Error("check mislukt"),
    categorie: "rate_limiting",
    severity: "hoog",
  });
  assert.equal(rec.severity, "hoog");
});

// ── Fouttype en foutcode ────────────────────────────────────────────────────

test("fouttype — klassenaam, geen inhoud", () => {
  assert.equal(leidFouttypeAf(new TypeError("x")), "TypeError");
  assert.equal(leidFouttypeAf(new Error("x")), "Error");
  assert.equal(leidFouttypeAf({ code: "23505", message: "x" }), "PostgrestError");
  assert.equal(leidFouttypeAf(null), null);
});

test("foutcode — alleen codevormige waarden; een tekst wordt geweigerd", () => {
  assert.equal(leidFoutcodeAf({ code: "PGRST116" }, null), "PGRST116");
  assert.equal(leidFoutcodeAf({ code: "23505" }, null), "23505");
  // Een 'code' die in werkelijkheid een zin is, mag er niet via de achterdeur in.
  assert.equal(
    leidFoutcodeAf({ code: "Herstelplan DNB 2026 bestaat al" }, 500),
    "http_500"
  );
});

test("foutcode — valt terug op de HTTP-status als er geen code is", () => {
  assert.equal(leidFoutcodeAf(new Error("x"), 503), "http_503");
  assert.equal(leidFoutcodeAf(new Error("x"), null), null);
});

// ── Robuustheid: een logger mag nooit zelf de oorzaak van een storing worden ─

test("robuust — bouwAppFout werpt niet op rare invoer", () => {
  const raar: unknown[] = [
    null,
    undefined,
    0,
    "",
    [],
    Object.create(null),
    Symbol("x"),
  ];
  for (const error of raar) {
    const rec = bouwAppFout({ label: "onbekend", error });
    assert.ok(rec.categorie.length > 0);
    assert.ok(rec.severity.length > 0);
  }
});

test("robuust — een circulaire structuur breekt niets", () => {
  const circulair: Record<string, unknown> = { message: "kringloop" };
  circulair.zelf = circulair;
  const rec = bouwAppFout({ label: "chat.POST", error: circulair, httpStatus: 500 });
  assert.equal(rec.meldingKort, "kringloop");
});

test("robuust — contextSleutels kapt af op 20 en accepteert geen niet-object", () => {
  const groot: Record<string, unknown> = {};
  for (let i = 0; i < 50; i++) groot[`sleutel${i}`] = i;
  assert.equal(contextSleutels(groot).length, 20);
  assert.deepEqual(contextSleutels(undefined), []);
});

test("robuust — label wordt afgekapt (spiegelt left() in de RPC)", () => {
  const rec = bouwAppFout({ label: "l".repeat(500), error: new Error("x") });
  assert.ok(rec.label.length <= 120);
});

console.log(`\n${n} app-fout sanity-tests geslaagd.`);
