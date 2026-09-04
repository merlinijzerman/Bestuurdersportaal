import assert from "node:assert/strict";
import test from "node:test";
import {
  OutlookGraphError,
  graphGet,
  normaliseerGraphUtc,
  normaliseerSensitivity,
  projecteerDeelnemers,
  retryNa,
  veiligeGraphUrl,
  veiligeTeamsLink,
} from "../../core/lib/microsoft-outlook-graph-core";

test("Graph-client accepteert uitsluitend Microsoft Graph v1.0 en gebruikt immutable ID", async () => {
  assert.equal(veiligeGraphUrl("https://graph.microsoft.com/v1.0/me/calendars").hostname, "graph.microsoft.com");
  for (const url of [
    "http://graph.microsoft.com/v1.0/me/calendars",
    "https://graph.microsoft.com.evil.test/v1.0/me/calendars",
    "https://graph.microsoft.com/beta/me/calendars",
  ]) assert.throws(() => veiligeGraphUrl(url), OutlookGraphError);

  let headers: HeadersInit | undefined;
  await graphGet("test-token", "https://graph.microsoft.com/v1.0/me/calendars", {
    fetchImpl: async (_input, init) => {
      headers = init.headers;
      return new Response("{}", { status: 200 });
    },
    maxRetries: 0,
  });
  const prefer = new Headers(headers).get("Prefer") ?? "";
  assert.match(prefer, /IdType="ImmutableId"/);
  assert.match(prefer, /outlook\.timezone="UTC"/);
});

test("Graph-client respecteert Retry-After en begrenst retries", async () => {
  let calls = 0;
  const wachttijden: number[] = [];
  const response = await graphGet("test-token", "https://graph.microsoft.com/v1.0/me/calendars", {
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? new Response("", { status: 429, headers: { "Retry-After": "2" } })
        : new Response("{}", { status: 200 });
    },
    wacht: async (ms) => { wachttijden.push(ms); },
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(wachttijden, [2_000]);
  assert.equal(retryNa(new Response("", { headers: { "Retry-After": "999" } })), 30_000);
});

test("UTC-normalisatie behoudt instanten over de Amsterdamse zomertijdovergang", () => {
  const voor = normaliseerGraphUtc({ dateTime: "2026-03-29T00:30:00.0000000", timeZone: "UTC" });
  const na = normaliseerGraphUtc({ dateTime: "2026-03-29T01:30:00.0000000", timeZone: "UTC" });
  assert.equal(voor?.iso, "2026-03-29T00:30:00.000Z");
  assert.equal(na?.iso, "2026-03-29T01:30:00.000Z");
  assert.equal(new Date(na!.iso).getTime() - new Date(voor!.iso).getTime(), 3_600_000);
  assert.equal(normaliseerGraphUtc({ dateTime: "2026-03-29T02:30:00", timeZone: "W. Europe Standard Time" }), undefined);
});

test("privacyprojectie bewaart alleen de huidige fondsgebruiker en een telling", () => {
  const projectie = projecteerDeelnemers([
    { emailAddress: { address: "BEHEERDER@EXAMPLE.TEST" } },
    { emailAddress: { address: "extern@example.test" } },
  ], "beheerder@example.test");
  assert.deepEqual(projectie, { huidigeGebruikerIsDeelnemer: true, onbekend: 1 });
  assert.equal(normaliseerSensitivity("private"), "private");
  assert.equal(normaliseerSensitivity("onbekend"), "normal");
});

test("alleen standaard Microsoft Teams-joinlinks worden bewaard", () => {
  assert.match(veiligeTeamsLink("https://teams.microsoft.com/l/meetup-join/abc"), /^https:\/\/teams\.microsoft\.com\//);
  assert.equal(veiligeTeamsLink("javascript:alert(1)"), "");
  assert.equal(veiligeTeamsLink("https://teams.microsoft.com.evil.test/l/abc"), "");
});
