import assert from "node:assert/strict";
import test from "node:test";
import { effortVoorChatAntwoord, standaardEffortVoorTaaktype } from "./ai-effort";

test("routermapping koppelt snelle feiten aan low en bestuurlijk werk aan high/xhigh", () => {
  assert.equal(effortVoorChatAntwoord({ antwoordmodus: "feitelijk", grondigeAnalyse: false, stukvoorbereiding: false, opsteltaak: false }), "low");
  assert.equal(effortVoorChatAntwoord({ antwoordmodus: "bronoverzicht", grondigeAnalyse: false, stukvoorbereiding: false, opsteltaak: false }), "low");
  assert.equal(effortVoorChatAntwoord({ antwoordmodus: "historisch", grondigeAnalyse: false, stukvoorbereiding: false, opsteltaak: false }), "medium");
  assert.equal(effortVoorChatAntwoord({ antwoordmodus: "duiding", grondigeAnalyse: false, stukvoorbereiding: false, opsteltaak: false }), "high");
  assert.equal(effortVoorChatAntwoord({ antwoordmodus: "besluitrijpheid", grondigeAnalyse: false, stukvoorbereiding: false, opsteltaak: false }), "xhigh");
});

test("stukvoorbereiding is xhigh en alleen de expliciete productknop kiest max", () => {
  assert.equal(effortVoorChatAntwoord({ antwoordmodus: "feitelijk", grondigeAnalyse: false, stukvoorbereiding: true, opsteltaak: false }), "xhigh");
  assert.equal(effortVoorChatAntwoord({ antwoordmodus: "besluitrijpheid", grondigeAnalyse: true, stukvoorbereiding: false, opsteltaak: false }), "max");
});

test("vergelijkingscalls en hulp-/concepttaken hebben expliciete defaults", () => {
  assert.equal(standaardEffortVoorTaaktype("vergelijk_dimensies"), "low");
  assert.equal(standaardEffortVoorTaaktype("vergelijk_waarde"), "medium");
  assert.equal(standaardEffortVoorTaaktype("chat_contextresolutie"), "low");
  assert.equal(standaardEffortVoorTaaktype("samenvatting"), "medium");
  assert.equal(standaardEffortVoorTaaktype("afschrift_concept"), "xhigh");
  assert.equal(standaardEffortVoorTaaktype("besluit_concept"), "xhigh");
});
