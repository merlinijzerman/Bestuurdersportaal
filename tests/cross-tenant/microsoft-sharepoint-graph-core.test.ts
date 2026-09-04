import assert from "node:assert/strict";
import test from "node:test";
import {
  SharePointGraphError,
  graphCollectie,
  graphJson,
  kandidaatGeldig,
  normaliseerDrives,
  normaliseerMappen,
  normaliseerSite,
  siteUrlVoorKandidaat,
  veiligeSharePointGraphUrl,
  veiligeVervolgLink,
} from "../../core/lib/microsoft-sharepoint-graph-core";

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });

test("SharePoint-adapter accepteert uitsluitend Microsoft Graph v1.0 over https", () => {
  assert.equal(veiligeSharePointGraphUrl("https://graph.microsoft.com/v1.0/sites/root").hostname, "graph.microsoft.com");
  for (const url of [
    "http://graph.microsoft.com/v1.0/sites/root",
    "https://graph.microsoft.com.evil.test/v1.0/sites/root",
    "https://graph.microsoft.com/beta/sites/root",
    "https://evil.test/v1.0/sites/root",
    "niet-een-url",
  ]) assert.throws(() => veiligeSharePointGraphUrl(url), (fout: unknown) => fout instanceof SharePointGraphError && fout.categorie === "graph_url");
});

test("vervolglink mag alleen hetzelfde pad vervolgen — geen andere drive, site of tenant", () => {
  const basis = "https://graph.microsoft.com/v1.0/drives/b!drive-a/root/children?$top=200";
  assert.equal(veiligeVervolgLink("https://graph.microsoft.com/v1.0/drives/b!drive-a/root/children?$skiptoken=xyz", basis), "https://graph.microsoft.com/v1.0/drives/b!drive-a/root/children?$skiptoken=xyz");
  for (const link of [
    "https://graph.microsoft.com/v1.0/drives/b!drive-b/root/children?$skiptoken=xyz",
    "https://graph.microsoft.com/v1.0/sites/other.sharepoint.com,1,2/drives",
    "https://graph.microsoft.com/beta/drives/b!drive-a/root/children",
    "https://evil.test/v1.0/drives/b!drive-a/root/children",
  ]) assert.throws(() => veiligeVervolgLink(link, basis), SharePointGraphError);
});

test("graphJson normaliseert 401/403, 404 en 429 en volgt Retry-After begrensd", async () => {
  const categorie = async (status: number, maxRetries = 0) => {
    try {
      await graphJson("t", "https://graph.microsoft.com/v1.0/sites/root", { fetchImpl: async () => new Response("{}", { status }), maxRetries, wacht: async () => undefined });
      return "geen";
    } catch (fout) { return fout instanceof SharePointGraphError ? fout.categorie : "anders"; }
  };
  assert.equal(await categorie(401), "toestemming_of_token");
  assert.equal(await categorie(403), "toestemming_of_token");
  assert.equal(await categorie(404), "niet_gevonden");
  assert.equal(await categorie(429), "graph_ratelimit");
  assert.equal(await categorie(500), "graph_response");

  let pogingen = 0; const wachttijden: number[] = [];
  const body = await graphJson<{ ok: boolean }>("t", "https://graph.microsoft.com/v1.0/sites/root", {
    fetchImpl: async () => { pogingen += 1; return pogingen < 3 ? new Response("", { status: 429, headers: { "Retry-After": "2" } }) : json({ ok: true }); },
    wacht: async (ms) => { wachttijden.push(ms); },
    maxRetries: 2,
  });
  assert.deepEqual(body, { ok: true });
  assert.deepEqual(wachttijden, [2000, 2000]);
});

