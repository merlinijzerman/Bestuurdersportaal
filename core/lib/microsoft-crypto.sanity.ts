import assert from "node:assert/strict";
import test from "node:test";
import {
  ontsleutelMetMicrosoftSleutel,
  versleutelMetMicrosoftSleutel,
  type VersleuteldBlob,
} from "./microsoft-crypto-core";

const sleutel = { versie: 7, sleutel: Buffer.alloc(32, 0x42) };
const aad = "m365:v1:fonds-a:gebruiker-a:cache";

test("Microsoft AES-256-GCM-cache roundtrip", () => {
  const blob = versleutelMetMicrosoftSleutel('{"cache":"gevoelig"}', aad, sleutel);
  assert.equal(ontsleutelMetMicrosoftSleutel(blob, aad, sleutel), '{"cache":"gevoelig"}');
  assert.equal(Buffer.from(blob.iv, "base64").length, 12);
  assert.equal(Buffer.from(blob.tag, "base64").length, 16);
});

test("andere fonds-/gebruikersbinding faalt gesloten", () => {
  const blob = versleutelMetMicrosoftSleutel("geheim", aad, sleutel);
  assert.throws(
    () => ontsleutelMetMicrosoftSleutel(blob, "m365:v1:fonds-b:gebruiker-a:cache", sleutel),
    /kon niet veilig worden ontsleuteld/,
  );
});

test("gewijzigde ciphertext of tag faalt gesloten", () => {
  const blob = versleutelMetMicrosoftSleutel("geheim", aad, sleutel);
  const wijzig = (waarde: string) => `${waarde.slice(0, -2)}AA`;
  for (const vervalst of [
    { ...blob, ciphertext: wijzig(blob.ciphertext) },
    { ...blob, tag: wijzig(blob.tag) },
  ] satisfies VersleuteldBlob[]) {
    assert.throws(
      () => ontsleutelMetMicrosoftSleutel(vervalst, aad, sleutel),
      /kon niet veilig worden ontsleuteld/,
    );
  }
});

test("onbekende sleutelversie en ongeldige sleutellengte worden geweigerd", () => {
  const blob = versleutelMetMicrosoftSleutel("geheim", aad, sleutel);
  assert.throws(
    () => ontsleutelMetMicrosoftSleutel(blob, aad, { ...sleutel, versie: 8 }),
    /niet-beschikbare sleutelversie/,
  );
  assert.throws(
    () => versleutelMetMicrosoftSleutel("geheim", aad, { versie: 1, sleutel: Buffer.alloc(16) }),
    /geen geldige AES-256-sleutel/,
  );
});
