// ============================================================================
//  Eén Supabase-client, één initialisatie — ook nu het oppervlak in de schil hangt.
// ----------------------------------------------------------------------------
//  Deze test bestond al vóór T1 en pinde dat een rerender van `AssistentClient`
//  geen tweede client en geen tweede initialisatie oplevert. Zijn premisse — het
//  oppervlak mount zijn eigen contextprovider — is met T1 vervallen: de provider
//  staat nu in `DashboardShell` en het oppervlak is de inhoud van het paneel.
//
//  De assertie is daarom BEWUST HERBEVESTIGD en niet stilzwijgend meegedreven.
//  Ze is nu zelfs zwaarwegender dan eerst: er hangt precies één oppervlak in de
//  schil, en een tweede client zou een tweede gesprek betekenen, met twee
//  schrijvers naar dezelfde `gesprekken`-rij.
// ============================================================================

import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AssistentOppervlak from "@/app/(dashboard)/ai/_components/AssistentOppervlak";
import { AssistentHarnas } from "./assistent-harnas";
import { verwachtSseStroomEenmaal } from "./fetch-mock";
import { renderMetProviders } from "./render-met-providers";
import { maakSupabaseStub } from "./supabase-mock";
import type { AssistentPaneelWaarde } from "@/core/components/assistent/AssistentPaneelProvider";

const { createClient, getUser } = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/core/lib/supabase", () => ({ createClient }));

describe("AssistentOppervlak", () => {
  it("maakt bij een rerender geen nieuwe client en start de initialisatie niet opnieuw", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    createClient.mockReturnValue({ auth: { getUser } });

    const { rerender } = renderMetProviders(
      <AssistentHarnas>
        <AssistentOppervlak />
      </AssistentHarnas>,
    );

    await waitFor(() => expect(getUser).toHaveBeenCalledOnce());

    rerender(
      <AssistentHarnas>
        <AssistentOppervlak />
      </AssistentHarnas>,
    );

    expect(createClient).toHaveBeenCalledOnce();
    expect(getUser).toHaveBeenCalledOnce();
  });
});

// ============================================================================
//  T2 (#304) — de startbeurt: de naad tussen de kaart en het gesprek.
// ----------------------------------------------------------------------------
//  De agendapuntkaart legt alleen een AANVRAAG neer; dit oppervlak moet haar
//  verzilveren én de beurt versturen. Faalt precies die overgang, dan opent het
//  paneel netjes en gebeurt er verder niets — een stille storing waar geen enkele
//  andere test overheen valt: de kaart-test ziet de aanvraag, de route-test ziet
//  de payload, en niemand ziet dat er nooit iemand op verzenden drukte.
// ============================================================================
describe("AssistentOppervlak — de startbeurt (T2)", () => {
  const AGENDAPUNT_ID = "agendapunt-1";

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  function monteer() {
    createClient.mockReturnValue(
      maakSupabaseStub({
        tabellen: {
          profielen: { fonds_id: "fonds-1", naam: "Jan de Vries", rol: "bestuurder" },
          agendapunten: { id: AGENDAPUNT_ID, titel: "Vaststellen jaarverslag" },
          gesprekken: [],
        },
      }),
    );
    let paneel: AssistentPaneelWaarde | null = null;
    renderMetProviders(
      <AssistentHarnas
        onWaarde={(w) => {
          paneel = w;
        }}
      >
        <AssistentOppervlak />
      </AssistentHarnas>,
    );
    return () => paneel;
  }

  it("verzilvert een aanvraag mét startbeurt en verstuurt die naar /api/chat", async () => {
    const paneelStaat = monteer();
    await waitFor(() => expect(paneelStaat()).toBeTruthy());

    const verzoek = verwachtSseStroomEenmaal("/api/chat", [
      { type: "delta", text: "**Bestuurlijke duiding** — het bestuur wordt gevraagd…" },
      { type: "done" },
    ]);

    await act(async () => {
      paneelStaat()!.openMet({
        ingangen: [{ soort: "agendapunt", agendapuntId: AGENDAPUNT_ID }],
        module: "vergaderingen",
        startbeurt: {
          vraag: "Stel mijn voorbereiding op voor dit agendapunt.",
          antwoordmodus: "persoonlijke_voorbereiding",
          productVoorAgendapunt: AGENDAPUNT_ID,
        },
      });
    });

    await waitFor(() => expect(verzoek.lichaam()).toBeTruthy());
    const body = verzoek.lichaam() as {
      messages: { role: string; content: string }[];
      actieve_antwoordmodus: string;
      agendapunt_context?: { id: string };
    };

    // De vraag is verstuurd — als gewone gebruikersbeurt, niet als een apart
    // veld dat de route zou moeten kennen.
    expect(body.messages.at(-1)).toEqual({
      role: "user",
      content: "Stel mijn voorbereiding op voor dit agendapunt.",
    });
    // De modus, want zonder deze kiest de route SP_AGENDAPUNT_REGELS.
    expect(body.actieve_antwoordmodus).toBe("persoonlijke_voorbereiding");
    // En de context, verzilverd door dezelfde resolver als een deeplink. Zonder
    // dit loopt de beurt als gewone bibliotheekvraag.
    expect(body.agendapunt_context?.id).toBe(AGENDAPUNT_ID);

    // De kostendragende beurt vuurt precies één keer per aanvraag.
    expect(vi.mocked(fetch).mock.calls.filter((c) => String(c[0]) === "/api/chat")).toHaveLength(1);

    // En de kaart krijgt haar signaal om het bewaarde product op te halen.
    await waitFor(() =>
      expect(paneelStaat()!.productSignaal).toEqual({
        agendapuntId: AGENDAPUNT_ID,
        teller: 1,
      }),
    );
  });

  it("verstuurt niets bij een aanvraag ZONDER startbeurt", async () => {
    const paneelStaat = monteer();
    await waitFor(() => expect(paneelStaat()).toBeTruthy());

    await act(async () => {
      paneelStaat()!.openMet({
        ingangen: [{ soort: "agendapunt", agendapuntId: AGENDAPUNT_ID }],
        module: "vergaderingen",
      });
    });

    // "Doorvragen" opent het gesprek; het start er geen. Zou dit wél vuren, dan
    // startte elke module-ingang ongevraagd een AI-beurt.
    await waitFor(() => expect(paneelStaat()!.aanvraag).toBeNull());
    expect(vi.mocked(fetch).mock.calls.filter((c) => String(c[0]) === "/api/chat")).toHaveLength(0);
    expect(paneelStaat()!.productSignaal).toBeNull();
  });
});
