import assert from "node:assert/strict";
import { maakIdempotentVerzoek } from "./idempotency-key";

let n = 0;
const check = (naam: string, fn: () => void) => {
  fn();
  n += 1;
  console.log(`  ✓ ${naam}`);
};

console.log("idempotency-key sanity-tests:");

check("dezelfde logische actie houdt bij een retry dezelfde sleutel", () => {
  const verzoek = maakIdempotentVerzoek(
    () => "11111111-1111-4111-8111-111111111111"
  );

  assert.equal(
    verzoek.headers({ "Content-Type": "application/json" }).get("Idempotency-Key"),
    verzoek.sleutel
  );
  assert.equal(verzoek.headers().get("Idempotency-Key"), verzoek.sleutel);
});

check("een nieuwe logische actie krijgt een nieuwe sleutel", () => {
  const uuids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];
  const uuidBron = () => uuids.shift()!;

  const eerste = maakIdempotentVerzoek(uuidBron);
  const tweede = maakIdempotentVerzoek(uuidBron);

  assert.notEqual(eerste.sleutel, tweede.sleutel);
});

check("de sleutel voldoet aan de servervalidatie", () => {
  const verzoek = maakIdempotentVerzoek(
    () => "123e4567-e89b-42d3-a456-426614174000"
  );

  assert.ok(verzoek.sleutel.length >= 8 && verzoek.sleutel.length <= 200);
  assert.match(verzoek.sleutel, /^[A-Za-z0-9._:-]+$/);
});

console.log(`\n${n} sanity-tests geslaagd.`);
