import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const hier = dirname(fileURLToPath(import.meta.url));
const home = readFileSync(
  join(hier, "..", "..", "app", "(dashboard)", "page.tsx"),
  "utf8"
);

test("app365 — Home leidt de vergaderbeschikbaarheid server-side af", () => {
  assert.match(
    home,
    /moduleBeschikbaar\(profiel\.fonds_id,\s*"vergaderingen"\)/,
    "Home moet de fondsgebonden modulebeschikbaarheid gebruiken"
  );
});

test("app365 — Home verbergt vergaderwerk en vergader-ingangen als de module uitstaat", () => {
  assert.match(
    home,
    /werkbak\.filter\(\(item\) => item\.soort !== "vergadering"\)/,
    "de persoonlijke werkbak mag geen vergader-deeplinks houden"
  );
  assert.match(
    home,
    /notificaties\.filter\(\(notificatie\) => notificatie\.gerelateerd_aan_type !== "agendapunt"\)/,
    "vergadernotificaties mogen geen alternatieve deeplink op Home houden"
  );
  assert.match(
    home,
    /\{vergaderingenBeschikbaar && \(\s*<Link\s+href="\/vergaderingen"/,
    "de hero-ingang moet achter de manifestbeschikbaarheid staan"
  );
  assert.match(
    home,
    /\{vergaderingenBeschikbaar && \(\s*<section className="portal-card p-5">/,
    "de volledige voorbereidingskaart moet verdwijnen als de module uitstaat"
  );
});
