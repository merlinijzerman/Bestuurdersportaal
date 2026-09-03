import { expect, test } from "@playwright/test";
import {
  authStateBestand,
  E2E_AI_BRONNEN,
  E2E_ASSISTENT_CONTEXT,
} from "../fixtures/config.mjs";
import { bevestigVeiligeE2eDoelomgeving } from "../fixtures/omgeving.mjs";

const FONDS_A = process.env.E2E_FONDS_A_ORIGIN ?? "http://fonds-a.localhost:3000";

test.describe("Assistent — client-side context-deeplinks", () => {
  test.use({ storageState: authStateBestand("a", "bestuurder") });

  test.beforeAll(() => {
    // De browserflow is muterend via globalSetup en mag nooit per ongeluk tegen
    // Preview of Production draaien. Houd de grendel ook zichtbaar bij deze spec.
    bevestigVeiligeE2eDoelomgeving(process.env);
  });

  test("alle URL-ingangen tonen de opgeloste context en behouden de originele samenvoegvolgorde", async ({
    page,
  }) => {
    const context = E2E_ASSISTENT_CONTEXT;
    const document = E2E_AI_BRONNEN.fondsAUitvoering;

    await page.goto(`${FONDS_A}/ai?doc=${document.id}`);
    await expect(page.getByText(`Onderwerp: «${document.titel}»`, { exact: true })).toBeVisible();

    await page.goto(`${FONDS_A}/ai?agendapunt=${context.agendapunt.id}`);
    await expect(
      page.getByText(`Agendapunt: «${context.agendapunt.titel}» · geen stukken`, {
        exact: true,
      }),
    ).toBeVisible();

    await page.goto(`${FONDS_A}/ai?proces=${context.procedure.id}`);
    await expect(
      page.getByText(`Proces: «${context.procedure.titel}»`, { exact: true }),
    ).toBeVisible();

    await page.goto(`${FONDS_A}/ai?risicomatrix=1`);
    await expect(page.getByText("Risicomatrix", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: context.risico.titel })).toBeVisible();

    await page.goto(`${FONDS_A}/ai?intent=fonds&herkomst=bibliotheek`);
    const herkomstChip = page
      .getByRole("button", { name: "Herkomst wissen en terug naar automatische bronkeuze" })
      .locator("..");
    await expect(herkomstChip).toContainText("Bibliotheek");
    await expect(herkomstChip).toContainText("uw fonds");

    // Het origineel voerde doc en agendapunt onafhankelijk en in deze volgorde
    // uit. Het agendapunt zonder stukken overschrijft dus de eerdere docscope.
    // Dit is het randgeval dat de eerste P1a-resolver abusievelijk omdraaide.
    await page.goto(
      `${FONDS_A}/ai?doc=${document.id}&agendapunt=${context.agendapunt.id}`,
    );
    await expect(
      page.getByText(`Agendapunt: «${context.agendapunt.titel}» · geen stukken`, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText(`Onderwerp: «${document.titel}»`, { exact: true })).toHaveCount(0);
  });
});
