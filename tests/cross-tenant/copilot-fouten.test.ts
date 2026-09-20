// ============================================================================
//  #413 T4-B — Foutnormalisatie: vaste codes, geen providertekst, geen gissen.
// ----------------------------------------------------------------------------
//  Hermetisch: geen netwerk, geen database, geen token.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import {
  CopilotFout,
  foutVoorHttpStatus,
  normaliseerCopilotFout,
} from "../../core/lib/microsoft-retrieval/fouten";
import { RetrievalAfgebroken } from "../../core/lib/retrieval/afbreken";

test("elke HTTP-status krijgt één vaste categorie", () => {
  const verwacht: [number, string, string, boolean][] = [
    [401, "copilot_toegang_geweigerd", "toestemming_geweigerd", false],
    [403, "copilot_toegang_geweigerd", "toestemming_geweigerd", false],
    [402, "copilot_billing", "configuratiefout", false],
    [429, "copilot_rate_limit", "rate_limit", true],
    [500, "copilot_providerfout", "providerfout", true],
    [503, "copilot_providerfout", "providerfout", true],
    [599, "copilot_providerfout", "providerfout", true],
    [400, "copilot_configuratie", "configuratiefout", false],
    [404, "copilot_configuratie", "configuratiefout", false],
    [413, "copilot_configuratie", "configuratiefout", false],
    [302, "copilot_configuratie", "configuratiefout", false],
  ];
  for (const [status, code, categorie, herhaalbaar] of verwacht) {
    const fout = foutVoorHttpStatus(status);
    assert.equal(fout.code, code, `status ${status}`);
    assert.equal(fout.categorie, categorie, `status ${status}`);
    assert.equal(fout.herhaalbaar, herhaalbaar, `status ${status}`);
    assert.equal(fout.httpStatus, status);
  }
});

test("402 is een configuratiefout, geen autorisatieweigering", () => {
  // Anders wordt een ontbrekende billingpolicy in het auditspoor geboekt als
  // "deze gebruiker mocht dit niet zien" — en dat is aantoonbaar onwaar.
  const fout = foutVoorHttpStatus(402);
  assert.notEqual(fout.categorie, "toestemming_geweigerd");
  assert.equal(fout.categorie, "configuratiefout");
});

test("401 en 403 worden niet uit elkaar geraden", () => {
  assert.equal(foutVoorHttpStatus(401).code, foutVoorHttpStatus(403).code);
});

test("alleen 429 en 5xx zijn herhaalbaar", () => {
  for (const status of [400, 401, 402, 403, 404, 409, 422]) {
    assert.equal(foutVoorHttpStatus(status).herhaalbaar, false, `status ${status}`);
  }
  for (const status of [429, 500, 502, 503, 504]) {
    assert.equal(foutVoorHttpStatus(status).herhaalbaar, true, `status ${status}`);
  }
});

test("een afbreking wordt doorgegooid en niet tot een weigering gereduceerd", () => {
  const afbreking = new RetrievalAfgebroken("timeout");
  assert.throws(() => normaliseerCopilotFout(afbreking), (e: unknown) => e === afbreking);
});

test("ook een kaal AbortError of TimeoutError wordt doorgegooid", () => {
  // `isAfbreking()` herkent deze twee namen los van onze eigen foutklasse. Er
  // is dus geen enkel pad waarlangs een afgebroken beurt als providerfout of
  // als weigering in het auditspoor belandt.
  for (const naam of ["AbortError", "TimeoutError"]) {
    const abort = new Error("afgebroken");
    abort.name = naam;
    assert.throws(() => normaliseerCopilotFout(abort), (e: unknown) => e === abort, naam);
  }
});

test("een netwerkstoring is een providerfout, geen uitspraak over rechten", () => {
  const fout = normaliseerCopilotFout(new TypeError("fetch failed"));
  assert.equal(fout.code, "copilot_providerfout");
  assert.equal(fout.categorie, "providerfout");
  assert.equal(fout.herhaalbaar, true);
});

test("een bestaande CopilotFout wordt niet opnieuw ingepakt", () => {
  const origineel = new CopilotFout("copilot_budget", "configuratiefout");
  assert.equal(normaliseerCopilotFout(origineel), origineel);
});

test("er lekt geen providertekst in code, boodschap of eigenschappen", () => {
  const gemenerd = new Error(
    'Graph: {"error":{"message":"Access denied to https://contoso.sharepoint.com/sites/geheim/Beleid.docx"}}',
  );
  const fout = normaliseerCopilotFout(gemenerd);
  const serialized = JSON.stringify({
    code: fout.code,
    categorie: fout.categorie,
    httpStatus: fout.httpStatus,
    message: fout.message,
    herhaalbaar: fout.herhaalbaar,
  });
  for (const verboden of ["contoso", "sharepoint.com", "Beleid.docx", "Access denied", "geheim"]) {
    assert.equal(serialized.includes(verboden), false, `${verboden} lekt in de genormaliseerde fout`);
  }
  // De boodschap IS de code: er is geen vrij tekstveld om iets in te laten lopen.
  assert.equal(fout.message, fout.code);
});
