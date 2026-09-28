// ============================================================================
//  ZoekenPaneel (#463 fase A) — bronfilter Alles / Portaal / SharePoint, met
//  gescheiden laad-, leeg-, fout- en afgekapt-statussen. Een SharePoint-fout
//  mag de portaalresultaten niet laten verdwijnen.
// ============================================================================
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ZoekenPaneel from "@/app/(dashboard)/bibliotheek/_components/ZoekenPaneel";
import { verwachtGeenErnstigeAxeBevindingen } from "./axe";
import { renderMetProviders } from "./render-met-providers";

const REF = "11111111-2222-4333-8444-555555555555";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const PORTAAL = {
  resultaten: [{
    document_id: "d1", titel: "Portaalnotitie premie", bron: "Fonds", bibliotheek: "fonds", procesinstantie_id: null,
    documentstatus: null, bronstatus: null, documentdatum: null, geldig_tot: null, bronorganisatie: null,
    normgewicht: null, extern_url: null, heeft_origineel: false, treffers: [{ pagina: null, paragraaf: null, fragment: "premie" }],
  }],
  procesinstanties: [],
  meta: { methode: "tekst", opgehaald: 3, geselecteerd: 1, modus: "alles" },
};

const SHAREPOINT = {
  beschikbaar: true,
  bron: { weergavenaam: "PGB", map: "Vergaderstukken" },
  resultaten: [{ ref: REF, naam: "Notulen 12-09.pdf", bestandstype: "pdf", extensie: "pdf", grootte: 10, gewijzigdOp: "2026-09-12T10:00:00.000Z", mappad: "2026/09 September", previewMogelijk: true, webUrl: "https://pgb.sharepoint.com/sites/x/Notulen.pdf" }],
  totaal: 1, boomAfgekapt: false, resultatenAfgekapt: false,
};

type Router = { status?: () => Response; zoeken?: () => Response; sharepoint?: () => Response };

function stubFetch(r: Router) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "/api/microsoft/sharepoint/status") return r.status ? r.status() : json({ beschikbaar: false });
    if (url.startsWith("/api/zoeken?")) return r.zoeken ? r.zoeken() : json(PORTAAL);
    if (url.startsWith("/api/microsoft/sharepoint/zoeken?")) return r.sharepoint ? r.sharepoint() : json(SHAREPOINT);
    throw new Error(`Onverwacht netwerkverzoek: ${url}`);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}
const urls = (mock: ReturnType<typeof stubFetch>) => mock.mock.calls.map((c) => String(c[0]));
const statusMetBron = () => json({ beschikbaar: true, bron: { weergavenaam: "PGB" }, toestemmingVereist: false });

async function zoek(user: ReturnType<typeof renderMetProviders>["user"], term: string) {
  await user.type(screen.getByPlaceholderText(/Zoek op een woord of zin/), term);
  await user.click(screen.getByRole("button", { name: "Zoeken" }));
}

