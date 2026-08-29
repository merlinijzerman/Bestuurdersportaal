import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { authStateBestand } from "../fixtures/config.mjs";
import { bevestigVeiligeE2eDoelomgeving } from "../fixtures/omgeving.mjs";

const FONDS_A = process.env.E2E_FONDS_A_ORIGIN ?? "http://fonds-a.localhost:3000";
const FONDS_B = process.env.E2E_FONDS_B_ORIGIN ?? "http://fonds-b.localhost:3000";
const PLATFORM = process.env.E2E_PLATFORM_ORIGIN ?? "http://beheer.localhost:3000";
const INFECTED_MARKER = "WP3-E2E-INFECTED-MARKER";

function synthetischePdf(marker: string) {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n` +
      `2 0 obj\n<< /Length ${marker.length} >>\nstream\n${marker}\nendstream\nendobj\n%%EOF\n`,
    "utf8",
  );
}

async function openUpload(
  page: Page,
  titel: string,
  bestand: { name: string; mimeType: string; buffer: Buffer },
) {
  await page.goto(`${FONDS_A}/bibliotheek`);
  await page.getByRole("button", { name: "+ Document uploaden" }).click();
  const dialoog = page.getByRole("dialog", { name: "Document uploaden" });
  await dialoog.getByLabel("Bestand").setInputFiles(bestand);
  await dialoog.getByLabel("Titel").fill(titel);
  await dialoog.getByLabel(/Documenttype/).selectOption("bijlage");
  return dialoog;
}

async function uploadPdf(page: Page, titel: string, buffer: Buffer) {
  const dialoog = await openUpload(page, titel, {
    name: `${titel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`,
    mimeType: "application/pdf",
    buffer,
  });
  await dialoog.getByRole("button", { name: "Uploaden & indexeren" }).click();
  // De modal sluit uitsluitend nadat init, Storage-upload én complete geslaagd
  // zijn. Lees de unieke synthetische titel daarna server-side terug; dit bindt
  // de test aan de duurzame eindtoestand en niet aan een vluchtig response-event.
  await expect(dialoog).toHaveCount(0);
  const { data, error } = await adminClient()
    .from("documenten")
    .select("id")
    .eq("titel", titel)
    .single();
  expect(error).toBeNull();
  expect(data?.id).toBeTruthy();
  return data!.id;
}

async function draaiScannerWorker() {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) throw new Error("CRON_SECRET ontbreekt voor E2E-worker.");
  const response = await fetch(`${PLATFORM}/api/internal/ingest-worker`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cronSecret}`,
      "x-vercel-oidc-token": "wp3-e2e-local-oidc",
    },
  });
  if (!response.ok) throw new Error(`E2E-worker faalde met HTTP ${response.status}.`);
  return response.json() as Promise<{ afgerond: number; mislukt: number }>;
}

function adminClient() {
  const omgeving = bevestigVeiligeE2eDoelomgeving(process.env);
  return createClient(omgeving.supabaseUrl!, omgeving.serviceKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.describe("E2E-03 — documentvalidatie", () => {
  test.use({ storageState: authStateBestand("a", "beheerder") });

  test("ongeldige extensie wordt begrijpelijk vóór een uploadrequest geweigerd", async ({ page }) => {
    let uploadRequests = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/documents/upload") && request.method() === "POST") {
        uploadRequests += 1;
      }
    });
    const dialoog = await openUpload(page, `WP3 E2E ongeldig ${randomUUID()}`, {
      name: "synthetisch.exe",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("synthetisch"),
    });
    await dialoog.getByRole("button", { name: "Uploaden & indexeren" }).click();
    await expect(dialoog.getByRole("alert")).toContainText("Bestandstype niet ondersteund");
    expect(uploadRequests).toBe(0);
  });

  test("bestand boven 25 MB wordt vóór opslag begrijpelijk geweigerd", async ({ page }) => {
    let uploadRequests = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/documents/upload") && request.method() === "POST") {
        uploadRequests += 1;
      }
    });
    const dialoog = await openUpload(page, `WP3 E2E te groot ${randomUUID()}`, {
      name: "synthetisch-groot.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(25 * 1024 * 1024 + 1, 0x41),
    });
    await dialoog.getByRole("button", { name: "Uploaden & indexeren" }).click();
    await expect(dialoog.getByRole("alert")).toContainText(
      "De maximale bestandsgrootte is 25,0 MB",
    );
    expect(uploadRequests).toBe(0);
  });
});

