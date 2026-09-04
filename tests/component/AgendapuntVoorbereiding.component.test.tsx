// ============================================================================
//  "Mijn voorbereiding": de kaart is de uitkomst, het paneel de werkplaats.
// ----------------------------------------------------------------------------
//  Deze test pinde tot T2 het VERZOEK van de kaart aan de eigen
//  voorbereidingsroute: de `Idempotency-Key`, ingevoerd nadat een 400-antwoord
//  maandenlang als AI-tekst in de kaart verscheen zonder dat iemand het zag.
//
//  Met T2 (#304) doet de kaart dat verzoek niet meer. De laatste eigen `fetch` +
//  SSE-lus buiten `useAssistent` is weg; beide knoppen openen het paneel, en het
//  paneel verstuurt de beurt door `/api/chat`. De sleutel-assertie verhuist
//  daarmee naar het chat-pad, waar hij al gold (route.ts r. 647) en waar
//  `assistent-payload.sanity.ts` hem bewaakt. Ze verdampt dus niet, ze verhuist
//  — net als bij T1.
//
//  Wat deze test nu pint:
//   • de kaart LEEST het bewaarde product uit `voorbereidingen`, niet een
//     gesprekquery — "voorbereid" is een feit, geen gevolgtrekking;
//   • een rij die alleen aantekeningen draagt is GEEN voorbereiding;
//   • de knop legt een paneelaanvraag neer MÉT startbeurt (vraag + modus +
//     agendapunt), want dat is het hele mechanisme van variant B;
//   • twee handelingen op een voltooid product (opnieuw opstellen én
//     doorvragen). Dit preciseert besluit 0204: "één knop per toestand" was
//     gericht tegen twee INGANGEN op een onvoorbereid punt, en dáár staat er
//     nog steeds precies één.
// ============================================================================

import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VoorbereidingKaart from "@/app/(dashboard)/vergaderingen/_components/VoorbereidingKaart";
import { AssistentHarnas } from "./assistent-harnas";
import { verwachtGeenErnstigeAxeBevindingen } from "./axe";
import { renderMetProviders } from "./render-met-providers";
import { maakSupabaseStub } from "./supabase-mock";
import type { AssistentPaneelWaarde } from "@/core/components/assistent/AssistentPaneelProvider";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/core/lib/supabase", () => ({ createClient }));

const AGENDAPUNT_ID = "agendapunt-1";
const VOORBEREIDING_VRAAG = "Stel mijn voorbereiding op voor dit agendapunt.";

const PROFIEL = { fondsen: { naam: "Pensioenfonds Horizon" } };

