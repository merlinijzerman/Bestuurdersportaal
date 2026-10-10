import assert from "node:assert/strict";
import {
  BRONGEBONDEN_CIJFERS_INSTRUCTIE,
  BRONGEBONDEN_CIJFERS_TERUGVAL,
  vraagtBrongebondenCijfer,
  vraagtBrongebondenCijferInGesprek,
  heeftBronloosCijfer,
} from "./brongebonden-cijfers";

const kostenvraag =
  "Wat zijn de gemiddelde uitvoeringskosten per deelnemer volgens openbare rapportages? Noem de bron en het verslagjaar.";

assert.equal(vraagtBrongebondenCijfer(kostenvraag), true);
assert.equal(vraagtBrongebondenCijfer("Welk percentage noemt het jaarverslag?"), true);
assert.equal(vraagtBrongebondenCijfer("Wat is deeltijdpensioen?"), false);
assert.equal(vraagtBrongebondenCijfer("Welke onderdelen bevat artikel 150d Pensioenwet?"), false);
assert.equal(vraagtBrongebondenCijfer("Welke bron legt de definitie uit?"), false);
assert.equal(vraagtBrongebondenCijferInGesprek("En voor 2023?", [kostenvraag]), true);
assert.equal(vraagtBrongebondenCijferInGesprek("Geef dan een indicatie", [kostenvraag]), true);
assert.equal(vraagtBrongebondenCijferInGesprek("En voor 2023?", ["Wat is deeltijdpensioen?"]), false);
assert.equal(vraagtBrongebondenCijferInGesprek("Wat is deeltijdpensioen?", [kostenvraag]), false);

assert.equal(
  heeftBronloosCijfer("Het gemiddelde is circa € 100 à € 130 [Algemene kennis].", 10),
  true,
  "de Productiecanary mag geen bronloze bandbreedte tonen"
);
assert.equal(heeftBronloosCijfer("Het gemiddelde is € 120 per deelnemer.", 10), true);
assert.equal(heeftBronloosCijfer("De kosten zijn EUR 100 per deelnemer.", 10), true);
assert.equal(heeftBronloosCijfer("De kosten zijn 100,- per deelnemer.", 10), true);
assert.equal(heeftBronloosCijfer("De kosten zijn 1,2 miljoen per jaar.", 10), true);
assert.equal(heeftBronloosCijfer("Het percentage is 12% [Bron 11].", 10), true);
assert.equal(heeftBronloosCijfer("Het percentage is 12% [Bron 2].", 10), false);
assert.equal(heeftBronloosCijfer("In het verslag staat 1.234 euro [Bron 1].", 1), false);
assert.equal(
  heeftBronloosCijfer("De kosten zijn € 95 [Bron 1]. De stijging is 5% [Algemene kennis].", 1),
  true,
  "een geciteerd bedrag dekt geen tweede, bronloos percentage"
);
assert.equal(
  heeftBronloosCijfer("Artikel 150d noemt de onderdelen a–f [Bron 1]. Verslagjaar 2025.", 1),
  false,
  "artikel- en jaarnummers zijn geen geldbedragen of percentages"
);
assert.equal(heeftBronloosCijfer("De passages geven geen citeerbaar sectorgemiddelde.", 0), false);
assert.match(BRONGEBONDEN_CIJFERS_INSTRUCTIE, /geen schatting, bandbreedte/i);
assert.doesNotMatch(BRONGEBONDEN_CIJFERS_TERUGVAL, /\d/);

console.log("brongebonden-cijfers sanity groen");