describe("ZoekenPaneel — SharePoint als zoekbron (#463)", () => {
  it("zonder actieve SharePoint-bron: geen bronfilter en uitsluitend /api/zoeken", async () => {
    const mock = stubFetch({ status: () => json({ beschikbaar: false }) });
    const { user } = renderMetProviders(<ZoekenPaneel vasteBronsoort="fonds" metSharePoint />);
    await waitFor(() => expect(urls(mock)).toContain("/api/microsoft/sharepoint/status"));
    expect(screen.queryByRole("group", { name: "Zoekbron" })).not.toBeInTheDocument();
    await zoek(user, "premie");
    expect(await screen.findByText("Portaalnotitie premie")).toBeInTheDocument();
    expect(urls(mock).some((u) => u.startsWith("/api/microsoft/sharepoint/zoeken"))).toBe(false);
  });

  it("op de sectortab (metSharePoint uit) wordt de SharePoint-status niet eens opgevraagd", async () => {
    const mock = stubFetch({});
    const { user } = renderMetProviders(<ZoekenPaneel vasteBronsoort="generiek" />);
    await zoek(user, "premie");
    await screen.findByText("Portaalnotitie premie");
    expect(urls(mock).every((u) => u.startsWith("/api/zoeken?"))).toBe(true);
  });

  it("Alles: beide bronnen, met bronlabel, type, mappad en veilige open-links", async () => {
    const mock = stubFetch({ status: statusMetBron });
    const { user, container } = renderMetProviders(<ZoekenPaneel vasteBronsoort="fonds" metSharePoint />);
    await screen.findByRole("group", { name: "Zoekbron" });
    await zoek(user, "notulen");
    const sp = await screen.findByRole("region", { name: "SharePoint-resultaten" });
    expect(await within(sp).findByText("Notulen 12-09.pdf")).toHaveAttribute("href", `/bibliotheek/sharepoint/${REF}`);
    expect(within(sp).getAllByText("SharePoint").length).toBeGreaterThan(0);
    expect(within(sp).getByText("PDF")).toBeInTheDocument();
    expect(within(sp).getByText(/2026\/09 September/)).toBeInTheDocument();
    expect(within(sp).getByRole("link", { name: "Openen in Microsoft 365" })).toHaveAttribute("href", "https://pgb.sharepoint.com/sites/x/Notulen.pdf");
    expect(screen.getByRole("region", { name: "Portaalresultaten" })).toHaveTextContent("Portaalnotitie premie");
    expect(urls(mock)).toEqual(expect.arrayContaining([expect.stringMatching(/^\/api\/zoeken\?/), "/api/microsoft/sharepoint/zoeken?q=notulen"]));
    // De portaalretrieval krijgt nog steeds de fonds/generiek-bronsoort, niet de zoekbron.
    expect(urls(mock).find((u) => u.startsWith("/api/zoeken?"))).toContain("bronsoort=fonds");
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("SharePoint: alleen de SharePoint-route; portaalfilters verdwijnen", async () => {
    const mock = stubFetch({ status: statusMetBron });
    const { user } = renderMetProviders(<ZoekenPaneel vasteBronsoort="fonds" metSharePoint />);
    await user.click(await screen.findByRole("button", { name: "SharePoint" }));
    await zoek(user, "notulen");
    await screen.findByText("Notulen 12-09.pdf");
    expect(screen.queryByRole("region", { name: "Portaalresultaten" })).not.toBeInTheDocument();
    expect(screen.queryByText("Tijdsperiode")).not.toBeInTheDocument();
    expect(urls(mock).some((u) => u.startsWith("/api/zoeken?"))).toBe(false);
  });

  it("Portaal: geen SharePoint-verzoek en geen SharePoint-blok", async () => {
    const mock = stubFetch({ status: statusMetBron });
    const { user } = renderMetProviders(<ZoekenPaneel vasteBronsoort="fonds" metSharePoint />);
    await user.click(await screen.findByRole("button", { name: "Portaal" }));
    await zoek(user, "notulen");
    await screen.findByText("Portaalnotitie premie");
    expect(screen.queryByRole("region", { name: "SharePoint-resultaten" })).not.toBeInTheDocument();
    expect(urls(mock).some((u) => u.startsWith("/api/microsoft/sharepoint/zoeken"))).toBe(false);
  });

  it("SharePoint-timeout: begrijpelijke gedeeltelijke-foutmelding, portaalresultaten blijven staan", async () => {
    stubFetch({ status: statusMetBron, sharepoint: () => json({ beschikbaar: true, error: "SharePoint reageerde niet op tijd. Probeer het opnieuw.", foutcategorie: "graph_timeout" }, 504) });
    const { user } = renderMetProviders(<ZoekenPaneel vasteBronsoort="fonds" metSharePoint />);
    await screen.findByRole("group", { name: "Zoekbron" });
    await zoek(user, "premie");
    const sp = await screen.findByRole("region", { name: "SharePoint-resultaten" });
    expect(await within(sp).findByText(/reageerde niet op tijd.*portaalresultaten blijven gewoon zichtbaar/)).toBeInTheDocument();
    expect(screen.getByText("Portaalnotitie premie")).toBeInTheDocument();
  });

  it("portaalfout laat SharePoint-resultaten staan", async () => {
    stubFetch({ status: statusMetBron, zoeken: () => json({ error: "Zoeken is niet gelukt." }, 500) });
    const { user } = renderMetProviders(<ZoekenPaneel vasteBronsoort="fonds" metSharePoint />);
    await screen.findByRole("group", { name: "Zoekbron" });
    await zoek(user, "notulen");
    expect(await screen.findByText("Zoeken is niet gelukt.")).toBeInTheDocument();
    expect(await screen.findByText("Notulen 12-09.pdf")).toBeInTheDocument();
  });

  it("leeg en afgekapt zijn aparte statussen", async () => {
    stubFetch({ status: statusMetBron, sharepoint: () => json({ ...SHAREPOINT, resultaten: [], totaal: 0 }) });
    const eerste = renderMetProviders(<ZoekenPaneel vasteBronsoort="fonds" metSharePoint />);
    await eerste.user.click(await screen.findByRole("button", { name: "SharePoint" }));
    await zoek(eerste.user, "bestaatniet");
    expect(await screen.findByText("Geen SharePoint-documenten gevonden voor deze zoekterm.")).toBeInTheDocument();
    eerste.unmount();

    stubFetch({ status: statusMetBron, sharepoint: () => json({ ...SHAREPOINT, totaal: 140, boomAfgekapt: true, resultatenAfgekapt: true }) });
    const tweede = renderMetProviders(<ZoekenPaneel vasteBronsoort="fonds" metSharePoint />);
    await tweede.user.click(await screen.findByRole("button", { name: "SharePoint" }));
    await zoek(tweede.user, "notulen");
    expect(await screen.findByText(/140 documenten gevonden.*de eerste 1 worden getoond/)).toBeInTheDocument();
    expect(screen.getByText(/groter dan het maximum dat in één keer kan worden doorzocht/)).toBeInTheDocument();
  });

  it("een portaalfilter wijzigen in Alles wist de SharePoint-resultaten niet en vraagt SharePoint niet opnieuw", async () => {
    const mock = stubFetch({ status: statusMetBron });
    const { user } = renderMetProviders(<ZoekenPaneel vasteBronsoort="fonds" metSharePoint />);
    await screen.findByRole("group", { name: "Zoekbron" });
    await zoek(user, "notulen");
    await screen.findByText("Notulen 12-09.pdf");
    const voor = urls(mock).filter((u) => u.startsWith("/api/microsoft/sharepoint/zoeken")).length;
    await user.click(screen.getByRole("button", { name: "Actueel" }));
    await waitFor(() => expect(urls(mock).filter((u) => u.startsWith("/api/zoeken?")).length).toBe(2));
    expect(screen.getByText("Notulen 12-09.pdf")).toBeInTheDocument();
    expect(urls(mock).filter((u) => u.startsWith("/api/microsoft/sharepoint/zoeken")).length).toBe(voor);
  });
});
