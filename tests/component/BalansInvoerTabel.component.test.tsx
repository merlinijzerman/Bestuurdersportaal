import { useState } from "react";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BalansInvoerTabel from "@/app/(dashboard)/beheer/stuurinformatie/_components/BalansInvoerTabel";
import {
  ACTIVA_DEFINITIES,
  PASSIVA_DEFINITIES,
  type ActivaKey,
  type PassivaKey,
} from "@/core/lib/stuurinfo-invoer";
import type { VeldState } from "@/app/(dashboard)/beheer/stuurinformatie/_components/StuurinfoInvoer";
import { verwachtGeenErnstigeAxeBevindingen } from "./axe";
import { renderMetProviders } from "./render-met-providers";

function maakVelden(sluit: boolean): VeldState {
  const activa = Object.fromEntries(ACTIVA_DEFINITIES.map(({ key }) => [key, "0"])) as Record<ActivaKey, string>;
  const passiva = Object.fromEntries(PASSIVA_DEFINITIES.map(({ key }) => [key, "0"])) as Record<PassivaKey, string>;
  activa.belegd = "100";
  passiva.tv = sluit ? "100" : "80";
  return { activa, passiva, fg: "106,0" } as VeldState;
}

function BewerkbareBalans({
  zetVeldSpy,
}: {
  zetVeldSpy: (sectie: "activa" | "passiva", key: string, waarde: string) => void;
}) {
  const [velden, setVelden] = useState(() => maakVelden(true));
  return (
    <BalansInvoerTabel
      velden={velden}
      referentie={null}
      gekozenPeriode="2026Q2"
      vorigePeriode="2026Q1"
      uitgeschakeld={false}
      zetVeld={(sectie, key, waarde) => {
        zetVeldSpy(sectie, key, waarde);
        setVelden((huidig) => ({
          ...huidig,
          [sectie]: { ...huidig[sectie], [key]: waarde },
        }));
      }}
      zetFg={(waarde) => setVelden((huidig) => ({ ...huidig, fg: waarde }))}
    />
  );
}

describe("BalansInvoerTabel", () => {
  it("berekent een sluitende balans en verwerkt benoemde invoer", async () => {
    const zetVeld = vi.fn();
    const { user, container } = renderMetProviders(<BewerkbareBalans zetVeldSpy={zetVeld} />);

    expect(screen.getByText(/Balans sluit —/)).toBeVisible();
    const belegd = screen.getByRole("textbox", { name: "Belegd vermogen" });
    await user.clear(belegd);
    await user.type(belegd, "120");

    expect(zetVeld).toHaveBeenLastCalledWith("activa", "belegd", "120");
    expect(screen.getByText(/Balans sluit niet/)).toBeVisible();
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("toont het verschil en blokkeert alle invoer in read-only stand", async () => {
    const zetVeld = vi.fn();
    const { user, container } = renderMetProviders(
      <BalansInvoerTabel
        velden={maakVelden(false)}
        referentie={null}
        gekozenPeriode={null}
        vorigePeriode={null}
        zetVeld={zetVeld}
        zetFg={vi.fn()}
        uitgeschakeld
      />,
    );

    expect(screen.getByText(/verschil € 20 mln/)).toBeVisible();
    const belegd = screen.getByRole("textbox", { name: "Belegd vermogen" });
    expect(belegd).toBeDisabled();
    await user.type(belegd, "5");
    expect(zetVeld).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Financieringsgraad (%)" })).toBeDisabled();
    await verwachtGeenErnstigeAxeBevindingen(container);
  });
});
