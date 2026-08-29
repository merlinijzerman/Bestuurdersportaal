import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Sidebar from "@/core/components/Sidebar";
import { ACTIEF_GESPREK_SLEUTEL } from "@/core/lib/ai-sessie";
import { verwachtGeenErnstigeAxeBevindingen } from "./axe";
import { krijgNextNavigationMocks } from "./next-mocks";
import { renderMetProviders } from "./render-met-providers";

const signOut = vi.hoisted(() => vi.fn());
const nextNavigationMocks = krijgNextNavigationMocks();

vi.mock("@/core/lib/supabase", () => ({
  createClient: () => ({ auth: { signOut } }),
}));

describe("Sidebar", () => {
  beforeEach(() => {
    signOut.mockResolvedValue({ error: null });
    nextNavigationMocks.pathname = "/ai";
  });

  it("filtert modules en beheerlinks op beschikbaarheid en rol", async () => {
    const { container } = renderMetProviders(
      <Sidebar
        gebruikerNaam="Ada Lovelace"
        gebruikerRol="bestuurder"
        fondsNaam="Fonds Demo"
        beschikbareModules={["home", "ai", "beheer"]}
        open
      />,
    );

    expect(screen.getByRole("link", { name: /AI Assistent/ })).toHaveAttribute("href", "/ai");
    expect(screen.queryByRole("link", { name: /Documentbibliotheek/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Catalogus & organen/ })).not.toBeInTheDocument();
    expect(screen.getByText("Bestuurslid")).toBeVisible();
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("klapt via toetsenbord in en logt uit zonder oude AI-sessie", async () => {
    const onToggle = vi.fn();
    const onNavigate = vi.fn();
    sessionStorage.setItem(ACTIEF_GESPREK_SLEUTEL, "gesprek-1");
    const { user } = renderMetProviders(
      <Sidebar
        gebruikerNaam="Ada Lovelace"
        gebruikerRol="beheerder"
        onToggleInklap={onToggle}
        onNavigate={onNavigate}
        open
      />,
    );

    const inklappen = screen.getByRole("button", { name: "Menu inklappen" });
    inklappen.focus();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: /Uitloggen/ }));

    expect(onToggle).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(ACTIEF_GESPREK_SLEUTEL)).toBeNull();
    expect(nextNavigationMocks.replace).toHaveBeenCalledWith("/login");
    expect(nextNavigationMocks.refresh).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledOnce();
  });
});
