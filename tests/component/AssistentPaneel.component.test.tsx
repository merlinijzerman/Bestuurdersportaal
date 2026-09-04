// ============================================================================
//  Het assistentpaneel: vier standen, focusbeheer, contextchip (T1, 0204).
// ----------------------------------------------------------------------------
//  Wat hier gepind wordt is precies wat bij een paneel stilletjes wegzakt als
//  niemand het toetst: dat de focus mee verhuist en terugkeert, dat Escape
//  sluit, dat de openers `aria-expanded` dragen — en dat de contentkolom
//  opschuift in plaats van dat het paneel eroverheen valt.
//
//  De contextchip wordt hier met een expliciet gezette scope getoetst en niet
//  via een echte klik: het verzilveren van een ingang-aanvraag gebeurt in de
//  gespreklaag (die een Supabase-client nodig heeft). Deze test gaat over de
//  schil; de aanvraag zelf is het contract dat `openMet` vastlegt.
// ============================================================================

import { screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardShell from "@/core/components/DashboardShell";
import AssistentIngang from "@/core/components/assistent/AssistentIngang";
import AssistentPaneel from "@/core/components/assistent/AssistentPaneel";
import { useAssistentContext } from "@/core/components/assistent/AssistentContextProvider";
import type { ModuleScope } from "@/core/lib/assistent-types";
import { AssistentHarnas } from "./assistent-harnas";
import { verwachtGeenErnstigeAxeBevindingen } from "./axe";
import { krijgNextNavigationMocks } from "./next-mocks";
import { renderMetProviders } from "./render-met-providers";

const signOut = vi.hoisted(() => vi.fn());
vi.mock("@/core/lib/supabase", () => ({
  createClient: () => ({ auth: { signOut } }),
}));

const nextNavigationMocks = krijgNextNavigationMocks();

/** Zet een scope zoals de gespreklaag dat na het opzoeken zou doen. */
function ZetScope({ scope }: { scope: ModuleScope }) {
  const { zetModuleScope } = useAssistentContext();
  useEffect(() => {
    zetModuleScope(scope);
  }, [scope, zetModuleScope]);
  return null;
}

function monteer({ scope }: { scope?: ModuleScope } = {}) {
  return renderMetProviders(
    <AssistentHarnas>
      {scope && <ZetScope scope={scope} />}
      <AssistentIngang ingangen={[{ soort: "risicomatrix" }]} module="risicomatrix">
        Bespreek met de AI
      </AssistentIngang>
      <AssistentPaneel navBreedte="16rem">
        <p>Waar kan ik u mee helpen?</p>
      </AssistentPaneel>
    </AssistentHarnas>,
  );
}

const paneel = () => document.getElementById("assistent-paneel") as HTMLElement;
const opener = () => screen.getByRole("link", { name: "Bespreek met de AI" });

describe("Assistentpaneel", () => {
  beforeEach(() => {
    nextNavigationMocks.pathname = "/risicomatrix";
  });

  it("is dicht tot een ingang hem opent, en zegt dat in aria-expanded", async () => {
    const { user } = monteer();

    expect(paneel()).not.toBeVisible();
    expect(opener()).toHaveAttribute("aria-expanded", "false");
    // De href blijft staan: midden-klik en bookmarken moeten blijven werken,
    // en zonder paneel is de link de val-terug.
    expect(opener()).toHaveAttribute("href", "/ai?risicomatrix=1");

    await user.click(opener());

    expect(paneel()).toBeVisible();
    expect(paneel()).toHaveAttribute("data-stand", "paneel");
    expect(opener()).toHaveAttribute("aria-expanded", "true");
  });

  it("verplaatst de focus naar het paneel en geeft hem bij Escape terug", async () => {
    const { user } = monteer();
    await user.click(opener());

    await waitFor(() => expect(paneel()).toHaveFocus());

    await user.keyboard("{Escape}");

    expect(paneel()).not.toBeVisible();
    // Terug naar de knop die het opende — niet naar <body>.
    expect(opener()).toHaveFocus();
  });

  it("sluit via het kruisje en maakt de ingang opnieuw beschikbaar", async () => {
    const { user } = monteer();
    await user.click(opener());

    await user.click(
      within(paneel()).getByRole("button", { name: "Assistent sluiten" }),
    );

    expect(paneel()).not.toBeVisible();
    expect(opener()).toHaveAttribute("aria-expanded", "false");
  });

  it("wisselt tussen paneel en vergroot", async () => {
    const { user } = monteer();
    await user.click(opener());

    await user.click(screen.getByRole("button", { name: "Paneel vergroten" }));
    expect(paneel()).toHaveAttribute("data-stand", "vergroot");

    await user.click(screen.getByRole("button", { name: "Paneel verkleinen" }));
    expect(paneel()).toHaveAttribute("data-stand", "paneel");
  });

  it("gaat naar volledig scherm via de route /ai, zodat de stand deelbaar blijft", async () => {
    const { user } = monteer();
    await user.click(opener());

    await user.click(screen.getByRole("button", { name: "Volledig scherm" }));

    expect(paneel()).toHaveAttribute("data-stand", "volledig");
    // Zacht navigeren: dezelfde layout, dus hetzelfde oppervlak en hetzelfde
    // gesprek. Dát is waarom de oude link "Openen in volledige assistent" weg kan.
    expect(nextNavigationMocks.push).toHaveBeenCalledWith("/ai");
  });

  it("toont de contextchip en laat hem los", async () => {
    const { user, container } = monteer({
      scope: { soort: "risicomatrix", label: "de risicomatrix" },
    });
    await user.click(opener());

    expect(await screen.findByText("Risicomatrix")).toBeVisible();
    expect(screen.getByText(/alle open risico's van het fonds/)).toBeVisible();
    await verwachtGeenErnstigeAxeBevindingen(container);

    await user.click(
      screen.getByRole("button", { name: "Context loslaten: Risicomatrix" }),
    );

    expect(screen.getByText("Fondsbreed")).toBeVisible();
    // Fondsbreed is geen scope: een kruisje dat niets doet hoort er niet te staan.
    expect(
      screen.queryByRole("button", { name: /Context loslaten/ }),
    ).not.toBeInTheDocument();
  });
});

describe("DashboardShell met het paneel", () => {
  beforeEach(() => {
    nextNavigationMocks.pathname = "/bibliotheek";
  });

  it("schuift de contentkolom op in plaats van hem te overlappen", async () => {
    const { user, container } = renderMetProviders(
      <DashboardShell beschikbareModules={["home", "ai"]} assistentOppervlak={<p>gesprek</p>}>
        <p>module-inhoud</p>
      </DashboardShell>,
    );

    const hoofd = container.querySelector("main") as HTMLElement;
    expect(hoofd.className).not.toMatch(/assistent-marge/);
    // Lui monteren: zonder opening bestaat het oppervlak niet, en dus ook geen
    // tweede Supabase-client voor wie de assistent nooit gebruikt.
    expect(screen.queryByText("gesprek")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Assistent openen" }));

    expect(hoofd.className).toMatch(/assistent-marge-paneel/);
    expect(screen.getByText("gesprek")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Assistent" })).toBeVisible();
    expect(screen.getByText("Context · Fondsbibliotheek")).toBeVisible();
    expect(screen.getByText("Fondsbibliotheek")).toBeVisible();
    expect(screen.getByText("binnen uw rechten")).toBeVisible();
  });

  it("laat met module ai uit geen enkele ingang zien", () => {
    renderMetProviders(
      <DashboardShell beschikbareModules={["home"]} assistentOppervlak={<p>gesprek</p>}>
        <AssistentIngang ingangen={[]} module="home">
          Vraag de AI
        </AssistentIngang>
      </DashboardShell>,
    );

    expect(screen.queryByRole("button", { name: "Assistent openen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Vraag de AI" })).not.toBeInTheDocument();
    expect(document.getElementById("assistent-paneel")).toBeNull();
  });
});
