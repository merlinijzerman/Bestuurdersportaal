// ============================================================
//  Sanity-tests voor core/lib/procedure-activatie.ts (D6).
//
//  Dekt de testklassen uit PROCEDURE-ENGINE-V2-ONTWERP §8:
//   • parallelle-start: geen afhankelijkheden → alle stappen 'niet_begonnen'.
//   • gate-fixture: een keten activeert alleen de kop; na afronden van de
//     kop wordt de volgende activeerbaar; idempotent.
//   • heropen: afhankelijke afgeronde stappen worden gesignaleerd, niet
//     teruggezet.
//   • legacy 'open' wordt niet aangeraakt (snapshot-integriteit).
// ============================================================

import assert from "node:assert/strict";
import {
  beginStatussen,
  herberekenActiveerbaarheid,
  afhankelijkeAfgerondeStappen,
  alleStappenAfgerond,
  isActiveerbaar,
  type StapActivatieState,
} from "./procedure-activatie";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

// ── Parallelle start (invaar-shape: 12 stappen, geen deps) ────────────
check("parallelle start: alle dep-loze stappen worden niet_begonnen (P4)", () => {
  const stappen = Array.from({ length: 12 }, (_, i) => ({
    volgorde: i + 1,
    blokkerende_afhankelijkheden: [] as number[],
  }));
  const status = beginStatussen(stappen);
  assert.equal(status.size, 12);
  for (const [, s] of status) assert.equal(s, "niet_begonnen");
});

// ── Gate-fixture: keten 1 → 2 → 3 ─────────────────────────────────────
check("keten: alleen de kop is bij start niet_begonnen (P4)", () => {
  const stappen = [
    { volgorde: 1, blokkerende_afhankelijkheden: [] },
    { volgorde: 2, blokkerende_afhankelijkheden: [1] },
    { volgorde: 3, blokkerende_afhankelijkheden: [2] },
  ];
  const status = beginStatussen(stappen);
  assert.equal(status.get(1), "niet_begonnen");
  assert.equal(status.get(2), "geblokkeerd");
  assert.equal(status.get(3), "geblokkeerd");
});

check("na afronden kop wordt de volgende activeerbaar (niet de daaropvolgende)", () => {
  const stappen: StapActivatieState[] = [
    { volgorde: 1, status: "afgerond", blokkerende_afhankelijkheden: [] },
    { volgorde: 2, status: "geblokkeerd", blokkerende_afhankelijkheden: [1] },
    { volgorde: 3, status: "geblokkeerd", blokkerende_afhankelijkheden: [2] },
  ];
  const teActiveren = herberekenActiveerbaarheid(stappen);
  assert.deepEqual(teActiveren, [2]); // 3 blijft geblokkeerd tot 2 afgerond is
});

check("gate met meerdere afhankelijkheden: pas activeerbaar als ALLE afgerond", () => {
  const status = new Map<number, "afgerond" | "geblokkeerd">([
    [1, "afgerond"],
    [2, "geblokkeerd"],
  ]);
  assert.equal(isActiveerbaar([1, 2], status), false);
  status.set(2, "afgerond" as never);
  assert.equal(isActiveerbaar([1, 2], status), true);
});

check("herberekenen is idempotent (niets te activeren → leeg)", () => {
  const stappen: StapActivatieState[] = [
    { volgorde: 1, status: "afgerond", blokkerende_afhankelijkheden: [] },
    { volgorde: 2, status: "actief", blokkerende_afhankelijkheden: [1] },
  ];
  assert.deepEqual(herberekenActiveerbaarheid(stappen), []);
});

// ── Legacy 'open' wordt niet aangeraakt ───────────────────────────────
check("legacy 'open'-stappen worden niet geactiveerd door de recompute", () => {
  const stappen: StapActivatieState[] = [
    { volgorde: 1, status: "afgerond", blokkerende_afhankelijkheden: [] },
    { volgorde: 2, status: "open", blokkerende_afhankelijkheden: [] },
  ];
  assert.deepEqual(herberekenActiveerbaarheid(stappen), []);
});

// ── Heropenen ─────────────────────────────────────────────────────────
check("heropenen signaleert afhankelijke afgeronde stappen (zonder terugzetten)", () => {
  const stappen: StapActivatieState[] = [
    { volgorde: 5, status: "heropend", blokkerende_afhankelijkheden: [] },
    { volgorde: 7, status: "afgerond", blokkerende_afhankelijkheden: [5] },
    { volgorde: 8, status: "afgerond", blokkerende_afhankelijkheden: [] },
  ];
  const teHerbevestigen = afhankelijkeAfgerondeStappen(stappen, 5);
  assert.deepEqual(teHerbevestigen, [7]); // 8 hangt niet van 5 af
  // De recompute zet 7 NIET terug naar geblokkeerd (geen cascade).
  assert.deepEqual(herberekenActiveerbaarheid(stappen), []);
});

check("invaar (geen deps): heropenen raakt geen andere stap", () => {
  const stappen: StapActivatieState[] = Array.from({ length: 12 }, (_, i) => ({
    volgorde: i + 1,
    status: i === 4 ? ("heropend" as const) : ("afgerond" as const),
    blokkerende_afhankelijkheden: [] as number[],
  }));
  assert.deepEqual(afhankelijkeAfgerondeStappen(stappen, 5), []);
});

// ── Procedure-afronding ───────────────────────────────────────────────
check("alleStappenAfgerond alleen bij álle stappen afgerond", () => {
  assert.equal(
    alleStappenAfgerond([{ status: "afgerond" }, { status: "afgerond" }]),
    true
  );
  assert.equal(
    alleStappenAfgerond([{ status: "afgerond" }, { status: "actief" }]),
    false
  );
  assert.equal(alleStappenAfgerond([]), false);
});

console.log(`\nprocedure-activatie.sanity: ${n} checks groen.`);
