// ============================================================================
//  "Mijn voorbereiding": één knop per toestand, en de sleutel gaat mee.
// ----------------------------------------------------------------------------
//  Deze test begon als regressietest op één header. Sinds c872331 (15-08-2026)
//  eist `/api/agendapunten/[id]/voorbereiding` een `Idempotency-Key` en
//  antwoordt hij zonder die header met 400; de client stuurde hem niet, en het
//  400-antwoord verscheen gewoon als AI-tekst in de kaart. Niemand zag het,
//  omdat er voor dit pad geen enkele test bestond.
//
//  De assertie is met T1 PR 2 MEEVERHUISD naar `VoorbereidingKaart` en niet met
//  `AgendapuntChat` verdampt. Ze pint het VERZOEK, niet het scherm: de header is
//  het contract met de route.
//
//  Daarnaast pint deze test de regel uit besluit 0204: één knop per toestand.
//  Niet voorbereid → alleen "Bereid dit punt voor". Voorbereid → alleen
//  "Doorvragen". Een "opnieuw opstellen" ernaast zou de dubbeling terugbrengen
//  die dit ticket juist opheft.
// ============================================================================

import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VoorbereidingKaart from "@/app/(dashboard)/vergaderingen/_components/VoorbereidingKaart";
import { AssistentHarnas } from "./assistent-harnas";
import { verwachtGeenErnstigeAxeBevindingen } from "./axe";
import { verwachtSseStroomEenmaal } from "./fetch-mock";
import { renderMetProviders } from "./render-met-providers";
import { maakSupabaseStub } from "./supabase-mock";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/core/lib/supabase", () => ({ createClient }));

const AGENDAPUNT_ID = "agendapunt-1";
const VOORBEREIDING_VRAAG = "Stel mijn voorbereiding op voor dit agendapunt.";

const PROFIEL = { fonds_id: "fonds-1", fondsen: { naam: "Pensioenfonds Horizon" } };

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function monteer({ gesprekken = [] as unknown[] } = {}) {
  createClient.mockReturnValue(
    maakSupabaseStub({ tabellen: { profielen: PROFIEL, gesprekken } }),
  );
  return renderMetProviders(
    <AssistentHarnas>
      <VoorbereidingKaart agendapuntId={AGENDAPUNT_ID} titel="Vaststellen jaarverslag" />
    </AssistentHarnas>,
  );
}

describe("Mijn voorbereiding", () => {
  it("stuurt een Idempotency-Key mee en toont daarna de uitkomst", async () => {
    const { user } = monteer();

    const knop = await screen.findByRole("button", { name: /Bereid dit punt voor/ });
    // Nog niet voorbereid: geen tweede knop naast deze.
    expect(screen.queryByRole("link", { name: /Doorvragen/ })).not.toBeInTheDocument();

    const verzoek = verwachtSseStroomEenmaal(
      `/api/agendapunten/${AGENDAPUNT_ID}/voorbereiding`,
      [
        {
          type: "meta",
          bronnen: [{ nummer: 1, titel: "Jaarverslag 2025" }],
          inline_meldingen: [],
        },
        { type: "delta", text: "**Bestuurlijke duiding** — het bestuur wordt gevraagd…" },
        { type: "done" },
      ],
      // Knip de stroom, zodat een event over twee reads valt: precies waar een
      // eigengebouwde bufferlus stukgaat.
      { knip: 3 },
    );

    await user.click(knop);

    await waitFor(() =>
      expect(screen.getByText(/het bestuur wordt gevraagd/)).toBeInTheDocument(),
    );

    const sleutel = verzoek.headers().get("Idempotency-Key");
    expect(sleutel, "de route weigert een verzoek zonder sleutel (400)").toBeTruthy();
    expect(sleutel).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    // Voorbereid: nu precies één knop, en dat is doorvragen in het paneel.
    expect(screen.getByRole("link", { name: /Doorvragen/ })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Bereid dit punt voor/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("1 bron uit de bibliotheek")).toBeVisible();
  });

  it("leest een eerder opgestelde voorbereiding terug uit het bewaarde gesprek", async () => {
    const { container } = monteer({
      gesprekken: [
        {
          id: "gesprek-1",
          berichten: [
            { rol: "gebruiker", tekst: VOORBEREIDING_VRAAG },
            {
              rol: "ai",
              tekst: "**Aandachtspunten** — de dekkingsgraad daalt.",
              onderbouwing: { aantalBronnen: 2 },
              voltooid: true,
            },
          ],
        },
      ],
    });

    expect(await screen.findByText(/de dekkingsgraad daalt/)).toBeVisible();
    expect(screen.getByText("2 bronnen uit de bibliotheek")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Bereid dit punt voor/ }),
    ).not.toBeInTheDocument();
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("toont de knop nog bij een oud gesprek zonder voorbereiding", async () => {
    // Rijen van vóór T1 kunnen een heel chatgesprek dragen. Het laatste
    // AI-bericht daaruit als "Mijn voorbereiding" tonen zou de bestuurder iets
    // anders voorspiegelen dan hij leest.
    monteer({
      gesprekken: [
        {
          id: "gesprek-oud",
          berichten: [
            { rol: "gebruiker", tekst: "Wat betekent dit voorstel voor de deelnemers?" },
            { rol: "ai", tekst: "Een antwoord op een andere vraag.", voltooid: true },
          ],
        },
      ],
    });

    expect(
      await screen.findByRole("button", { name: /Bereid dit punt voor/ }),
    ).toBeVisible();
    expect(screen.queryByText(/Een antwoord op een andere vraag/)).not.toBeInTheDocument();
  });
});