test.describe("E2E-03 — quarantaine, scan en tenantisolatie", () => {
  test.use({ storageState: authStateBestand("a", "beheerder") });

  test("schoon document wordt hashgebonden gepromoveerd, veilig gedownload en voor fonds B verborgen", async ({ page, browser }) => {
    const marker = `SCHOON-${randomUUID()}`;
    const titel = `WP3 E2E schoon ${randomUUID()}`;
    const pdf = synthetischePdf(marker);
    const documentId = await uploadPdf(page, titel, pdf);
    const worker = await draaiScannerWorker();
    expect(worker.afgerond).toBeGreaterThanOrEqual(1);

    const admin = adminClient();
    const { data: document, error } = await admin
      .from("documenten")
      .select("opslag_pad, quarantaine_pad, bestand_hash, scan_resultaat, verwerkingsstatus")
      .eq("id", documentId)
      .single();
    expect(error).toBeNull();
    expect(document?.opslag_pad).toBeTruthy();
    expect(document?.quarantaine_pad).toBeNull();
    expect(document?.verwerkingsstatus).toBe("beschikbaar");
    expect(document?.scan_resultaat?.verdict).toBe("clean");
    expect(document?.scan_resultaat?.sha256).toBe(document?.bestand_hash);

    await page.reload();
    await expect(page.getByText(titel, { exact: true })).toBeVisible();
    const download = await page.request.get(`${FONDS_A}/api/documents/${documentId}/bestand`);
    expect(download.status()).toBe(200);
    expect(download.headers()["content-disposition"]).toContain("attachment");
    expect(download.headers()["x-content-type-options"]).toBe("nosniff");
    expect(download.headers()["cache-control"]).toContain("no-store");
    expect(Buffer.compare(await download.body(), pdf)).toBe(0);

    const fondsB = await browser.newContext({ storageState: authStateBestand("b", "bestuurder") });
    try {
      const bPage = await fondsB.newPage();
      await bPage.goto(`${FONDS_B}/bibliotheek`);
      await expect(bPage.getByText(titel, { exact: true })).toHaveCount(0);
      const vreemdDownload = await fondsB.request.get(
        `${FONDS_B}/api/documents/${documentId}/bestand`,
      );
      expect(vreemdDownload.status()).toBe(404);
    } finally {
      await fondsB.close();
    }
  });

  test("besmet testverdict blijft in quarantaine en wordt nooit downloadbaar", async ({ page }) => {
    const titel = `WP3 E2E besmet ${randomUUID()}`;
    const documentId = await uploadPdf(
      page,
      titel,
      synthetischePdf(`${INFECTED_MARKER}-${randomUUID()}`),
    );
    const worker = await draaiScannerWorker();
    expect(worker.mislukt).toBeGreaterThanOrEqual(1);

    const admin = adminClient();
    const { data: document, error } = await admin
      .from("documenten")
      .select("opslag_pad, quarantaine_pad, scan_resultaat, verwerkingsstatus")
      .eq("id", documentId)
      .single();
    expect(error).toBeNull();
    expect(document?.opslag_pad).toBeNull();
    expect(document?.quarantaine_pad).toBeTruthy();
    expect(document?.verwerkingsstatus).toBe("gequarantineerd");
    expect(document?.scan_resultaat?.verdict).toBe("infected");

    const download = await page.request.get(`${FONDS_A}/api/documents/${documentId}/bestand`);
    expect(download.status()).toBe(403);
  });
});
