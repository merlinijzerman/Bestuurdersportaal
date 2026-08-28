import { useState } from "react";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AutoGrowTextarea from "@/core/components/AutoGrowTextarea";
import { verwachtGeenErnstigeAxeBevindingen } from "./axe";
import { renderMetProviders } from "./render-met-providers";

function GecontroleerdVeld({ disabled = false }: { disabled?: boolean }) {
  const [waarde, setWaarde] = useState("");
  return (
    <AutoGrowTextarea
      aria-label="Toelichting"
      minRows={3}
      disabled={disabled}
      value={waarde}
      onChange={(event) => setWaarde(event.target.value)}
    />
  );
}

describe("AutoGrowTextarea", () => {
  it("verwerkt toetsenbordinvoer en groeit mee met de inhoud", async () => {
    vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(96);
    const { user } = renderMetProviders(<GecontroleerdVeld />);

    const veld = screen.getByRole("textbox", { name: "Toelichting" });
    await user.type(veld, "Bestuurlijke toelichting");

    expect(veld).toHaveValue("Bestuurlijke toelichting");
    expect(veld).toHaveAttribute("rows", "3");
    expect(veld).toHaveStyle({ height: "96px" });
  });

  it("blokkeert invoer wanneer het veld is uitgeschakeld en is axe-schoon", async () => {
    const { user, container } = renderMetProviders(<GecontroleerdVeld disabled />);
    const veld = screen.getByRole("textbox", { name: "Toelichting" });

    await user.type(veld, "mag niet");

    expect(veld).toBeDisabled();
    expect(veld).toHaveValue("");
    await verwachtGeenErnstigeAxeBevindingen(container);
  });
});
