import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AssistentClient from "@/app/(dashboard)/ai/_components/AssistentClient";
import type { PortaalContext } from "@/core/lib/portaalcontext-afleiding";
import { renderMetProviders } from "./render-met-providers";

const { createClient, getUser } = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/core/lib/supabase", () => ({ createClient }));

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

describe("AssistentClient", () => {
  it("maakt bij een rerender geen nieuwe client en start de initialisatie niet opnieuw", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    createClient.mockReturnValue({ auth: { getUser } });

    const { rerender } = renderMetProviders(
      <AssistentClient startpuntContext={legeContext} />,
    );

    await waitFor(() => expect(getUser).toHaveBeenCalledOnce());

    rerender(<AssistentClient startpuntContext={legeContext} />);

    expect(createClient).toHaveBeenCalledOnce();
    expect(getUser).toHaveBeenCalledOnce();
  });
});
