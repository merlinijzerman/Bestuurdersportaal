import assert from "node:assert/strict";
import test from "node:test";
import {
  eersteWerkbakItems,
  isAchterstallig,
  sorteerWerkbak,
  type WerkbakItem,
} from "./werkbak-afleiding";

const item = (id: string, deadline: string | null): WerkbakItem => ({
  id,
  soort: "actie",
  titel: id,
  herkomst: "Dossier",
  deadline,
  href: "/procedures/p",
});

test("werkbak: vandaag is niet achterstallig", () => {
  assert.equal(isAchterstallig(item("vandaag", "2026-08-30"), "2026-08-30"), false);
  assert.equal(isAchterstallig(item("gisteren", "2026-08-29"), "2026-08-30"), true);
});

test("werkbak: achterstallige items worden nooit door het rustpunt verborgen", () => {
  const items = Array.from({ length: 8 }, (_, index) => item(`laat-${index}`, "2026-08-01"));
  assert.equal(eersteWerkbakItems(items, "2026-08-30").length, 8);
});

test("werkbak: vult na achterstand aan tot zeven met de eerstvolgende datum", () => {
  const zichtbare = eersteWerkbakItems(
    [
      item("laat", "2026-08-20"),
      item("ver", "2026-10-01"),
      item("geen-datum", null),
      item("eerst", "2026-09-01"),
      item("tweede", "2026-09-02"),
      item("derde", "2026-09-03"),
      item("vierde", "2026-09-04"),
      item("vijfde", "2026-09-05"),
    ],
    "2026-08-30"
  );
  assert.deepEqual(zichtbare.map((i) => i.id), ["laat", "eerst", "tweede", "derde", "vierde", "vijfde", "ver"]);
});

test("werkbak: items zonder datum staan onderaan", () => {
  assert.deepEqual(
    sorteerWerkbak([item("geen", null), item("later", "2026-09-02"), item("eerst", "2026-09-01")]).map((i) => i.id),
    ["eerst", "later", "geen"]
  );
});
