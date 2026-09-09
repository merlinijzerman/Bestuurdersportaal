// ============================================================================
//  LoginBeleidBeheer (#344 PR-B) — beheerscherm: geen tenant-id, verplicht alleen
//  met groene preflight en bevestiging, afronden als aparte bevestigde actie,
//  uitnodigingslink één keer in client-state met kopieerknop.
// ============================================================================
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LoginBeleidBeheer from "@/app/(dashboard)/beheer/microsoft-login/_components/LoginBeleidBeheer";
import { verwachtGeenErnstigeAxeBevindingen } from "./axe";
import { renderMetProviders } from "./render-met-providers";

const TOKEN = "T".repeat(43);
const U1 = "0f0f0f0f-1111-4222-8333-444444444441";
const U2 = "0f0f0f0f-1111-4222-8333-444444444442";

const beleid = (over: Record<string, unknown> = {}) => ({
  beschikbaar: true,
  modus: "optioneel",
  tenantGeconfigureerd: true,
  preflight: { gereed: false, categorie: "dekking_onvolledig", ongedekteAccounts: 1, breakglassAccounts: 1, breakglassHerzieningVerlopen: 0 },
  magActiveren: false,
  activeringWeigering: "Eén account heeft nog geen actieve Microsoft-koppeling.",
  dekking: [
    { userId: U1, naam: "Ada", rol: "bestuurder", bindingStatus: "active", laatstGebruiktOp: null, breakGlass: false, uitnodigingOpen: false, gedekt: true },
    { userId: U2, naam: "Bob", rol: "beheerder", bindingStatus: null, laatstGebruiktOp: null, breakGlass: true, uitnodigingOpen: false, gedekt: true },
  ],
  breakglass: [{ id: "b1", userId: U2, naam: "Bob", redenCategorie: "beheerherstel", uitgegevenOp: "2026-09-01T00:00:00.000Z", herzienVoor: "2026-12-01T00:00:00.000Z", herzieningVerlopen: false, laatstGebruiktOp: null }],
  ...over,
});

function stubFetch(handlers: Record<string, (init?: RequestInit) => Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const sleutel = `${init?.method ?? "GET"} ${url}`;
    const h = handlers[sleutel];
    if (!h) throw new Error(`Onverwacht verzoek in test: ${sleutel}`);
    return h(init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("LoginBeleidBeheer", () => {
  it("toont beleid zonder tenant-id (alleen 'geconfigureerd'), dekking en noodtoegang; a11y", async () => {
    stubFetch({ "GET /api/microsoft-login/beheer/beleid": json(beleid()) });
    const { container } = renderMetProviders(<LoginBeleidBeheer />);
    expect(await screen.findByText(/Microsoft-tenant: geconfigureerd/)).toBeVisible();
    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(screen.getByRole("radio", { name: /Optioneel/ })).toBeChecked();
    expect(screen.getByText(/Gereed voor "Verplicht": nee/)).toBeVisible();
    expect(screen.getByText("Ada")).toBeVisible();
    expect(screen.getAllByText(/gedekt/)).toHaveLength(2);
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("verplicht: bij rode preflight geen PATCH, maar de weigeringstekst; bij groene preflight pas na bevestiging", async () => {
    const fetchMock = stubFetch({ "GET /api/microsoft-login/beheer/beleid": json(beleid()) });
    const { user } = renderMetProviders(<LoginBeleidBeheer />);
    await user.click(await screen.findByRole("radio", { name: /Verplicht/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Eén account heeft nog geen actieve Microsoft-koppeling.");
    expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "PATCH")).toBe(false);
  });

  it("verplicht met groene preflight: bevestiging → PATCH {modus}", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = stubFetch({
      "GET /api/microsoft-login/beheer/beleid": json(beleid({ magActiveren: true, activeringWeigering: null, preflight: { gereed: true, categorie: null, ongedekteAccounts: 0, breakglassAccounts: 1, breakglassHerzieningVerlopen: 0 } })),
      "PATCH /api/microsoft-login/beheer/beleid": json({ ok: true, modus: "verplicht" }),
    });
    const { user } = renderMetProviders(<LoginBeleidBeheer />);
    await user.click(await screen.findByRole("radio", { name: /Verplicht/ }));
    expect(confirmSpy.mock.calls[0]![0]).toMatch(/Wachtwoordlogin wordt voor alle accounts/);
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "PATCH")).toBe(true));
    const patch = fetchMock.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "PATCH")!;
    expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({ modus: "verplicht" });
  });

  it("intrekken = standaard (zonder afronden); afronden is een aparte actie met bevestigingswoord en waarschuwing over de achterblijvende identiteit", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = stubFetch({
      "GET /api/microsoft-login/beheer/beleid": json(beleid()),
      "POST /api/microsoft-login/beheer/intrekking": json({ ok: true }),
    });
    const { user } = renderMetProviders(<LoginBeleidBeheer />);
    const rijAda = (await screen.findByText("Ada")).closest("tr")!;
    await user.click(within(rijAda).getByRole("button", { name: "Intrekken" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "POST")).toBe(true));
    const eerste = fetchMock.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse((eerste[1] as RequestInit).body as string)).toEqual({ doelUserId: U1 });

    await user.click(within(rijAda).getByRole("button", { name: "Intrekking afronden…" }));
    const dialoog = await screen.findByRole("dialog");
    expect(dialoog).toHaveTextContent(/Microsoft-identiteit blijft in Supabase Auth achter/);
    const knop = screen.getByRole("button", { name: "Definitief afronden" });
    expect(knop).toBeDisabled();
    await user.type(screen.getByLabelText(/Typ/), "AFRONDEN");
    expect(knop).toBeEnabled();
    await user.click(knop);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === "POST")).toHaveLength(2));
    const tweede = fetchMock.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === "POST")[1]!;
    expect(JSON.parse((tweede[1] as RequestInit).body as string)).toEqual({ doelUserId: U1, afronden: true });
  });

  it("uitnodiging: link één keer getoond met kopieerknop, met het token in het fragment; niet in de DOM buiten het veld, niet opgeslagen", async () => {
    const link = `https://pgb.example/koppelen#${TOKEN}`;
    stubFetch({
      "GET /api/microsoft-login/beheer/beleid": json(beleid()),
      "POST /api/microsoft-login/beheer/uitnodiging": json({ ok: true, link, verlooptOp: "2026-09-10T10:00:00.000Z" }),
    });
    const { user } = renderMetProviders(<LoginBeleidBeheer />);
    // user-event installeert bij setup zijn eigen klembordstub; die bespioneren we.
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    await user.click((await screen.findAllByRole("button", { name: "Uitnodiging uitgeven" }))[0]!);
    const veld = await screen.findByLabelText("Uitnodigingslink");
    expect(veld).toHaveValue(link);
    expect(screen.getByText(/één keer getoond/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Kopieer link" }));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(link);
    expect(await screen.findByRole("button", { name: "Gekopieerd" })).toBeVisible();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    await user.click(screen.getByRole("button", { name: "Sluiten" }));
    expect(screen.queryByLabelText("Uitnodigingslink")).not.toBeInTheDocument();
  });
});
