import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AantekeningenBlok from "@/app/(dashboard)/procedures/_components/AantekeningenBlok";
import { verwachtFetchEenmaal } from "./fetch-mock";
import { renderMetProviders } from "./render-met-providers";

const basis = "/api/procedures/procedure-1/stappen/stap-1/notities";

describe("AantekeningenBlok", () => {
  it("biedt een bestuurder op een actieve stap een eigen aantekening aan", () => {
    verwachtFetchEenmaal({ url: basis, json: { notities: [] } });

    renderMetProviders(
      <AantekeningenBlok
        procedureId="procedure-1"
        stapId="stap-1"
        magAantekeningenWijzigen
        alleenLezen={false}
        currentUserId="bestuurder-1"
      />,
    );

    expect(screen.getByRole("button", { name: "+ Aantekening" })).toBeEnabled();
  });

  it("houdt de schrijfknop gesloten voor een niet-bewerkbare stap", () => {
    verwachtFetchEenmaal({ url: basis, json: { notities: [] } });

    renderMetProviders(
      <AantekeningenBlok
        procedureId="procedure-1"
        stapId="stap-1"
        magAantekeningenWijzigen
        alleenLezen
        currentUserId="bestuurder-1"
      />,
    );

    expect(screen.queryByRole("button", { name: "+ Aantekening" })).not.toBeInTheDocument();
  });
});
