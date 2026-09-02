import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AiBegrenzingPagina from "@/app/(platform)/platform/(beveiligd)/ai-begrenzing/page";

const mocks = vi.hoisted(() => {
  class PlatformError extends Error {
    constructor(
      public status: 403 | 503 | 500,
      public foutcode: string,
    ) {
      super(foutcode);
      this.name = "PlatformError";
    }
  }

  return {
    PlatformError,
    huidigePlatformIdentiteit: vi.fn(),
    haalAiBegrenzingOverzicht: vi.fn(),
    withPlatformRead: vi.fn(),
  };
});

vi.mock("@/platform/lib/platform-auth", () => ({
  huidigePlatformIdentiteit: mocks.huidigePlatformIdentiteit,
}));

vi.mock("@/platform/lib/ai-begrenzing-lees", () => ({
  haalAiBegrenzingOverzicht: mocks.haalAiBegrenzingOverzicht,
}));

vi.mock("@/platform/lib/platform-wrapper", () => ({
  PlatformError: mocks.PlatformError,
  withPlatformRead: mocks.withPlatformRead,
}));

vi.mock(
  "@/app/(platform)/platform/(beveiligd)/ai-begrenzing/_components/AiBegrenzingClient",
  () => ({
    default: ({ ikId }: { ikId: string | null }) => (
      <div data-testid="ai-begrenzing-client">{ikId}</div>
    ),
  }),
);

describe("AiBegrenzingPagina", () => {
  it("rendert het geladen overzicht buiten de foutafhandeling", async () => {
    const overzicht = {
      fondsen: [],
      gebruikers: [],
      gelezenRijen: 0,
      afgekapt: false,
    };
    mocks.huidigePlatformIdentiteit.mockResolvedValue({
      id: "platformbeheerder-1",
      capabilities: [
        "platform.observability.read",
        "platform.security.operate",
        "platform.config.manage",
      ],
    });
    mocks.haalAiBegrenzingOverzicht.mockResolvedValue(overzicht);
    mocks.withPlatformRead.mockImplementation(async (_opties, lees) => {
      const resultaat = await lees({});
      return resultaat.resultaat;
    });

    render(await AiBegrenzingPagina());

    expect(screen.getByTestId("ai-begrenzing-client")).toHaveTextContent(
      "platformbeheerder-1",
    );
    expect(mocks.withPlatformRead).toHaveBeenCalledWith(
      {
        capability: "platform.observability.read",
        handeling: "ai.begrenzing.inzien",
      },
      expect.any(Function),
    );
    expect(mocks.haalAiBegrenzingOverzicht).toHaveBeenCalledOnce();
  });

  it("toont de bestaande herstelmelding bij een PlatformError", async () => {
    mocks.huidigePlatformIdentiteit.mockResolvedValue({
      id: "platformbeheerder-1",
      capabilities: ["platform.observability.read"],
    });
    mocks.withPlatformRead.mockRejectedValue(
      new mocks.PlatformError(503, "audit_unavailable"),
    );

    render(await AiBegrenzingPagina());

    expect(
      screen.getByText(/De AI-begrenzing kon niet worden geopend/),
    ).toHaveTextContent("audit_unavailable");
    expect(screen.queryByTestId("ai-begrenzing-client")).not.toBeInTheDocument();
  });
});
