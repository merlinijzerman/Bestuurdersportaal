// ============================================================================
//  Karakterisering vóór wijziging — #335 T2-voorbereiding (wachtwoordlogin-UI).
// ----------------------------------------------------------------------------
//  Pint het huidige gedrag van app/login/page.tsx zodat T2 (Microsoft-knop,
//  neutrale foutmeldingen) een bewuste, zichtbare wijziging is en geen stille.
//  Er is op deze branch precies ÉÉN inlogmethode (e-mail + wachtwoord); die
//  invariant is hieronder expliciet vastgelegd en mag in T2 alleen samen met
//  deze test wijzigen.
// ============================================================================
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/login/page";
import { verwachtGeenErnstigeAxeBevindingen } from "./axe";
import { renderMetProviders } from "./render-met-providers";

const signInWithPassword = vi.hoisted(() => vi.fn());

vi.mock("@/core/lib/supabase", () => ({
  createClient: () => ({ auth: { signInWithPassword } }),
}));

/** Golden: de exacte, generieke foutmelding van de wachtwoordlogin (geen accountinformatie). */
export const LOGIN_FOUTMELDING = "Inloggen mislukt. Controleer uw e-mailadres en wachtwoord.";

describe("LoginPage (karakterisering vóór #335 T2)", () => {
  const origineleLocation = window.location;
  let replace: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    replace = vi.fn();
    // jsdom's `location` is niet herdefinieerbaar via stubGlobal; vervang het
    // object op `window` zodat `window.location.replace("/")` observeerbaar is.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...origineleLocation, replace },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: origineleLocation });
  });

  async function vulInEnVerzend(user: ReturnType<typeof renderMetProviders>["user"]) {
    await user.type(screen.getByLabelText("E-mailadres"), "lid@fonds.invalid");
    await user.type(screen.getByLabelText("Wachtwoord"), "geheim-wachtwoord");
    await user.click(screen.getByRole("button", { name: "Inloggen" }));
  }

  it("toont één inlogmethode: e-mail + wachtwoord, zonder externe identiteitsknop", async () => {
    const { container } = renderMetProviders(<LoginPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Bestuurdersportaal" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Log in op uw bestuurdersomgeving" })).toBeVisible();
    expect(screen.getByLabelText("E-mailadres")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Wachtwoord")).toHaveAttribute("type", "password");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Inloggen" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Microsoft/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Microsoft/i })).not.toBeInTheDocument();
    expect(screen.queryByText(LOGIN_FOUTMELDING)).not.toBeInTheDocument();
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("geeft bij een mislukte login de generieke melding en laat opnieuw proberen", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    const { user, container } = renderMetProviders(<LoginPage />);

    await vulInEnVerzend(user);

    expect(await screen.findByText(LOGIN_FOUTMELDING)).toBeVisible();
    // De ruwe Supabase-melding lekt niet naar de gebruiker.
    expect(screen.queryByText(/Invalid login credentials/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inloggen" })).toBeEnabled();
    expect(replace).not.toHaveBeenCalled();
    expect(signInWithPassword).toHaveBeenCalledExactlyOnceWith({
      email: "lid@fonds.invalid",
      password: "geheim-wachtwoord",
    });
    await verwachtGeenErnstigeAxeBevindingen(container);
  });

  it("navigeert na een geslaagde login met één volledige navigatie naar '/'", async () => {
    let rondAf!: (v: { error: null }) => void;
    signInWithPassword.mockReturnValue(new Promise<{ error: null }>((r) => (rondAf = r)));
    const { user } = renderMetProviders(<LoginPage />);

    await vulInEnVerzend(user);

    // Tijdens het wachten: knop uitgeschakeld met laadtekst.
    expect(screen.getByRole("button", { name: "Inloggen..." })).toBeDisabled();

    rondAf({ error: null });
    await waitFor(() => expect(replace).toHaveBeenCalledExactlyOnceWith("/"));
    // Geen foutmelding, en de loginvorm blijft staan tot de browser navigeert.
    expect(screen.queryByText(LOGIN_FOUTMELDING)).not.toBeInTheDocument();
  });

  it("wist een eerdere foutmelding bij een nieuwe poging", async () => {
    signInWithPassword.mockResolvedValueOnce({ error: { message: "x" } });
    const { user } = renderMetProviders(<LoginPage />);

    await vulInEnVerzend(user);
    expect(await screen.findByText(LOGIN_FOUTMELDING)).toBeVisible();

    let rondAf!: (v: { error: null }) => void;
    signInWithPassword.mockReturnValueOnce(new Promise<{ error: null }>((r) => (rondAf = r)));
    await user.click(screen.getByRole("button", { name: "Inloggen" }));
    expect(screen.queryByText(LOGIN_FOUTMELDING)).not.toBeInTheDocument();
    rondAf({ error: null });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });
});
