import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  authStateBestand,
  E2E_AI_BRONNEN,
  E2E_AI_PROVIDER_FOUT_MARKER,
} from "../fixtures/config.mjs";
import { bevestigVeiligeE2eDoelomgeving } from "../fixtures/omgeving.mjs";

const FONDS_A = process.env.E2E_FONDS_A_ORIGIN ?? "http://fonds-a.localhost:3000";
const FONDS_B = process.env.E2E_FONDS_B_ORIGIN ?? "http://fonds-b.localhost:3000";
const PLATFORM = process.env.E2E_PLATFORM_ORIGIN ?? "http://beheer.localhost:3000";
const AI_PROVIDER = process.env.WP4_E2E_AI_PROVIDER_URL ?? "http://127.0.0.1:8790";

function adminClient() {
  const omgeving = bevestigVeiligeE2eDoelomgeving(process.env);
  return createClient(omgeving.supabaseUrl!, omgeving.serviceKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function verwachtJson<T>(response: Awaited<ReturnType<APIRequestContext["post"]>>, label: string) {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  expect(response.ok(), `${label}: HTTP ${response.status()} ${body.error ?? ""}`).toBe(true);
  return body;
}

async function maakProcedure(page: Page, prefix: string) {
  const titel = `${prefix} ${randomUUID()}`;
  const response = await page.request.post(`${FONDS_A}/api/procedures`, {
    data: { template_code: "incident_dnb", titel, beschrijving: "Uitsluitend synthetische WP4-testdata." },
  });
  const body = await verwachtJson<{ procedure: { id: string } }>(response, "procedure aanmaken");
  return { id: body.procedure.id, titel };
}

async function besluitmomentStap(procedureId: string) {
  const { data, error } = await adminClient()
    .from("procedure_stappen")
    .select("id, volgorde, naam")
    .eq("procedure_id", procedureId)
    .eq("vereist_besluit", true)
    .single();
  expect(error).toBeNull();
  expect(data).toBeTruthy();
  return data!;
}

async function wijzigStatus(page: Page, decisionId: string, status: string, extra = {}) {
  const response = await page.request.post(`${FONDS_A}/api/decisions/${decisionId}/status`, {
    data: { status, ...extra },
  });
  await verwachtJson(response, `status ${status}`);
}

async function startAfschriftWorker() {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET ontbreekt voor E2E-afschriftworker.");
  const response = await fetch(`${PLATFORM}/api/internal/afschrift-worker`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "x-vercel-oidc-token": "wp4-e2e-local-oidc",
    },
  });
  if (!response.ok) throw new Error(`Afschriftworker faalde met HTTP ${response.status}.`);
  return response.json() as Promise<{ geclaimd: number; gereed: number; mislukt: number }>;
}

async function stelVraag(page: Page, vraag: string) {
  const invoer = page.getByPlaceholder("Stel een vraag... (@ om een specifiek document te kiezen)");
  await invoer.fill(vraag);
  await invoer.press("Enter");
}

async function openDossier(page: Page) {
  const dossier = page.getByRole("button", { name: /^Dossier/ });
  if ((await dossier.getAttribute("aria-expanded")) !== "true") await dossier.click();
}

