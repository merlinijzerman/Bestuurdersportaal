import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StatusOvergangPaneel from "@/app/(dashboard)/procedures/_components/StatusOvergangPaneel";
import type {
  DecisionObject,
  DecisionStatus,
  ReadinessOverview,
  ReadinessTarget,
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

const readinessResultaat = (target: ReadinessTarget, voldoet = true) => ({
  decision_id: "decision-1",
  target,
  voldoet,
  blokkerend: !voldoet,
  kan_overrulen: ["voorzitter"],
  ontbrekend: voldoet
    ? []
    : [
        {
          requirement_type: "document" as const,
          stap_volgorde: 1,
          label: "Onderbouwing ontbreekt",
          documenttype: "notitie",
          blokkerend: true,
        },
      ],
});

const readiness = (reviewrijp = true): ReadinessOverview => ({
  onderbouwing_compleet: readinessResultaat("onderbouwing_compleet"),
  reviewrijp: readinessResultaat("reviewrijp", reviewrijp),
  bespreekrijp: readinessResultaat("bespreekrijp"),
  besluitrijp: readinessResultaat("besluitrijp"),
  verantwoordingsrijp: readinessResultaat("verantwoordingsrijp"),
  evaluatierijp: readinessResultaat("evaluatierijp"),
});

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
        readiness={readiness()}
        currentUserIsPrivileged={false}
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

  it("blokkeert een readiness-overgang voor een niet-bevoorrechte gebruiker", async () => {
    const { user, container } = renderMetProviders(
      <StatusOvergangPaneel
        decision={decisionBasis("in_validatie")}
        readiness={readiness(false)}
        currentUserIsPrivileged={false}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Volgende status"), "in_review");

    expect(screen.getByText(/Alleen voorzitter of beheerder/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Overgang doorvoeren" })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
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
        readiness={readiness()}
        currentUserIsPrivileged={false}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Volgende status"), "in_onderbouwing");
    await user.click(screen.getByRole("button", { name: "Overgang doorvoeren" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ongeldige overgang Ververs het dossier.",
    );
  });

  it("blokkeert herhaald uitvoeren terwijl de route nog antwoordt", async () => {
    const antwoord = uitgesteld<Response>();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementationOnce(() => antwoord.promise);
    const { user } = renderMetProviders(
      <StatusOvergangPaneel
        decision={decisionBasis("concept")}
        readiness={readiness()}
        currentUserIsPrivileged={false}
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
