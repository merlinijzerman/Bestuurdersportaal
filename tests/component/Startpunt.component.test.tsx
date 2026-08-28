import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Startpunt from "@/app/(dashboard)/ai/_components/Startpunt";
import type { PortaalContext } from "@/core/lib/portaalcontext-afleiding";
import type { Startvraag } from "@/core/lib/startvragen";
import { verwachtGeenErnstigeAxeBevindingen } from "./axe";
import { renderMetProviders } from "./render-met-providers";

const vraag: Startvraag = { vraag: "Wat betekent besluitrijpheid?", intent: "algemeen" };
const context: PortaalContext = {
  volgendeVergadering: {
    id: "vergadering-1",
    titel: "Bestuursvergadering",
    datum: "2026-09-10T09:00:00.000Z",
    locatie: null,
  },
  agendapunten: {
    maatstaf: "eigen_inbreng",
    totaal: 2,
    zonderEigenInbreng: 1,
    eersteZonderInbreng: { id: "agenda-1", titel: "Transitieplan" },
    zonderGekoppeldStuk: 0,
    eersteZonderStuk: null,
  },
  openStappen: [],
  recentDocument: {
    id: "document-1",
    titel: "Jaarverslag 2025",
    aangemaakt: "2026-08-20T10:00:00.000Z",
  },
};

const legeContext: PortaalContext = {
  volgendeVergadering: null,
  agendapunten: {
    maatstaf: "eigen_inbreng",
    totaal: 0,
    zonderEigenInbreng: 0,
    eersteZonderInbreng: null,
    zonderGekoppeldStuk: 0,
    eersteZonderStuk: null,
  },
  openStappen: [],
  recentDocument: null,
};

describe("Startpunt", () => {
  it("activeert taak- en voorbeeldknoppen met het toetsenbord", async () => {
    const onVrijeVraag = vi.fn();
    const onVoorbeeldvraag = vi.fn();
    const onDocumentVraag = vi.fn();
    const { user } = renderMetProviders(
      <Startpunt
        context={context}
        voornaam="Merel"
        voorbeeldvragen={[vraag]}
        voorbeeldvragenZichtbaar
        onVrijeVraag={onVrijeVraag}
        onVoorbeeldvraag={onVoorbeeldvraag}
        onDocumentVraag={onDocumentVraag}
      />,
    );

    const vrijeVraag = screen.getByRole("button", { name: /Een vrije vraag stellen/ });
    vrijeVraag.focus();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: vraag.vraag }));
    await user.click(screen.getByRole("button", { name: /Een document doorgronden/ }));

    expect(onVrijeVraag).toHaveBeenCalledOnce();
    expect(onVoorbeeldvraag).toHaveBeenCalledWith(vraag);
    expect(onDocumentVraag).toHaveBeenCalledWith(context.recentDocument);
  });

  it("laat lege context, voorbeelden en bureauactie veilig weg", async () => {
    const { container } = renderMetProviders(
      <Startpunt
        context={legeContext}
        voornaam=""
        voorbeeldvragen={[vraag]}
        voorbeeldvragenZichtbaar={false}
        onVrijeVraag={vi.fn()}
        onVoorbeeldvraag={vi.fn()}
        onDocumentVraag={vi.fn()}
        magStukVoorbereiden={false}
      />,
    );

    expect(screen.queryByText("Speelt nu voor u")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: vraag.vraag })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Een stuk voorbereiden/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Een document doorgronden/ })).toHaveAttribute(
      "href",
      "/bibliotheek",
    );
    await verwachtGeenErnstigeAxeBevindingen(container);
  });
});