test.describe("WP4 — bestuurlijke productjourneys", () => {
  test.use({ storageState: authStateBestand("a", "beheerder") });

  test("E2E-02 vergadering → besluit: statusinvariant, motivering, persistence en audit", async ({ page }) => {
    const procedure = await maakProcedure(page, "WP4 vergadering naar besluit");
    const stap = await besluitmomentStap(procedure.id);

    const requirementResponse = await page.request.post(
      `${FONDS_A}/api/procedures/${procedure.id}/requirements`,
      {
        data: {
          stap_volgorde: stap.volgorde,
          requirement_type: "document",
          documenttype: "analyse",
          label: `WP4 open vereiste ${randomUUID()}`,
          verplicht: true,
          blokkerend: false,
          min_aantal: 1,
        },
      },
    );
    await verwachtJson(requirementResponse, "open vereiste toevoegen");

    const approvalResponse = await page.request.post(
      `${FONDS_A}/api/procedures/${procedure.id}/requirements`,
      {
        data: {
          stap_volgorde: stap.volgorde,
          requirement_type: "approval",
          label: `WP4 besluitgoedkeuring ${randomUUID()}`,
          verplicht: false,
          blokkerend: false,
          min_aantal: 1,
        },
      },
    );
    await verwachtJson(approvalResponse, "approval-vereiste toevoegen");

    const admin = adminClient();
    const { data: decision, error: decisionFout } = await admin
      .from("decision_objects")
      .select("id, status")
      .eq("procedure_id", procedure.id)
      .eq("is_primary_decision", true)
      .single();
    expect(decisionFout).toBeNull();
    expect(decision?.status).toBe("in_onderbouwing");

    const ongeldigeOvergang = await page.request.post(
      `${FONDS_A}/api/decisions/${decision!.id}/status`,
      { data: { status: "besloten", motivering: "Ruim voldoende testmotivering." } },
    );
    expect(ongeldigeOvergang.status()).toBe(400);
    await expect(ongeldigeOvergang.json()).resolves.toMatchObject({
      error: expect.stringContaining("niet toegestaan"),
    });

    const vergaderingTitel = `WP4 besluitvergadering ${randomUUID()}`;
    const vergaderingResponse = await page.request.post(`${FONDS_A}/api/vergaderingen`, {
      data: {
        titel: vergaderingTitel,
        datum: "2026-09-01T09:30:00.000Z",
        locatie: "Synthetische bestuurskamer",
        status: "gepland",
      },
    });
    const vergaderingBody = await verwachtJson<{ vergadering: { id: string } }>(
      vergaderingResponse,
      "vergadering aanmaken",
    );
    const agendapuntTitel = `WP4 besluitpunt ${randomUUID()}`;
    const koppelResponse = await page.request.post(
      `${FONDS_A}/api/procedures/${procedure.id}/stappen/${stap.id}/agendapunt`,
      { data: { vergadering_id: vergaderingBody.vergadering.id, titel: agendapuntTitel } },
    );
    await verwachtJson(koppelResponse, "agendapunt koppelen");

    await page.goto(`${FONDS_A}/vergaderingen/${vergaderingBody.vergadering.id}`);
    await expect(page.getByRole("heading", { name: vergaderingTitel })).toBeVisible();
    await expect(page.getByText(agendapuntTitel, { exact: true })).toBeVisible();
    await expect(page.getByText("Besluitvorming", { exact: true })).toBeVisible();

    for (const status of [
      "in_validatie",
      "in_review",
      "geagendeerd",
      "in_bespreking",
    ]) {
      await wijzigStatus(page, decision!.id, status);
    }

    const besluitResponse = await page.request.post(
      `${FONDS_A}/api/procedures/${procedure.id}/besluiten`,
      {
        data: {
          stap_id: stap.id,
          vergadering_id: vergaderingBody.vergadering.id,
          formulering: "Het bestuur stelt de synthetische WP4-beslissing vast.",
          motivering: "De test legt een echt, aan de approval-vereiste gebonden besluitfeit vast.",
          datum: "2026-09-01",
          uitkomst: "instemmend",
          verworpen_alternatieven: ["Geen besluit vastleggen"],
        },
      },
    );
    await verwachtJson(besluitResponse, "gebonden besluit vastleggen");

    await page.goto(`${FONDS_A}/procedures/${procedure.id}`);
    await openDossier(page);
    await page.getByRole("button", { name: /Statusovergang/ }).click();
    await page.getByLabel("Volgende status").selectOption("besloten");
    await expect(page.getByText("Openstaande vereisten voor dit besluitmoment")).toBeVisible();
    const doorvoeren = page.getByRole("button", { name: "Overgang doorvoeren" });
    await expect(doorvoeren).toBeDisabled();
    await page
      .getByLabel("Motivering (verplicht — besluit met openstaande vereisten)")
      .fill("Het bestuur besluit nu; de open analyse wordt aantoonbaar nageleverd.");
    await expect(doorvoeren).toBeEnabled();
    await doorvoeren.click();

    await expect(page.getByText("Besloten", { exact: true }).first()).toBeVisible();
    await page.reload();
    await openDossier(page);
    await page.getByRole("button", { name: /Statusovergang/ }).click();
    await expect(page.getByText("Besloten", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: /Audit-trail/ }).click();
    await expect(page.getByText("Besluit genomen met openstaande vereisten", { exact: true })).toBeVisible();

    const { data: audit } = await admin
      .from("governance_events")
      .select("event_type, reden")
      .eq("decision_id", decision!.id)
      .eq("event_type", "besluit_genomen_met_openstaande_vereisten")
      .single();
    expect(audit?.reden).toContain("open analyse");
  });

  test("E2E-04 procedure → afschrift: menselijke vaststelling, worker, download en tenantisolatie", async ({ page, browser }) => {
    test.setTimeout(60_000);
    const procedure = await maakProcedure(page, "WP4 procedure naar afschrift");
    const aanleiding = `WP4 controle ${randomUUID()}`;

    await page.goto(`${FONDS_A}/procedures/${procedure.id}`);
    await openDossier(page);
    await page.getByRole("button", { name: /Afschriften/ }).click();
    await page.getByPlaceholder(/Aanleiding/).fill(aanleiding);
    await page.getByRole("button", { name: "Concept leeswijzer opstellen →" }).click();
    await expect(page.getByText("Conceptleeswijzer — bekijk en redigeer")).toBeVisible();
    await expect(page.getByText("Deterministisch sjabloon", { exact: true })).toBeVisible();
    await expect(
      page
        .getByText("2. Hoe het proces is verlopen", { exact: true })
        .locator("..")
        .getByRole("textbox"),
    ).not.toHaveValue("");

    const enqueue = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url() === `${FONDS_A}/api/procedures/${procedure.id}/afschrift`,
    );
    await page.getByRole("button", { name: "Vaststellen en afschrift aanmaken" }).click();
    const enqueueResponse = await enqueue;
    expect(enqueueResponse.status()).toBe(202);
    const { id: afschriftId } = (await enqueueResponse.json()) as { id: string };

    const worker = await startAfschriftWorker();
    expect(worker.geclaimd).toBeGreaterThanOrEqual(1);
    expect(worker.gereed).toBeGreaterThanOrEqual(1);
    expect(worker.mislukt).toBe(0);

    await page.reload();
    await openDossier(page);
    await page.getByRole("button", { name: /Afschriften/ }).click();
    await expect(page.getByText(`“${aanleiding}”`, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Downloaden" })).toBeVisible();

    const download = await page.request.get(
      `${FONDS_A}/api/procedures/${procedure.id}/afschriften/${afschriftId}/download`,
    );
    expect(download.status()).toBe(200);
    expect(download.headers()["content-type"]).toContain("application/zip");
    expect(download.headers()["content-disposition"]).toMatch(/attachment;.*filename=.*\.zip/i);
    expect((await download.body()).byteLength).toBeGreaterThan(100);

    const fondsB = await browser.newContext({ storageState: authStateBestand("b", "bestuurder") });
    try {
      const vreemd = await fondsB.request.get(
        `${FONDS_B}/api/procedures/${procedure.id}/afschriften/${afschriftId}/download`,
      );
      expect(vreemd.status()).toBe(404);
    } finally {
      await fondsB.close();
    }

    const { data: afschrift } = await adminClient()
      .from("procedure_afschriften")
      .select("procedure_id, status, ai_vastgesteld_door, bytes, sha256")
      .eq("id", afschriftId)
      .single();
    expect(afschrift).toMatchObject({ procedure_id: procedure.id, status: "gereed" });
    expect(afschrift?.ai_vastgesteld_door).toBeTruthy();
    expect(afschrift?.bytes).toBeGreaterThan(100);
    expect(afschrift?.sha256).toMatch(/^[a-f0-9]{64}$/);

    const { data: audit } = await adminClient()
      .from("procedure_log")
      .select("event_type")
      .eq("procedure_id", procedure.id)
      .in("event_type", ["afschrift_aangemaakt", "afschrift_gereed", "afschrift_gedownload"]);
    expect(new Set((audit ?? []).map((r) => r.event_type))).toEqual(
      new Set(["afschrift_aangemaakt", "afschrift_gereed", "afschrift_gedownload"]),
    );
  });

  test("E2E-05 AI: verduidelijking, voortgang, twee streamingdelta's, bronnen en tenantisolatie", async ({ page, browser }) => {
    test.setTimeout(60_000);
    const statsVoor = (await (await fetch(`${AI_PROVIDER}/stats`)).json()) as { requests: number; streams: number };

    await page.goto(`${FONDS_A}/ai`);
    await stelVraag(page, "Wat is de synthetische uitvoeringsafspraak en controlewaarde?");
    await expect(page.getByText("Wilt u dit weten voor uw fonds specifiek, of in algemene zin?")).toBeVisible();
    await page.getByRole("button", { name: "Voor mijn fonds" }).click();

    await expect(page.getByRole("status").getByText(/Fondsdocumenten worden doorzocht/)).toBeVisible();
    await expect(page.getByText("Eerste gestreamde deel", { exact: false })).toBeVisible();
    const tweedeDelta = page.getByText("De tweede controlewaarde staat in", { exact: false });
    await expect(tweedeDelta).toHaveCount(0);
    await expect(tweedeDelta).toBeVisible();

    const bronPaneel = page.getByRole("button", { name: /Onderbouwing en bronnen/ }).last();
    await bronPaneel.click();
    await expect(page.getByText(E2E_AI_BRONNEN.fondsAUitvoering.titel, { exact: true })).toBeVisible();
    await expect(page.getByText(E2E_AI_BRONNEN.fondsAControle.titel, { exact: true })).toBeVisible();
    await expect(page.getByText(E2E_AI_BRONNEN.fondsBIsolatie.titel, { exact: true })).toHaveCount(0);
    await expect(
      page.locator(`a[href^="/api/documents/${E2E_AI_BRONNEN.fondsAUitvoering.id}/bestand"]`),
    ).toBeVisible();

    const fondsB = await browser.newContext({ storageState: authStateBestand("b", "bestuurder") });
    try {
      const bPage = await fondsB.newPage();
      await bPage.goto(`${FONDS_B}/ai`);
      await stelVraag(bPage, "Welke synthetische uitvoeringsafspraak en controlewaarde gelden voor ons fonds?");
      await expect(bPage.getByText("Eerste gestreamde deel", { exact: false })).toBeVisible();
      await expect(bPage.getByText(E2E_AI_BRONNEN.fondsBIsolatie.titel, { exact: true })).toBeVisible();
      await expect(bPage.getByText(E2E_AI_BRONNEN.fondsAUitvoering.titel, { exact: true })).toHaveCount(0);
      await expect(bPage.getByText(E2E_AI_BRONNEN.fondsAControle.titel, { exact: true })).toHaveCount(0);
    } finally {
      await fondsB.close();
    }

    const statsNa = (await (await fetch(`${AI_PROVIDER}/stats`)).json()) as { requests: number; streams: number };
    expect(statsNa.requests).toBeGreaterThan(statsVoor.requests);
    expect(statsNa.streams).toBeGreaterThan(statsVoor.streams);
  });

  test("E2E-05 AI-providerfout wordt zonder providerdetail begrijpelijk getoond", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(`${FONDS_A}/ai`);
    await stelVraag(page, `Simuleer ${E2E_AI_PROVIDER_FOUT_MARKER} voor ons fonds.`);
    await expect(page.getByText("Er is een fout opgetreden bij het verwerken van uw vraag.")).toBeVisible();
    await expect(page.getByText("Synthetische providerfout", { exact: false })).toHaveCount(0);
  });
});