test("graphJson stuurt het token alleen als Bearer-header, volgt geen redirects en respecteert een timeout", async () => {
  let init: RequestInit | undefined;
  await graphJson("geheim-token", "https://graph.microsoft.com/v1.0/sites/root", { fetchImpl: async (_url, i) => { init = i; return json({}); } });
  assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer geheim-token");
  assert.equal(init?.redirect, "error");
  assert.equal(init?.cache, "no-store");
  await assert.rejects(
    graphJson("t", "https://graph.microsoft.com/v1.0/sites/root", {
      timeoutMs: 5,
      fetchImpl: (_url, i) => new Promise((_resolve, reject) => { i.signal?.addEventListener("abort", () => reject(Object.assign(new Error("abort"), { name: "AbortError" }))); }),
    }),
    (fout: unknown) => fout instanceof SharePointGraphError && fout.categorie === "graph_timeout",
  );
});

test("graphCollectie pagineert binnen het pad, kapt af op plafond en weigert lussen", async () => {
  const basis = "https://graph.microsoft.com/v1.0/drives/b!d/root/children?$top=200";
  const pagina2 = "https://graph.microsoft.com/v1.0/drives/b!d/root/children?$skiptoken=2";
  const fetchImpl = async (url: string) => url === basis
    ? json({ value: [{ id: "1" }, { id: "2" }], "@odata.nextLink": pagina2 })
    : json({ value: [{ id: "3" }] });
  const volledig = await graphCollectie<{ id: string }>("t", basis, { fetchImpl });
  assert.deepEqual(volledig, { items: [{ id: "1" }, { id: "2" }, { id: "3" }], afgekapt: false });
  const afgekapt = await graphCollectie<{ id: string }>("t", basis, { fetchImpl, maxItems: 2 });
  assert.deepEqual(afgekapt, { items: [{ id: "1" }, { id: "2" }], afgekapt: true });
  const paginaPlafond = await graphCollectie<{ id: string }>("t", basis, { fetchImpl, maxPaginas: 1 });
  assert.equal(paginaPlafond.afgekapt, true);
  await assert.rejects(
    graphCollectie("t", basis, { fetchImpl: async () => json({ value: [], "@odata.nextLink": basis }) }),
    (fout: unknown) => fout instanceof SharePointGraphError && fout.categorie === "graph_paginering",
  );
  await assert.rejects(
    graphCollectie("t", basis, { fetchImpl: async () => json({ value: [], "@odata.nextLink": "https://graph.microsoft.com/v1.0/drives/b!ander/root/children" }) }),
    (fout: unknown) => fout instanceof SharePointGraphError && fout.categorie === "graph_paginering",
  );
});

test("kandidaatsite is alleen bruikbaar met strikte hostnaam en pad; site-respons moet bij de kandidaat horen", () => {
  assert.equal(kandidaatGeldig("pgb.sharepoint.com", "/sites/bestuur"), true);
  for (const [host, pad] of [["evil.test", "/sites/x"], ["pgb.sharepoint.com.evil.test", "/sites/x"], ["pgb.sharepoint.com", "sites/x"], ["pgb.sharepoint.com", "/sites/../x"], ["pgb.sharepoint.com", "/sites//x"], ["pgb.sharepoint.com", "/sites/x?y"]] as const) {
    assert.equal(kandidaatGeldig(host, pad), false, `${host}${pad}`);
  }
  assert.equal(siteUrlVoorKandidaat("pgb.sharepoint.com", "/sites/bestuur/"), "https://graph.microsoft.com/v1.0/sites/pgb.sharepoint.com:/sites/bestuur?$select=id,displayName,name,webUrl");
  const site = normaliseerSite({ id: "pgb.sharepoint.com,11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222", displayName: "Bestuur", webUrl: "https://pgb.sharepoint.com/sites/bestuur" }, "pgb.sharepoint.com");
  assert.equal(site.hostnaam, "pgb.sharepoint.com");
  for (const respons of [
    { id: "ander.sharepoint.com,1,2", displayName: "X", webUrl: "https://ander.sharepoint.com/sites/x" },
    { id: "pgb.sharepoint.com,1,2", displayName: "X", webUrl: "https://ander.sharepoint.com/sites/x" },
    { id: "pgb.sharepoint.com,1", displayName: "X" },
    { displayName: "X" },
  ]) assert.throws(() => normaliseerSite(respons, "pgb.sharepoint.com"), (fout: unknown) => fout instanceof SharePointGraphError && fout.categorie === "site_niet_toegankelijk");
});

