import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StemrondeBlok, {
  type StemmingData,
} from "@/app/(dashboard)/vergaderingen/_components/StemrondeBlok";
import { DEFAULT_ALTERNATIEVEN } from "@/core/lib/stemming";
import { verwachtGeenErnstigeAxeBevindingen } from "./axe";
import { verwachtFetchEenmaal } from "./fetch-mock";
import { nextNavigationMocks } from "./next-mocks-intern";
import { renderMetProviders } from "./render-met-providers";
import { uitgesteld } from "./uitgesteld";

const basisProps = {
  agendapuntId: "agenda-1",
  decisionGekoppeld: true,
  besluitvraagDefault: "Kan het bestuur instemmen?",
  stemmen: [],
  huidigeGebruikerId: "gebruiker-1",
  magStarten: true,
  magSluiten: false,
  magStemmen: true,
  bestuursleden: [
    { id: "gebruiker-1", naam: "Ada" },
    { id: "gebruiker-2", naam: "Grace" },
  ],
  totaalBestuursleden: 2,
};

const openStemming: StemmingData = {
  id: "stemming-1",
  agendapunt_id: "agenda-1",
  decision_id: "decision-1",
  vraag: "Kan het bestuur instemmen?",
  alternatieven: [...DEFAULT_ALTERNATIEVEN],
  vereist_quorum: null,
  vereiste_meerderheid: null,
  status: "open",
  uitslag: null,
  ingetrokken_reden: null,
  geopend_door: "voorzitter-1",
};

describe("StemrondeBlok", () => {
  it("start een stemronde vanuit een toegankelijke modal", async () => {
    verwachtFetchEenmaal({
      url: "/api/stemmingen",
      method: "POST",
      controleerBody: (body) =>
        expect(body).toMatchObject({
          agendapunt_id: "agenda-1",
          vraag: "Kan het bestuur instemmen?",
        }),
    });
    const { user, container } = renderMetProviders(
      <StemrondeBlok {...basisProps} stemming={null} />,
    );

    const starten = screen.getByRole("button", { name: "Stemronde starten" });
    starten.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Stemronde starten" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Stemronde openen" }));

    expect(nextNavigationMocks.refresh).toHaveBeenCalledOnce();
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("blokkeert stemmen zonder keuze en toont een routefout", async () => {
    verwachtFetchEenmaal({
      url: "/api/stemmingen/stemming-1/stemmen",
      method: "POST",
      status: 400,
      json: { error: "Stemronde is inmiddels gesloten" },
    });
    const { user, container } = renderMetProviders(
      <StemrondeBlok {...basisProps} stemming={openStemming} />,
    );

    const versturen = screen.getByRole("button", { name: "Stem uitbrengen" });
    expect(versturen).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Voor" }));
    expect(versturen).toBeEnabled();
    await user.click(versturen);

    expect(await screen.findByRole("alert")).toHaveTextContent("Stemronde is inmiddels gesloten");
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("verbergt stemgedrag en tussenstand voor het bestuursbureau", async () => {
    const { container } = renderMetProviders(
      <StemrondeBlok {...basisProps} stemming={openStemming} magStemmen={false} />,
    );

    expect(screen.getByText(/bestuursbureau neemt niet deel/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Voor" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Stand \(/)).not.toBeInTheDocument();
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("blokkeert een tweede stem terwijl de eerste request loopt", async () => {
    const antwoord = uitgesteld<Response>();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementationOnce(() => antwoord.promise);
    const { user } = renderMetProviders(
      <StemrondeBlok {...basisProps} stemming={openStemming} />,
    );

    await user.click(screen.getByRole("button", { name: "Voor" }));
    await user.click(screen.getByRole("button", { name: "Stem uitbrengen" }));

    expect(screen.getByRole("button", { name: "Bezig…" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledOnce();
    antwoord.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    await screen.findByRole("button", { name: "Stem uitbrengen" });
  });
});
