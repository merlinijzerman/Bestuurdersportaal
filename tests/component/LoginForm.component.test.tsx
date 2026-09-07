// ============================================================================
//  LoginForm (#335 T2) — het wachtwoordpad is byte-voor-byte de oude /login-pagina
//  (karakterisering vóór wijziging, nu als invariant), plus de Microsoft-knop die
//  ALLEEN bestaat als de server-pagina dat zegt, en de ene neutrale melding (V11).
// ============================================================================
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginForm from "@/app/login/_components/LoginForm";
import { LOGIN_MICROSOFT_MELDING, VERBODEN_MELDINGWOORDEN } from "@/core/lib/microsoft-login-meldingen-core";
import { verwachtGeenErnstigeAxeBevindingen } from "./axe";
import { renderMetProviders } from "./render-met-providers";

const signInWithPassword = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());

vi.mock("@/core/lib/supabase", () => ({
  createClient: () => ({ auth: { signInWithPassword, signOut } }),
}));

/** Golden: de exacte, generieke foutmelding van de wachtwoordlogin (ongewijzigd). */
const LOGIN_FOUTMELDING = "Inloggen mislukt. Controleer uw e-mailadres en wachtwoord.";

const zonderMelding = { microsoftLogin: false, melding: null, supportcode: null } as const;

describe("LoginForm — wachtwoordpad (INVARIANT, ongewijzigd t.o.v. vóór T2)", () => {
  const origineleLocation = window.location;
  let replace: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    replace = vi.fn();
    signOut.mockResolvedValue({ error: null });
    Object.defineProperty(window, "location", { configurable: true, value: { ...origineleLocation, replace } });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: origineleLocation });
  });

  async function vulInEnVerzend(user: ReturnType<typeof renderMetProviders>["user"]) {
    await user.type(screen.getByLabelText("E-mailadres"), "lid@fonds.invalid");
    await user.type(screen.getByLabelText("Wachtwoord"), "geheim-wachtwoord");
    await user.click(screen.getByRole("button", { name: "Inloggen" }));
  }

  it("zonder Microsoft-login: precies één inlogmethode, geen knop, geen link, geen verborgen element", async () => {
    const { container } = renderMetProviders(<LoginForm {...zonderMelding} />);
    expect(screen.getByRole("heading", { level: 1, name: "Bestuurdersportaal" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Log in op uw bestuurdersomgeving" })).toBeVisible();
    expect(screen.getByLabelText("E-mailadres")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Wachtwoord")).toHaveAttribute("type", "password");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("link", { name: /Microsoft/i })).not.toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/microsoft/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("geeft bij een mislukte login de generieke melding en lekt de Supabase-fout niet", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    const { user, container } = renderMetProviders(<LoginForm {...zonderMelding} />);
    await vulInEnVerzend(user);
    expect(await screen.findByText(LOGIN_FOUTMELDING)).toBeVisible();
    expect(screen.queryByText(/Invalid login credentials/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inloggen" })).toBeEnabled();
    expect(replace).not.toHaveBeenCalled();
    expect(signInWithPassword).toHaveBeenCalledExactlyOnceWith({ email: "lid@fonds.invalid", password: "geheim-wachtwoord" });
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("navigeert na een geslaagde login met één volledige navigatie naar '/'", async () => {
    let rondAf!: (v: { error: null }) => void;
    signInWithPassword.mockReturnValue(new Promise<{ error: null }>((r) => (rondAf = r)));
    const { user } = renderMetProviders(<LoginForm {...zonderMelding} />);
    await vulInEnVerzend(user);
    expect(screen.getByRole("button", { name: "Inloggen..." })).toBeDisabled();
    rondAf({ error: null });
    await waitFor(() => expect(replace).toHaveBeenCalledExactlyOnceWith("/"));
  });
});

describe("LoginForm — Microsoft-knop en neutrale melding (T2)", () => {
  beforeEach(() => {
    signOut.mockResolvedValue({ error: null });
  });

  it("met Microsoft-login: één extra link 'Inloggen met Microsoft' naar de startroute; het wachtwoordformulier blijft", async () => {
    const { container } = renderMetProviders(<LoginForm microsoftLogin melding={null} supportcode={null} />);
    const knop = screen.getByRole("link", { name: "Inloggen met Microsoft" });
    expect(knop).toHaveAttribute("href", "/auth/microsoft-login/start");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Inloggen" })).toBeEnabled();
    // Geen next-, login_hint- of domain_hint-parameter in de link (geen accountinformatie in de URL).
    expect(knop.getAttribute("href")).not.toMatch(/[?&]/);
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("toont de ene neutrale melding met supportcode en ruimt een oauth-restant client-side op", async () => {
    const { container } = renderMetProviders(<LoginForm microsoftLogin melding={LOGIN_MICROSOFT_MELDING} supportcode="0F0F0F0F" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(LOGIN_MICROSOFT_MELDING);
    expect(alert).toHaveTextContent("Supportcode: 0F0F0F0F");
    for (const woord of VERBODEN_MELDINGWOORDEN) {
      expect(alert.textContent!.toLowerCase()).not.toContain(woord.toLowerCase());
    }
    await waitFor(() => expect(signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" }));
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("dezelfde melding zonder supportcode toont geen supportcoderegel", () => {
    renderMetProviders(<LoginForm microsoftLogin={false} melding={LOGIN_MICROSOFT_MELDING} supportcode={null} />);
    expect(screen.getByRole("alert")).not.toHaveTextContent(/Supportcode/);
  });
});
