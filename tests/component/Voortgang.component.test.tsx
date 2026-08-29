import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  pasVoortgangToe,
  VoortgangWeergave,
  type VoortgangUI,
} from "@/app/(dashboard)/ai/_components/Voortgang";
import { verwachtGeenErnstigeAxeBevindingen } from "./axe";
import { renderMetProviders } from "./render-met-providers";

describe("Voortgang", () => {
  it("bouwt voortgang op van actief naar afgerond", () => {
    const actief = pasVoortgangToe(null, {
      fase: "retrieval",
      status: "bezig",
      label: "Bronnen zoeken",
    });
    const klaar = pasVoortgangToe(actief, {
      fase: "retrieval",
      status: "klaar",
      label: "Bronnen gevonden",
      uitkomst: "3 documenten",
    });

    expect(actief?.actiefLabel).toBe("Bronnen zoeken");
    expect(klaar).toMatchObject({
      actieveFase: null,
      klaar: [{ fase: "retrieval", label: "Bronnen gevonden", uitkomst: "3 documenten" }],
    });
  });

  it("negeert een event zonder fase en toont een toegankelijke fallback", async () => {
    const bestaand: VoortgangUI = {
      actieveFase: "analyse",
      actiefLabel: "Analyse",
      analyse: { batch: 1, totaal: 2 },
      klaar: [],
    };
    expect(pasVoortgangToe(bestaand, { status: "klaar" })).toBe(bestaand);

    const { container } = renderMetProviders(<VoortgangWeergave voortgang={null} />);
    expect(screen.getByRole("status", { name: "Antwoord wordt voorbereid" })).toBeVisible();
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("toont actieve analyse en afgeronde uitkomsten", async () => {
    const { container } = renderMetProviders(
      <VoortgangWeergave
        voortgang={{
          actieveFase: "analyse",
          actiefLabel: "Document wordt geanalyseerd",
          analyse: { batch: 2, totaal: 4 },
          klaar: [{ fase: "retrieval", label: "Bronnen gevonden", uitkomst: "3 documenten" }],
        }}
      />,
    );

    expect(screen.getByText(/deel 2 van 4/)).toBeVisible();
    expect(screen.getByText(/3 documenten/)).toBeVisible();
    await verwachtGeenErnstigeAxeBevindingen(container);
  });
});
