// ============================================================================
//  KoppelActivering (#344 PR-B) — het herkoppeltoken: uit het fragment gelezen,
//  direct uit de adresbalk gewist, nooit gerenderd, uitsluitend in een POST-body.
// ============================================================================
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import KoppelActivering from "@/app/(herstel)/koppelen/_components/KoppelActivering";
import { UITNODIGING_ONGELDIG_MELDING } from "@/core/lib/microsoft-login-meldingen-core";
import { verwachtGeenErnstigeAxeBevindingen } from "./axe";
import { renderMetProviders } from "./render-met-providers";

const TOKEN = "T".repeat(43);

describe("KoppelActivering", () => {
  const origineleLocation = window.location;
  let replaceState: ReturnType<typeof vi.fn>;

  function metHash(hash: string) {
    Object.defineProperty(window, "location", { configurable: true, value: { ...origineleLocation, hash, pathname: "/koppelen", search: "" } });
  }

  beforeEach(() => {
    replaceState = vi.fn();
    vi.spyOn(window.history, "replaceState").mockImplementation(replaceState as typeof window.history.replaceState);
  });
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: origineleLocation });
  });

  it("zonder fragment: uitleg, geen knop, geen verzoek", async () => {
    metHash("");
    const { container } = renderMetProviders(<KoppelActivering />);
    expect(await screen.findByRole("status")).toHaveTextContent(/alleen via een uitnodigingslink/);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("met fragment: wist het fragment direct, rendert het token niet, en verbruikt niets zonder klik", async () => {
    metHash(`#${TOKEN}`);
    const { container } = renderMetProviders(<KoppelActivering />);
    expect(await screen.findByRole("button", { name: "Herstel starten" })).toBeEnabled();
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/koppelen");
    expect(container.innerHTML).not.toContain(TOKEN);
    expect(fetch).not.toHaveBeenCalled();
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("klik: POST met het token uitsluitend in de JSON-body, no-referrer; daarna naar de login", async () => {
    metHash(`#${TOKEN}`);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, vensterTot: "2026-09-09T10:15:00.000Z" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { user, container } = renderMetProviders(<KoppelActivering />);
    await user.click(await screen.findByRole("button", { name: "Herstel starten" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("/auth/microsoft-login/uitnodiging");
    expect(init.method).toBe("POST");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(JSON.parse(init.body as string)).toEqual({ token: TOKEN });
    expect(url).not.toContain(TOKEN);
    expect(await screen.findByRole("link", { name: "Naar inloggen" })).toHaveAttribute("href", "/login");
    expect(container.innerHTML).not.toContain(TOKEN);
  });

  it("weigering: één neutrale melding, token uit het geheugen (geen tweede poging mogelijk)", async () => {
    metHash(`#${TOKEN}`);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: UITNODIGING_ONGELDIG_MELDING }), { status: 403, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { user, container } = renderMetProviders(<KoppelActivering />);
    await user.click(await screen.findByRole("button", { name: "Herstel starten" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(UITNODIGING_ONGELDIG_MELDING);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain(TOKEN);
  });
});
