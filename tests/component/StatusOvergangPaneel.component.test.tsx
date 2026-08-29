import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StatusOvergangPaneel from "@/app/(dashboard)/procedures/_components/StatusOvergangPaneel";
import type {
  DecisionObject,
  DecisionStatus,
  EvidenceItem,
} from "@/core/lib/decision-view";
import { verwachtGeenErnstigeAxeBevindingen } from "./axe";
import { verwachtFetchEenmaal } from "./fetch-mock";
import { nextNavigationMocks } from "./next-mocks-intern";
import { renderMetProviders } from "./render-met-providers";
import { uitgesteld } from "./uitgesteld";

const decisionBasis = (status: DecisionStatus): DecisionObject =>
  ({
    id: "decision-1",
    status,
    complexiteit: "routine",
    risiconiveau: "laag",
  }) as DecisionObject;

const openVereiste: EvidenceItem = {
  requirement_type: "document",
  stap_volgorde: 1,
  label: "Onderbouwing ontbreekt",
  toelichting: null,
  documenttype: "notitie",
  verplicht: true,
  blokkerend: true,
  vervuld: false,
  bron_type: null,
  bron_id: null,
  bron_titel: null,
  bron: "template",
  instance_id: null,
  besluitmoment_stap: 2,
  gebonden_feiten: [],
  min_aantal: 1,
  dissent_open: 0,
};

describe("StatusOvergangPaneel", () => {
  it("voert een geldige overgang via het toetsenbord uit", async () => {
    verwachtFetchEenmaal({
      url: "/api/decisions/decision-1/status",
      method: "POST",
      controleerBody: (body) =>
        expect(body).toEqual({ status: "in_onderbouwing", reden: "Dossier gestart" }),
    });
    const { user, container } = renderMetProviders(
      <StatusOvergangPaneel
        decision={decisionBasis("concept")}
        evidence={[]}
        besluitmomentStappen={[]}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Volgende status"), "in_onderbouwing");
    await user.type(screen.getByLabelText("Reden voor overgang (optioneel)"), "Dossier gestart");
    const uitvoeren = screen.getByRole("button", { name: "Overgang doorvoeren" });
    uitvoeren.focus();
    await user.keyboard("{Enter}");

    expect(nextNavigationMocks.refresh).toHaveBeenCalledOnce();
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("vereist motivering bij een besluit met openstaande vereisten", async () => {
    verwachtFetchEenmaal({
      url: "/api/decisions/decision-1/status",
      method: "POST",
      controleerBody: (body) =>
        expect(body).toEqual({
          status: "besloten",
          motivering: "Besluit kan nu; de onderbouwing volgt aantoonbaar na.",
        }),
    });
    const { user, container } = renderMetProviders(
      <StatusOvergangPaneel
        decision={decisionBasis("in_bespreking")}
        evidence={[openVereiste]}
        besluitmomentStappen={[2]}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Volgende status"), "besloten");

    expect(screen.getByText(/Openstaande vereisten voor dit besluitmoment/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Overgang doorvoeren" })).toBeDisabled();
    await user.type(
      screen.getByLabelText("Motivering (verplicht — besluit met openstaande vereisten)"),
      "Besluit kan nu; de onderbouwing volgt aantoonbaar na.",
    );
    await user.click(screen.getByRole("button", { name: "Overgang doorvoeren" }));
    expect(fetch).toHaveBeenCalledOnce();
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("toont een fout van de statusroute", async () => {
    verwachtFetchEenmaal({
      url: "/api/decisions/decision-1/status",
      method: "POST",
      status: 409,
      json: { error: "Ongeldige overgang", hint: "Ververs het dossier." },
    });
    const { user } = renderMetProviders(
      <StatusOvergangPaneel
        decision={decisionBasis("concept")}
        evidence={[]}
        besluitmomentStappen={[]}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Volgende status"), "in_onderbouwing");
    await user.click(screen.getByRole("button", { name: "Overgang doorvoeren" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ongeldige overgang");
  });

  it("blokkeert herhaald uitvoeren terwijl de route nog antwoordt", async () => {
    const antwoord = uitgesteld<Response>();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementationOnce(() => antwoord.promise);
    const { user } = renderMetProviders(
      <StatusOvergangPaneel
        decision={decisionBasis("concept")}
        evidence={[]}
        besluitmomentStappen={[]}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Volgende status"), "in_onderbouwing");
    await user.click(screen.getByRole("button", { name: "Overgang doorvoeren" }));

    expect(screen.getByRole("button", { name: "Bezig…" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledOnce();
    antwoord.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    await screen.findByRole("button", { name: "Overgang doorvoeren" });
  });
});
