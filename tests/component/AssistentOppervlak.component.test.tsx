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

import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AssistentOppervlak from "@/app/(dashboard)/ai/_components/AssistentOppervlak";
import { AssistentHarnas } from "./assistent-harnas";
import { renderMetProviders } from "./render-met-providers";

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
