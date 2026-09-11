// ============================================================================
//  MicrosoftLoginKaart (#335 T2) — koppel-/ontkoppelbediening op de profielpagina.
//  De kaart is onzichtbaar zonder fondsflag, toont nooit identiteitsgegevens en
//  biedt per toestand precies één handeling.
// ============================================================================
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MicrosoftLoginKaart from "@/app/(dashboard)/profiel/_components/MicrosoftLoginKaart";
import { PROFIEL_MICROSOFT_LOGIN_MELDINGEN } from "@/core/lib/microsoft-login-meldingen-core";
import { verwachtGeenErnstigeAxeBevindingen } from "./axe";
import { krijgNextNavigationMocks } from "./next-mocks";
import { renderMetProviders } from "./render-met-providers";

const nav = krijgNextNavigationMocks();

function stubFetch(antwoorden: Record<string, () => Response | Promise<Response>>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const methode = init?.method ?? "GET";
    const sleutel = `${methode} ${url}`;
    const maker = antwoorden[sleutel];
    if (!maker) throw new Error(`Onverwacht verzoek in test: ${sleutel}`);
    return maker();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("MicrosoftLoginKaart", () => {
  beforeEach(() => {
    nav.zoekstring = "";
  });

  it("rendert niets als het fonds Microsoft-login niet aan heeft", async () => {
    stubFetch({ "GET /api/microsoft-login/koppeling": json({ beschikbaar: false }) });
    const { container } = renderMetProviders(<MicrosoftLoginKaart />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("zonder koppeling: één knop 'Koppel Microsoft-account' naar de koppel-startroute", async () => {
    stubFetch({ "GET /api/microsoft-login/koppeling": json({ beschikbaar: true, status: "geen" }) });
    const { container } = renderMetProviders(<MicrosoftLoginKaart />);
    const knop = await screen.findByRole("link", { name: "Koppel Microsoft-account" });
    expect(knop).toHaveAttribute("href", "/api/microsoft-login/koppelen/start");
    expect(screen.getByRole("heading", { name: "Inloggen met Microsoft" })).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("gekoppeld via wachtwoordsessie: kaart zegt vooraf dat de sessie blijft; ontkoppelen bevestigt dat (uitgelogd:false)", async () => {
    const fetchMock = stubFetch({
      "GET /api/microsoft-login/koppeling": json({ beschikbaar: true, sessieViaMicrosoft: false, status: "active", geactiveerdOp: "2026-09-07T10:00:00.000Z", laatstGebruiktOp: null }),
      "DELETE /api/microsoft-login/koppeling": json({ ok: true, uitgelogd: false }),
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user, container } = renderMetProviders(<MicrosoftLoginKaart />);
    expect(await screen.findByText("Gekoppeld")).toBeVisible();
    expect(screen.getByText(/U bent nu met uw wachtwoord ingelogd\. Ontkoppelen laat deze sessie ongemoeid\./)).toBeVisible();
    expect(container.textContent).not.toMatch(/@|tid|oid|sub/i);
    await user.click(screen.getByRole("button", { name: "Ontkoppelen" }));
    expect(confirmSpy.mock.calls[0]![0]).toMatch(/U blijft ingelogd met uw wachtwoord/);
    expect(await screen.findByRole("status")).toHaveTextContent("Microsoft-login is ontkoppeld. U blijft ingelogd met uw wachtwoord.");
    expect(fetchMock).toHaveBeenCalledWith("/api/microsoft-login/koppeling", { method: "DELETE" });
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("gekoppeld via Microsoft-sessie: kaart waarschuwt vooraf; ontkoppelen (uitgelogd:true) stuurt met één navigatie naar /login", async () => {
    stubFetch({
      "GET /api/microsoft-login/koppeling": json({ beschikbaar: true, sessieViaMicrosoft: true, status: "active", geactiveerdOp: null, laatstGebruiktOp: null }),
      "DELETE /api/microsoft-login/koppeling": json({ ok: true, uitgelogd: true }),
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const replace = vi.fn();
    const origineleLocation = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...origineleLocation, replace } });
    try {
      const { user } = renderMetProviders(<MicrosoftLoginKaart />);
      expect(await screen.findByText(/U bent nu met Microsoft ingelogd\. Ontkoppelen logt u direct uit\./)).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Ontkoppelen" }));
      expect(confirmSpy.mock.calls[0]![0]).toMatch(/wordt direct uitgelogd/);
      await waitFor(() => expect(replace).toHaveBeenCalledExactlyOnceWith("/login"));
      expect(screen.queryByText(/U blijft ingelogd met uw wachtwoord/)).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: origineleLocation });
    }
  });

  it("ontkoppelen geannuleerd → geen verzoek", async () => {
    const fetchMock = stubFetch({
      "GET /api/microsoft-login/koppeling": json({ beschikbaar: true, status: "active", geactiveerdOp: null, laatstGebruiktOp: null }),
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { user } = renderMetProviders(<MicrosoftLoginKaart />);
    await user.click(await screen.findByRole("button", { name: "Ontkoppelen" }));
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE")).toHaveLength(0);
  });

  it("revoking: 'Opnieuw proberen'; mislukte unlink toont de neutrale ontkoppelmelding", async () => {
    stubFetch({
      "GET /api/microsoft-login/koppeling": json({ beschikbaar: true, status: "revoking" }),
      "DELETE /api/microsoft-login/koppeling": json({ error: PROFIEL_MICROSOFT_LOGIN_MELDINGEN.ontkoppelen }, 409),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = renderMetProviders(<MicrosoftLoginKaart />);
    await user.click(await screen.findByRole("button", { name: "Opnieuw proberen" }));
    expect(await screen.findByRole("status")).toHaveTextContent(PROFIEL_MICROSOFT_LOGIN_MELDINGEN.ontkoppelen);
  });

  it("pending met identiteit: 'Koppeling herstellen' roept de herstelroute aan", async () => {
    const fetchMock = stubFetch({
      "GET /api/microsoft-login/koppeling": json({ beschikbaar: true, status: "pending", herstelMogelijk: true, pendingVerlooptOp: null }),
      "POST /api/microsoft-login/koppeling": json({ hersteld: true }),
    });
    const { user } = renderMetProviders(<MicrosoftLoginKaart />);
    await user.click(await screen.findByRole("button", { name: "Koppeling herstellen" }));
    expect(await screen.findByRole("status")).toHaveTextContent("De koppeling is hersteld.");
    expect(fetchMock).toHaveBeenCalledWith("/api/microsoft-login/koppeling", { method: "POST" });
  });

  it("pending zonder identiteit: alleen uitleg, geen handeling", async () => {
    stubFetch({ "GET /api/microsoft-login/koppeling": json({ beschikbaar: true, status: "pending", herstelMogelijk: false, pendingVerlooptOp: null }) });
    renderMetProviders(<MicrosoftLoginKaart />);
    expect(await screen.findByText(/Koppelen is nog niet afgerond/)).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("URL-uitkomst: ?microsoft_login=fout&c=koppelen&sc=… toont de neutrale koppelmelding met supportcode", async () => {
    nav.zoekstring = "microsoft_login=fout&c=koppelen&sc=0F0F0F0F";
    stubFetch({ "GET /api/microsoft-login/koppeling": json({ beschikbaar: true, status: "geen" }) });
    renderMetProviders(<MicrosoftLoginKaart />);
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(PROFIEL_MICROSOFT_LOGIN_MELDINGEN.koppelen);
    expect(status).toHaveTextContent("Supportcode: 0F0F0F0F");
  });

  it("URL-uitkomst: onbekende code valt terug op de koppelmelding; 'gekoppeld' toont bevestiging", async () => {
    nav.zoekstring = "microsoft_login=fout&c=iets-anders";
    stubFetch({ "GET /api/microsoft-login/koppeling": json({ beschikbaar: true, status: "geen" }) });
    const { unmount } = renderMetProviders(<MicrosoftLoginKaart />);
    expect(await screen.findByRole("status")).toHaveTextContent(PROFIEL_MICROSOFT_LOGIN_MELDINGEN.koppelen);
    unmount();
    nav.zoekstring = "microsoft_login=gekoppeld";
    stubFetch({ "GET /api/microsoft-login/koppeling": json({ beschikbaar: true, status: "active", geactiveerdOp: null, laatstGebruiktOp: null }) });
    renderMetProviders(<MicrosoftLoginKaart />);
    expect(await screen.findByRole("status")).toHaveTextContent("Microsoft-login is gekoppeld aan uw account.");
  });

  // ── #344 · modus `verplicht`: de organisatie beheert de koppeling ─────────
  // Uit de Preview-smoke (scenario 5): de kaart toonde de knop nog, terwijl de
  // server hem terecht weigerde. Een knop die tóch wordt geweigerd is precies wat
  // het UX-principe "maak blokkers vooraf expliciet" verbiedt.
  it("verplicht: geen ontkoppelknop, wél uitleg dat de organisatie de koppeling beheert", async () => {
    stubFetch({
      "GET /api/microsoft-login/koppeling": json({
        beschikbaar: true, sessieViaMicrosoft: false, status: "active",
        modus: "verplicht", stand: "alleen-status", magKoppelen: false, magOntkoppelen: false,
        geactiveerdOp: "2026-09-07T10:00:00.000Z", laatstGebruiktOp: null,
      }),
    });
    const { container } = renderMetProviders(<MicrosoftLoginKaart />);
    expect(await screen.findByText("Gekoppeld")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Ontkoppelen" })).toBeNull();
    expect(screen.getByText(PROFIEL_MICROSOFT_LOGIN_MELDINGEN.beheer)).toBeVisible();
    expect(container.textContent).not.toMatch(/@|tid|oid|sub/i);
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("verplicht + revoking: ook 'Opnieuw proberen' verdwijnt", async () => {
    stubFetch({
      "GET /api/microsoft-login/koppeling": json({
        beschikbaar: true, status: "revoking", modus: "verplicht", stand: "alleen-status",
        magKoppelen: false, magOntkoppelen: false,
      }),
    });
    renderMetProviders(<MicrosoftLoginKaart />);
    expect(await screen.findByText(/Ontkoppelen is nog niet afgerond/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Opnieuw proberen" })).toBeNull();
    expect(screen.getByText(PROFIEL_MICROSOFT_LOGIN_MELDINGEN.beheer)).toBeVisible();
  });

  it("weigering door de server: de kaart toont de reden van de server, niet haar eigen generieke tekst", async () => {
    // Vangnet voor het geval de kaart tóch een knop toont (bijvoorbeeld door een
    // oudere respons zonder magOntkoppelen): de melding moet dan alsnog kloppen.
    stubFetch({
      "GET /api/microsoft-login/koppeling": json({ beschikbaar: true, sessieViaMicrosoft: false, status: "active", geactiveerdOp: null, laatstGebruiktOp: null }),
      "DELETE /api/microsoft-login/koppeling": json({ error: PROFIEL_MICROSOFT_LOGIN_MELDINGEN.beheer }, 403),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = renderMetProviders(<MicrosoftLoginKaart />);
    expect(await screen.findByText("Gekoppeld")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Ontkoppelen" }));
    expect(await screen.findByRole("status")).toHaveTextContent(PROFIEL_MICROSOFT_LOGIN_MELDINGEN.beheer);
  });
});
