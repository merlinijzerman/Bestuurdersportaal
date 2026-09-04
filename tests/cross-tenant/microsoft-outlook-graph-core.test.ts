import assert from "node:assert/strict";
import test from "node:test";
import {
  bouwStandaardAgendaDeltaUrl,
  OutlookGraphError,
  graphGet,
  normaliseerGraphUtc,
  normaliseerSensitivity,
  projecteerDeelnemers,
  retryNa,
  veiligeGraphUrl,
  veiligeTeamsLink,
} from "../../core/lib/microsoft-outlook-graph-core";

test("delta-start gebruikt het gedocumenteerde v1.0-pad van de standaardagenda", () => {
  const url = bouwStandaardAgendaDeltaUrl("2026-06-01", "2027-06-01");
  assert.equal(url.origin, "https://graph.microsoft.com");
  assert.equal(url.pathname, "/v1.0/me/calendarView/delta");
  assert.equal(url.searchParams.get("startDateTime"), "2026-06-01T00:00:00Z");
  assert.equal(url.searchParams.get("endDateTime"), "2027-06-01T00:00:00Z");
  assert.doesNotMatch(url.pathname, /\/calendars\//);
});

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
  assert.equal(new Headers(headers).get("Content-Type"), "application/json");
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

test("Graph-client classificeert HTTP-fouten zonder response-inhoud te lekken", async () => {
  const gevallen = [
    [400, "graph_verzoek_ongeldig"],
    [404, "graph_bron_niet_gevonden"],
    [405, "graph_methode_niet_toegestaan"],
    [500, "graph_serverfout"],
    [418, "graph_response"],
  ] as const;
  for (const [status, categorie] of gevallen) {
    await assert.rejects(
      graphGet("test-token", "https://graph.microsoft.com/v1.0/me/calendarView/delta", {
        fetchImpl: async () => new Response("gevoelige Graph-response", { status }),
        maxRetries: 0,
      }),
      (fout: unknown) => fout instanceof OutlookGraphError
        && fout.categorie === categorie
        && !fout.message.includes("gevoelige"),
    );
  }
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