test("drives en mappen worden geprojecteerd zonder bestanden, systeemdrives of vreemde parentReference", () => {
  assert.deepEqual(normaliseerDrives([{ id: "a", name: "Documenten", driveType: "documentLibrary" }, { id: "b", name: "Persoonlijk", driveType: "business" }, { id: "a", name: "Dubbel", driveType: "documentLibrary" }]), [{ driveId: "a", weergavenaam: "Dubbel" }]);
  assert.deepEqual(normaliseerMappen([
    { id: "m1", name: "2026", folder: { childCount: 3 }, parentReference: { driveId: "d" } },
    { id: "f1", name: "nota.pdf", file: { mimeType: "application/pdf" }, parentReference: { driveId: "d" } },
    { id: "m2", name: "Vreemd", folder: { childCount: 1 }, parentReference: { driveId: "ander" } },
  ], "d"), [{ itemId: "m1", naam: "2026", aantalKinderen: 3 }]);
});

// ── Deel B: documentenboom en preview ────────────────────────────────────────
import {
  bestandstypeVanNaam,
  bouwDocumentboom,
  deltaUrl,
  itemOnderRoot,
  rootPadVanItem,
  veiligeSharePointUrl,
} from "../../core/lib/microsoft-sharepoint-graph-core";

test("alleen PDF/Word/PowerPoint/Excel krijgen een previewtype; andere typen een veilige null", () => {
  assert.equal(bestandstypeVanNaam("Nota.PDF"), "pdf");
  assert.equal(bestandstypeVanNaam("stuk.docx"), "docx");
  assert.equal(bestandstypeVanNaam("deck.pptx"), "pptx");
  assert.equal(bestandstypeVanNaam("cijfers.xlsx"), "xlsx");
  for (const naam of ["foto.png", "archief.zip", "script.exe", "zonder-extensie", "raar.pdf.exe"]) assert.equal(bestandstypeVanNaam(naam), null, naam);
});

test("preview- en web-URL's worden alleen op https *.sharepoint.com zonder credentials doorgelaten", () => {
  assert.equal(veiligeSharePointUrl("https://pgb.sharepoint.com/sites/x/_layouts/15/embed.aspx?id=1"), "https://pgb.sharepoint.com/sites/x/_layouts/15/embed.aspx?id=1");
  assert.equal(veiligeSharePointUrl("https://pgb-my.sharepoint.com/personal/x/doc.docx"), "https://pgb-my.sharepoint.com/personal/x/doc.docx");
  for (const url of [
    "http://pgb.sharepoint.com/x",
    "https://pgb.sharepoint.com.evil.test/x",
    "https://evil.test/pgb.sharepoint.com",
    "https://user:pw@pgb.sharepoint.com/x",
    "javascript:alert(1)",
    "",
    null,
    undefined,
  ]) assert.equal(veiligeSharePointUrl(url), null, String(url));
});

