import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OnderbouwingPaneel, {
  type OnderbouwingMeta,
} from "@/app/(dashboard)/ai/_components/OnderbouwingPaneel";
import { verwachtGeenErnstigeAxeBevindingen } from "./axe";
import { renderMetProviders } from "./render-met-providers";

const meta: OnderbouwingMeta = {
  bronbasis: "Fondsdocumenten en webbronnen",
  aantalBronnen: 2,
  bronTitels: ["Beleidsnota", "Jaarverslag"],
  retrievalModus: "actueel",
  webRetrievalActief: true,
  webBronnen: [
    {
      url: "https://www.dnb.nl/toezicht",
      titel: "DNB toezicht",
      domein: "dnb.nl",
    },
    {
      url: "javascript:alert(1)",
      titel: "Onveilige bron",
      domein: "onveilig.test",
    },
  ],
};

describe("OnderbouwingPaneel", () => {
  it("meldt de toggle via toetsenbord en koppelt knop aan inhoud", async () => {
    const onToggle = vi.fn();
    const { user } = renderMetProviders(
      <OnderbouwingPaneel meta={meta} open={false} onToggle={onToggle} />,
    );
    const knop = screen.getByRole("button", { name: /Onderbouwing en bronnen/ });

    knop.focus();
    await user.keyboard("{Enter}");

    expect(onToggle).toHaveBeenCalledOnce();
    expect(knop).toHaveAttribute("aria-expanded", "false");
    expect(knop).toHaveAttribute("aria-controls");
  });

  it("rendert veilige links en maakt een onveilige URL niet klikbaar", async () => {
    const { container } = renderMetProviders(
      <OnderbouwingPaneel meta={meta} open onToggle={vi.fn()} />,
    );

    expect(screen.getByRole("link", { name: "DNB toezicht" })).toHaveAttribute(
      "href",
      "https://www.dnb.nl/toezicht",
    );
    expect(screen.queryByRole("link", { name: "Onveilige bron" })).not.toBeInTheDocument();
    expect(screen.getByText("Onveilige bron")).toBeVisible();
    expect(screen.getByRole("region", { name: /Onderbouwing en bronnen/ })).toBeVisible();
    await verwachtGeenErnstigeAxeBevindingen(container);
  });
});
