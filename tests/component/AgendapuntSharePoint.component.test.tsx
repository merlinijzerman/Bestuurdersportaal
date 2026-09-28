import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AgendapuntBronPicker from "@/app/(dashboard)/vergaderingen/_components/AgendapuntBronPicker";
import AgendapuntSharePointBronnen from "@/app/(dashboard)/vergaderingen/_components/AgendapuntSharePointBronnen";
import { projecteerSharePointAgendakoppelingen } from "@/core/lib/microsoft-sharepoint-agendapunt-projectie";
import { renderMetProviders } from "./render-met-providers";

const AGENDAPUNT = "11111111-1111-4111-8111-111111111111";
const DOC_REF = "22222222-2222-4222-8222-222222222222";
const MAP_REF = "33333333-3333-4333-8333-333333333333";

function pickerFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/documents/upload")) {
      return new Response(JSON.stringify({ documenten: [{
        id: "44444444-4444-4444-8444-444444444444",
        titel: "Portaalstuk",
        bron: "Bestuursbureau",
        bibliotheek: "fonds",
        bestandstype: "pdf",
      }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      beschikbaar: true,
      documenten: [{ ref: DOC_REF, naam: "Beleid.docx", mappad: "Bestuur", bestandstype: "docx" }],
      mapRefs: [{ ref: MAP_REF, naam: "Vergaderstukken", mappad: "Vergaderstukken" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

describe("AgendapuntBronPicker", () => {
  it("biedt de bronkeuze Portaalbibliotheek en SharePoint", async () => {
    vi.stubGlobal("fetch", pickerFetch());
    const onPortaal = vi.fn();
    const onSharePoint = vi.fn(async () => true);
    const { user } = renderMetProviders(
      <AgendapuntBronPicker onSelectPortaal={onPortaal} onSelectSharePoint={onSharePoint} onClose={vi.fn()} />
    );

    expect(await screen.findByRole("tab", { name: "Portaalbibliotheek" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "SharePoint" })).toBeVisible();
    expect(await screen.findByText("Portaalstuk")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "SharePoint" }));
    expect(await screen.findByText("Beleid.docx")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Selecteer Vergaderstukken" })).toBeVisible();
  });

  it("koppelt meerdere SharePoint-documenten en -mappen in één handeling", async () => {
    vi.stubGlobal("fetch", pickerFetch());
    const onSharePoint = vi.fn(async () => true);
    const { user } = renderMetProviders(
      <AgendapuntBronPicker onSelectPortaal={vi.fn()} onSelectSharePoint={onSharePoint} onClose={vi.fn()} />
    );
    await user.click(screen.getByRole("tab", { name: "SharePoint" }));
    await user.click(await screen.findByRole("checkbox", { name: "Selecteer Beleid.docx" }));
    await user.click(screen.getByRole("checkbox", { name: "Selecteer Vergaderstukken" }));
    await user.click(screen.getByRole("button", { name: "Koppel selectie" }));
    await waitFor(() => expect(onSharePoint).toHaveBeenCalledOnce());
    expect(onSharePoint).toHaveBeenCalledWith(expect.arrayContaining([
      { soort: "document", ref: DOC_REF },
      { soort: "map", ref: MAP_REF },
    ]));
  });
});

describe("AgendapuntSharePointBronnen — B-6", () => {
  it("toont na live validatie badge, metadata en acties", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      beschikbaar: true,
      koppelingen: [{
        koppelingId: "55555555-5555-4555-8555-555555555555",
        agendapuntId: AGENDAPUNT,
        toegankelijk: true,
        soort: "document",
        naam: "Openbaar beleid.docx",
        mappad: "Bestuur/Beleid",
        bestandstype: "docx",
        previewHref: `/bibliotheek/sharepoint/${DOC_REF}`,
        microsoft365Url: "https://voorbeeld.sharepoint.com/beleid.docx",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const { user } = renderMetProviders(<AgendapuntSharePointBronnen agendapuntId={AGENDAPUNT} magBeheren vernieuwSignaal={0} />);
    expect(await screen.findByText("Openbaar beleid.docx")).toBeVisible();
    expect(screen.getByText("SharePoint")).toBeVisible();
    await user.click(screen.getByLabelText("Acties"));
    expect(screen.getByRole("link", { name: "Bekijken" })).toHaveAttribute("href", `/bibliotheek/sharepoint/${DOC_REF}`);
    expect(screen.getByRole("link", { name: "Openen in Microsoft 365" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Ontkoppelen" })).toBeVisible();
  });

  it("ontkoppelt via de uniforme agendapunt-route en ververst de kaart", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    let verwijderd = false;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        verwijderd = true;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        beschikbaar: true,
        koppelingen: verwijderd ? [] : [{
          koppelingId: "55555555-5555-4555-8555-555555555555",
          agendapuntId: AGENDAPUNT,
          toegankelijk: true,
          soort: "document",
          naam: "Beleid.docx",
          mappad: "Bestuur",
          bestandstype: "docx",
          previewHref: `/bibliotheek/sharepoint/${DOC_REF}`,
          microsoft365Url: null,
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { user } = renderMetProviders(
      <AgendapuntSharePointBronnen agendapuntId={AGENDAPUNT} magBeheren vernieuwSignaal={0} />
    );

    expect(await screen.findByText("Beleid.docx")).toBeVisible();
    await user.click(screen.getByLabelText("Acties"));
    await user.click(screen.getByRole("button", { name: "Ontkoppelen" }));
    await waitFor(() => expect(screen.queryByText("Beleid.docx")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/agendapunten/${AGENDAPUNT}/sharepoint`,
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it.each([
    "geen token",
    "geen toegang",
    "timeout",
    "Microsoft-fout",
  ])("lekt bij %s geen naam, pad, type of link", async () => {
    const privateRegisterRij = {
      koppeling_id: "55555555-5555-4555-8555-555555555555",
      agendapunt_id: AGENDAPUNT,
      soort: "document" as const,
      ref: DOC_REF,
      // Dit representeert private registermetadata die bij elk van de vier
      // foutsoorten uit zowel de response als de DOM moet blijven.
      naam: "Geheim dossier.docx",
      mappad: "Bestuur/Vertrouwelijk",
      bestandstype: "docx",
    };
    const responseProjectie = projecteerSharePointAgendakoppelingen([privateRegisterRij]);
    const responseJson = JSON.stringify(responseProjectie);
    expect(responseJson).not.toContain("Geheim dossier.docx");
    expect(responseJson).not.toContain("Bestuur/Vertrouwelijk");
    expect(responseJson).not.toContain(DOC_REF);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      beschikbaar: true,
      koppelingen: responseProjectie,
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    renderMetProviders(<AgendapuntSharePointBronnen agendapuntId={AGENDAPUNT} magBeheren={false} vernieuwSignaal={0} />);
    expect(await screen.findByText("Gekoppelde SharePoint-bron")).toBeVisible();
    expect(screen.queryByText("Geheim dossier.docx")).not.toBeInTheDocument();
    expect(screen.queryByText(/Bestuur\/Vertrouwelijk/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