test("documentenboom herleidt paden tot het rootitem en laat verwijderde, vreemde en onbereikbare items weg", () => {
  const root = "root";
  const items = [
    { id: "root", name: "Vergaderstukken", folder: { childCount: 2 }, parentReference: { driveId: "d", id: "drive-root" } },
    { id: "m2026", name: "2026", folder: { childCount: 1 }, parentReference: { driveId: "d", id: "root" } },
    { id: "m09", name: "09 September", folder: { childCount: 1 }, parentReference: { driveId: "d", id: "m2026" } },
    { id: "f1", name: "Agenda.docx", file: { mimeType: "application/vnd" }, size: 10, eTag: "e1", lastModifiedDateTime: "2026-09-01T10:00:00Z", webUrl: "https://pgb.sharepoint.com/sites/x/Agenda.docx", parentReference: { driveId: "d", id: "m09" } },
    { id: "f2", name: "Nota.pdf", file: {}, size: 20, parentReference: { driveId: "d", id: "root" } },
    { id: "f3", name: "Weg.pdf", file: {}, deleted: { state: "deleted" }, parentReference: { driveId: "d", id: "root" } },
    { id: "f4", name: "Vreemd.pdf", file: {}, parentReference: { driveId: "andere-drive", id: "root" } },
    { id: "f5", name: "Zwevend.pdf", file: {}, parentReference: { driveId: "d", id: "onbekende-map" } },
    { id: "f1", name: "Agenda.docx", file: {}, parentReference: { driveId: "d", id: "m09" } },
    { id: "lus-a", name: "A", folder: {}, parentReference: { driveId: "d", id: "lus-b" } },
    { id: "lus-b", name: "B", folder: {}, parentReference: { driveId: "d", id: "lus-a" } },
    { id: "f6", name: "InLus.pdf", file: {}, parentReference: { driveId: "d", id: "lus-a" } },
  ];
  const boom = bouwDocumentboom(items, "d", root);
  assert.deepEqual(boom.documenten.map((x) => [x.itemId, x.mappad, x.bestandstype]), [["f2", "", "pdf"], ["f1", "2026/09 September", "docx"]]);
  assert.equal(boom.documenten[1].webUrl, "https://pgb.sharepoint.com/sites/x/Agenda.docx");
  assert.equal(boom.documenten[1].gewijzigdOp, "2026-09-01T10:00:00.000Z");
  assert.deepEqual(boom.mappen, ["2026", "2026/09 September"]);
  assert.match(deltaUrl("d", root), /^https:\/\/graph\.microsoft\.com\/v1\.0\/drives\/d\/items\/root\/delta\?/);
  assert.doesNotMatch(deltaUrl("d", root), /content|downloadUrl/);
});

test("preview eist dat het item nog in dezelfde drive én onder het rootitem ligt", () => {
  const rootPad = rootPadVanItem({ id: "root", name: "Vergaderstukken", folder: {}, parentReference: { driveId: "d", id: "x", path: "/drives/d/root:" } }, "d");
  assert.equal(rootPad, "/drives/d/root:/Vergaderstukken");
  assert.equal(rootPadVanItem({ id: "r", name: "root", folder: {} }, "d"), "/drives/d/root:");
  const onder = { id: "f", name: "Nota.pdf", file: {}, parentReference: { driveId: "d", id: "m", path: "/drives/d/root:/Vergaderstukken/2026" } };
  assert.equal(itemOnderRoot(onder, "d", rootPad), true);
  assert.equal(itemOnderRoot({ ...onder, parentReference: { driveId: "d", id: "m", path: "/drives/d/root:/Vergaderstukken" } }, "d", rootPad), true);
  assert.equal(itemOnderRoot({ ...onder, parentReference: { driveId: "d", id: "m", path: "/drives/d/root:/Vergaderstukken%202026" } }, "d", rootPad), false);
  assert.equal(itemOnderRoot({ ...onder, parentReference: { driveId: "d", id: "m", path: "/drives/d/root:/Archief" } }, "d", rootPad), false);
  assert.equal(itemOnderRoot({ ...onder, parentReference: { driveId: "andere", id: "m", path: "/drives/andere/root:/Vergaderstukken" } }, "d", rootPad), false);
  assert.equal(itemOnderRoot({ ...onder, file: undefined, folder: {} }, "d", rootPad), false);
  assert.equal(itemOnderRoot({ ...onder, parentReference: { driveId: "d", id: "m" } }, "d", rootPad), false);
});
