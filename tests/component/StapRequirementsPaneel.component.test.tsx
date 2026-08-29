import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import StapRequirementsPaneel from "@/app/(dashboard)/procedures/_components/StapRequirementsPaneel";
import type { EvidenceItem, ProcedureStep } from "@/core/lib/decision-view";
import { verwachtGeenErnstigeAxeBevindingen } from "./axe";
import { renderMetProviders } from "./render-met-providers";

const stap = {
  id: "stap-1",
  procedure_id: "procedure-1",
  volgorde: 2,
  naam: "Valideren",
  beschrijving: null,
  vereist_besluit: false,
  geschatte_dagen: null,
  status: "actief",
} satisfies ProcedureStep;

const vereiste = (overrides: Partial<EvidenceItem>): EvidenceItem => ({
  requirement_type: "document",
  stap_volgorde: 2,
  label: "Onderbouwing",
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
  besluitmoment_stap: null,
  gebonden_feiten: [],
  min_aantal: 1,
  dissent_open: 0,
  ...overrides,
});

describe("StapRequirementsPaneel", () => {
  it("toont vervulde en blokkerende vereisten met telling", async () => {
    const { container } = renderMetProviders(
      <StapRequirementsPaneel
        decisionId="decision-1"
        step={stap}
        evidence={[
          vereiste({ label: "Beleidsnotitie", vervuld: true, bron_titel: "Notitie 2026" }),
          vereiste({ label: "Risicoanalyse", requirement_type: "risk" }),
        ]}
        aiOutputs={[]}
      />,
    );

    expect(screen.getByText("1 van 2 voldaan")).toBeVisible();
    expect(screen.getByText("Notitie 2026")).toBeVisible();
    expect(screen.getByText("Blokkerend")).toBeVisible();
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("rendert niets wanneer alleen andere stappen bewijs hebben", () => {
    const { container } = renderMetProviders(
      <StapRequirementsPaneel
        decisionId="decision-1"
        step={stap}
        evidence={[vereiste({ stap_volgorde: 3 })]}
        aiOutputs={[]}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
