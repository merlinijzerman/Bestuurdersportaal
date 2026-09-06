import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  BINDING_STATUSSEN,
  LEVENDE_STATUSSEN,
  gatewayFoutcategorie,
  identiteitHash,
  isBindingStatus,
  isGeldigeIdentiteitsvorm,
  isLevend,
  magOvergang,
} from "./microsoft-login-binding-core";

test("toestandsmodel: pending → active → revoking → revoked | failed, eindtoestanden zonder uitgang", () => {
  assert.equal(magOvergang("pending", "active"), true);
  assert.equal(magOvergang("pending", "failed"), true);
  assert.equal(magOvergang("active", "revoking"), true);
  assert.equal(magOvergang("revoking", "revoked"), true);
  for (const naar of BINDING_STATUSSEN) {
    assert.equal(magOvergang("revoked", naar), false, `revoked → ${naar}`);
    assert.equal(magOvergang("failed", naar), false, `failed → ${naar}`);
  }
  assert.equal(magOvergang("active", "pending"), false);
  assert.equal(magOvergang("pending", "revoking"), false);
  assert.equal(magOvergang("revoking", "active"), false);
  assert.equal(magOvergang("active", "revoked"), false, "revoked alleen via revoking");
});

test("levende statussen bezetten de unieke slots; eindtoestanden niet", () => {
  assert.deepEqual([...LEVENDE_STATUSSEN], ["pending", "active", "revoking"]);
  assert.equal(isLevend("active"), true);
  assert.equal(isLevend("revoked"), false);
  assert.equal(isLevend("failed"), false);
  assert.equal(isBindingStatus("active"), true);
  assert.equal(isBindingStatus("gekoppeld"), false);
});

test("foutcategorie: alleen de vaste DB-categorieën komen door, de rest wordt generiek", () => {
  assert.equal(gatewayFoutcategorie(new Error("fonds_mismatch")), "fonds_mismatch");
  assert.equal(gatewayFoutcategorie(new Error("binding_conflict")), "binding_conflict");
  assert.equal(gatewayFoutcategorie(new Error("ongeldige_overgang")), "ongeldige_overgang");
  assert.equal(gatewayFoutcategorie(new Error("onbekende_binding")), "onbekende_binding");
  assert.equal(gatewayFoutcategorie(new Error('duplicate key value violates unique constraint "x"')), "gateway_fout");
  assert.equal(gatewayFoutcategorie(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })), "gateway_db_onbereikbaar");
  assert.equal(gatewayFoutcategorie(Object.assign(new Error("terminating"), { code: "57P01" })), "gateway_db_onbereikbaar");
  assert.equal(gatewayFoutcategorie(new Error("Login-gateway-database is niet geconfigureerd.")), "config_ontbreekt");
  assert.equal(gatewayFoutcategorie("iets anders"), "gateway_fout");
  assert.equal(gatewayFoutcategorie(null), "gateway_fout");
});

test("identiteitshash is sha256(tid:oid) — gelijk aan de databaseberekening", () => {
  const tid = "11111111-1111-4111-8111-111111111111";
  const oid = "22222222-2222-4222-8222-222222222222";
  assert.equal(identiteitHash(tid, oid), createHash("sha256").update(`${tid}:${oid}`).digest("hex"));
  assert.notEqual(identiteitHash(tid, oid), identiteitHash(oid, tid));
});

test("identiteitsvorm: tid/oid als GUID, sub niet-leeg en begrensd", () => {
  const ok = { tid: "11111111-1111-4111-8111-111111111111", oid: "22222222-2222-4222-8222-222222222222", sub: "AbC-_123" };
  assert.equal(isGeldigeIdentiteitsvorm(ok), true);
  assert.equal(isGeldigeIdentiteitsvorm({ ...ok, tid: "common" }), false);
  assert.equal(isGeldigeIdentiteitsvorm({ ...ok, oid: "" }), false);
  assert.equal(isGeldigeIdentiteitsvorm({ ...ok, sub: "" }), false);
  assert.equal(isGeldigeIdentiteitsvorm({ ...ok, sub: "x".repeat(257) }), false);
});
