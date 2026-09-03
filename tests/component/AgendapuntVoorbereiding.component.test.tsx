// ============================================================================
//  "Help mij met de voorbereiding" stuurt zijn idempotentiesleutel mee.
// ----------------------------------------------------------------------------
//  Waarom deze test bestaat: sinds c872331 (15-08-2026, "begrens AI-verbruik in
//  preview") eist `/api/agendapunten/[id]/voorbereiding` een `Idempotency-Key`
//  en antwoordt zonder die header met 400. De client stuurde hem niet, en
//  `withFondsRoute` injecteert hem niet. Het gevolg was zichtbaar noch luid: de
//  chip rendert het 400-antwoord gewoon als AI-bericht in de kaart.
//
//  Geen enkele test zag dat, omdat er voor dit pad geen test bestond. Deze test
//  pint daarom niet het gelukkige scherm maar het VERZOEK — de header is het
//  contract met de route. Verdwijnt hij nog eens, dan wordt dit rood.
//
//  De test overleeft T1: verhuist deze knop naar `VoorbereidingKaart`, dan
//  verhuist de assertie mee. Wat niet mag, is dat hij met het oude bestand
//  verdampt.
// ============================================================================

import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgendapuntChat from "@/app/(dashboard)/vergaderingen/_components/AgendapuntChat";
import { verwachtSseStroomEenmaal } from "./fetch-mock";
import { renderMetProviders } from "./render-met-providers";
import { maakSupabaseStub } from "./supabase-mock";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/core/lib/supabase", () => ({ createClient }));

const AGENDAPUNT_ID = "agendapunt-1";

// jsdom kent `scrollIntoView` niet; de kaart scrolt na een beurt naar beneden.
// Omgevingsgat, geen gedrag dat deze test toetst.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function monteer() {
  createClient.mockReturnValue(
    maakSupabaseStub({
      tabellen: {
        profielen: {
          fonds_id: "fonds-1",
          reflectie_uitnodiging: false,
          fondsen: { naam: "Pensioenfonds Horizon" },
        },
        // Nog geen eerder gesprek over dit punt → de kaart staat op "Help mij
        // met de voorbereiding" (niet op de herhaalvariant).
        gesprekken: [],
      },
    }),
  );
  return renderMetProviders(
    <AgendapuntChat
      agendapuntId={AGENDAPUNT_ID}
      titel="Vaststellen jaarverslag"
      stukken={[{ id: "doc-1", titel: "Jaarverslag 2025" }]}
    />,
  );
}

describe("Agendapunt — voorbereiding opstellen", () => {
  it("stuurt een Idempotency-Key mee naar de voorbereidingsroute", async () => {
    const { user } = monteer();

    // De kaart opent ingeklapt; het uitklappen start de init (profiel + eerder
    // gesprek), en pas daarna verschijnt de chip.
    await user.click(
      screen.getByRole("button", { name: /Vraag door over dit agendapunt/ }),
    );
    const chip = await screen.findByRole("button", {
      name: "Help mij met de voorbereiding",
    });

    const verzoek = verwachtSseStroomEenmaal(
      `/api/agendapunten/${AGENDAPUNT_ID}/voorbereiding`,
      [
        { type: "meta", bronnen: [{ nummer: 1, titel: "Jaarverslag 2025" }], inline_meldingen: [] },
        { type: "delta", text: "**Bestuurlijke duiding** — het bestuur wordt gevraagd…" },
        { type: "done" },
      ],
      // Knip de stroom, zodat een event over twee reads valt: precies waar een
      // eigengebouwde bufferlus stukgaat.
      { knip: 3 },
    );

    await user.click(chip);

    await waitFor(() =>
      expect(screen.getByText(/het bestuur wordt gevraagd/)).toBeInTheDocument(),
    );

    const sleutel = verzoek.headers().get("Idempotency-Key");
    expect(sleutel, "de voorbereidingsroute weigert een verzoek zonder sleutel (400)").toBeTruthy();
    expect(sleutel).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
