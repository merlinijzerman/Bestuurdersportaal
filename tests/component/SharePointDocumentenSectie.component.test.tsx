import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SharePointDocumentenSectie from "@/app/(dashboard)/bibliotheek/_components/SharePointDocumentenSectie";
import { renderMetProviders } from "./render-met-providers";

const MAP_REF = "11111111-2222-4333-8444-555555555555";
const DOC_REF = "66666666-7777-4888-8999-000000000000";

describe("SharePointDocumentenSectie — actiemenu en mapcontext", () => {
  it("zet document- en mapacties achter de drie puntjes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      beschikbaar: true,
      aiContextBeschikbaar: true,
      bron: { weergavenaam: "PGB", site: "Lab", bibliotheek: "Documenten", map: "PGB" },
      mappen: ["Bestuur"],
      mapRefs: [{ ref: MAP_REF, naam: "Bestuur", mappad: "Bestuur" }],
      documenten: [{
        ref: DOC_REF,
        naam: "Beleidsnotitie.docx",
        bestandstype: "docx",
        grootte: 1024,
        gewijzigdOp: "2026-09-28T10:00:00.000Z",
        mappad: "",
        previewMogelijk: true,
        webUrl: "https://voorbeeld.sharepoint.com/sites/lab/Beleidsnotitie.docx",
      }],
      afgekapt: false,
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const { user } = renderMetProviders(<SharePointDocumentenSectie />);
    await screen.findByText("Beleidsnotitie.docx");
    expect(screen.queryByText("Vraag de AI over deze map")).not.toBeInTheDocument();
    expect(screen.queryByText("Vraag de AI over dit document")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Acties voor Bestuur" }));
    expect(screen.getByRole("menu", { name: "Acties voor Bestuur" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Vraag de AI over deze map" }))
      .toHaveAttribute("href", `/ai?sharepoint_map=${MAP_REF}`);

    await user.click(screen.getByRole("button", { name: "Acties voor Bestuur" }));
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Acties voor Bestuur" })).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Acties voor Beleidsnotitie.docx" }));
    expect(screen.getByRole("menuitem", { name: "Vraag de AI over dit document" }))
      .toHaveAttribute("href", `/ai?sharepoint=${DOC_REF}`);
    expect(screen.getByRole("menuitem", { name: "Bekijken" }))
      .toHaveAttribute("href", `/bibliotheek/sharepoint/${DOC_REF}`);
    expect(screen.getByRole("menuitem", { name: "Openen in Microsoft 365" }))
      .toHaveAttribute("href", "https://voorbeeld.sharepoint.com/sites/lab/Beleidsnotitie.docx");
  });
});