/** Een bewaard product zoals de chat-route het wegschrijft. */
const PRODUCT = {
  ai_output: {
    tekst: "**Aandachtspunten** — de dekkingsgraad daalt [Bron 1].",
    opgesteld_op: "2026-09-02T10:00:00.000Z",
    governance_log_id: "log-1",
    gesprek_id: "gesprek-1",
  },
  bronnen_meta: {
    aantal: 2,
    titels: ["Jaarverslag 2025", "Beleidsnota"],
    bronnen: [
      {
        nummer: 1,
        document_id: "doc-1",
        titel: "Jaarverslag 2025",
        bron: "bibliotheek",
        pagina: 12,
        paragraaf: null,
        heeft_origineel: true,
      },
      {
        nummer: 2,
        document_id: "doc-2",
        titel: "Beleidsnota",
        bron: "bibliotheek",
        pagina: null,
        paragraaf: "3.2",
        heeft_origineel: false,
      },
    ],
  },
  gegenereerd_op: "2026-09-02T10:00:00.000Z",
  bijgewerkt_op: "2026-09-02T10:00:00.000Z",
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function monteer({ voorbereiding = null as unknown }: { voorbereiding?: unknown } = {}) {
  createClient.mockReturnValue(
    maakSupabaseStub({
      tabellen: { profielen: PROFIEL, voorbereidingen: voorbereiding },
    }),
  );
  let paneel: AssistentPaneelWaarde | null = null;
  const weergave = renderMetProviders(
    <AssistentHarnas
      onWaarde={(w) => {
        paneel = w;
      }}
    >
      <VoorbereidingKaart agendapuntId={AGENDAPUNT_ID} titel="Vaststellen jaarverslag" />
    </AssistentHarnas>,
  );
  return { ...weergave, paneelStaat: () => paneel };
}

describe("Mijn voorbereiding", () => {
  it("legt bij een klik een paneelaanvraag mét startbeurt neer", async () => {
    const { user, paneelStaat } = monteer();

    const knop = await screen.findByRole("link", { name: /Bereid dit punt voor/ });
    // Nog niet voorbereid: precies één ingang, zoals besluit 0204 vraagt.
    expect(screen.queryByRole("link", { name: /Doorvragen/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Opnieuw opstellen/ }),
    ).not.toBeInTheDocument();

    await user.click(knop);

    await waitFor(() => expect(paneelStaat()?.aanvraag).toBeTruthy());
    const aanvraag = paneelStaat()!.aanvraag!;
    // De context: dit agendapunt, via dezelfde resolver als een deeplink.
    expect(aanvraag.ingangen).toEqual([
      { soort: "agendapunt", agendapuntId: AGENDAPUNT_ID },
    ]);
    // En de beurt die het paneel moet versturen. Zonder deze drie velden opent
    // het paneel wel, maar stelt niemand de vraag.
    expect(aanvraag.startbeurt).toEqual({
      vraag: VOORBEREIDING_VRAAG,
      antwoordmodus: "persoonlijke_voorbereiding",
      productVoorAgendapunt: AGENDAPUNT_ID,
    });
    // Het paneel gaat open; de kaart doet zelf niets meer.
    expect(paneelStaat()!.stand).toBe("paneel");
  });

  it("leest het bewaarde product uit voorbereidingen", async () => {
    const { container } = monteer({ voorbereiding: PRODUCT });

    expect(await screen.findByText(/de dekkingsgraad daalt/)).toBeVisible();
    // Datum én bronaantal komen uit het product zelf — dat is precies wat een
    // gesprekquery niet kon leveren.
    expect(screen.getByText(/2 bronnen uit de bibliotheek/)).toBeVisible();
    expect(screen.getByText(/Opgesteld 2 september 2026/)).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /Bereid dit punt voor/ }),
    ).not.toBeInTheDocument();
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("biedt op een voltooid product twee handelingen (0204 gepreciseerd)", async () => {
    const { user, paneelStaat } = monteer({ voorbereiding: PRODUCT });

    const opnieuw = await screen.findByRole("link", { name: /Opnieuw opstellen/ });
    expect(screen.getByRole("link", { name: /Doorvragen/ })).toBeVisible();

    // "Opnieuw opstellen" draagt de startbeurt; "Doorvragen" juist niet — dat
    // opent het gesprek zonder ongevraagd een kostendragende beurt te starten.
    await user.click(opnieuw);
    await waitFor(() => expect(paneelStaat()?.aanvraag?.startbeurt).toBeTruthy());

    await user.click(screen.getByRole("link", { name: /Doorvragen/ }));
    await waitFor(() =>
      expect(paneelStaat()?.aanvraag?.startbeurt).toBeUndefined(),
    );
  });

  it("toont de knop nog bij een rij met alleen aantekeningen", async () => {
    // De notities-route maakt een rij aan zodra een bestuurder een aantekening
    // opslaat. Zou de kaart die als "voorbereid" lezen, dan ziet hij een lege
    // voorbereiding én verdwijnt de knop om er een te maken.
    monteer({
      voorbereiding: {
        ai_output: {},
        bronnen_meta: {},
        eigen_notities: { lens: "Vragen naar de termijn." },
        gegenereerd_op: "2026-09-01T10:00:00.000Z",
      },
    });

    expect(
      await screen.findByRole("link", { name: /Bereid dit punt voor/ }),
    ).toBeVisible();
    expect(screen.queryByText(/Opgesteld/)).not.toBeInTheDocument();
  });
});
