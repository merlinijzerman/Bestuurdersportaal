// ============================================================================
//  Fonds-config — PURE kern (T8). Geen I/O, geen server-imports → testbaar met
//  tsx/node en herbruikbaar in client-componenten. De I/O-leeslaag (Supabase)
//  staat in lib/fonds-config.ts.
// ----------------------------------------------------------------------------
//  Bevat: (a) de allowlist + validatie van themabare design-tokens (voorkomt
//  CSS-injectie — theming is cosmetisch maar wordt server-side in een <style>
//  geïnjecteerd, dus waarden worden strikt gevalideerd); (b) het bouwen van de
//  veilige CSS-override; (c) helpers om ruwe manifest-/flag-rijen te normaliseren.
// ============================================================================

export type JsonWaarde =
  | string | number | boolean | null
  | JsonWaarde[]
  | { [k: string]: JsonWaarde };

/** Themabare tokensleutels (allowlist) → soort waarde. Alleen deze keys worden
 *  toegepast; al het overige in de tokens-jsonb wordt genegeerd. */
export const THEMABARE_TOKENS = {
  "accent-rgb": "rgb",
  "accent-ink-rgb": "rgb",
  "accent-tint-rgb": "rgb",
  "nav-rgb": "rgb",
  "nav-line-rgb": "rgb",
  "nav-accent-rgb": "rgb",
  "nav-text-rgb": "rgb",
  "nav-text-active-rgb": "rgb",
  "logo-letter": "letter",
  "logo-url": "url",
} as const;

export type ThemaTokenKey = keyof typeof THEMABARE_TOKENS;

/** De CSS-var-tokens (RGB-channel-triples) waaruit we `:root`-overrides bouwen. */
const RGB_TOKEN_PATROON = /^\d{1,3} \d{1,3} \d{1,3}$/;
/** Logo-letter: 1–2 alfanumerieke tekens (merkvierkant). */
const LETTER_PATROON = /^[A-Za-z0-9]{1,2}$/;
/** Logo-URL/-pad: intern pad of https-URL, zonder tekens die CSS/HTML kunnen breken. */
const URL_PATROON = /^(\/[A-Za-z0-9._\-/]*|https:\/\/[A-Za-z0-9._\-/]+)$/;

/** Is een RGB-triple geldig (drie kanalen 0–255)? */
export function isGeldigeRgbTriple(v: unknown): v is string {
  if (typeof v !== "string" || !RGB_TOKEN_PATROON.test(v)) return false;
  return v.split(" ").every((n) => {
    const x = Number(n);
    return Number.isInteger(x) && x >= 0 && x <= 255;
  });
}

/** Valideer één token op basis van zijn allowlist-soort. */
export function isGeldigToken(key: ThemaTokenKey, waarde: unknown): boolean {
  const soort = THEMABARE_TOKENS[key];
  if (soort === "rgb") return isGeldigeRgbTriple(waarde);
  if (soort === "letter") return typeof waarde === "string" && LETTER_PATROON.test(waarde);
  if (soort === "url") return typeof waarde === "string" && URL_PATROON.test(waarde);
  return false;
}

/**
 * Filtert ruwe theming-tokens tot de gevalideerde allowlist. Onbekende keys en
 * ongeldige waarden worden weggelaten (en gerapporteerd), zodat er nooit
 * ongecontroleerde inhoud in de CSS-injectie belandt.
 */
export function valideerThemingTokens(
  raw: unknown
): { tokens: Partial<Record<ThemaTokenKey, string>>; genegeerd: string[] } {
  const tokens: Partial<Record<ThemaTokenKey, string>> = {};
  const genegeerd: string[] = [];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if ((k in THEMABARE_TOKENS) && isGeldigToken(k as ThemaTokenKey, v)) {
        tokens[k as ThemaTokenKey] = v as string;
      } else {
        genegeerd.push(k);
      }
    }
  }
  return { tokens, genegeerd };
}

/**
 * Bouwt een VEILIGE `:root{}`-CSS-override uit gevalideerde tokens. Alleen de
 * RGB-tokens leveren CSS-variabelen (zowel `--x-rgb` als de afgeleide `--x`,
 * conform globals.css). Ontbrekende tokens vallen terug op globals.css (fail-
 * safe). Retourneert '' als er niets te overschrijven valt.
 */
export function bouwThemingCss(
  tokens: Partial<Record<ThemaTokenKey, string>>
): string {
  const regels: string[] = [];
  for (const [key, waarde] of Object.entries(tokens)) {
    if (THEMABARE_TOKENS[key as ThemaTokenKey] !== "rgb") continue;
    if (!waarde || !isGeldigeRgbTriple(waarde)) continue; // dubbele zekerheid
    const basis = key.replace(/-rgb$/, "");
    regels.push(`--${key}:${waarde}`);
    regels.push(`--${basis}:rgb(${waarde})`);
  }
  return regels.length ? `:root{${regels.join(";")};}` : "";
}

/** Branding-tokens (niet-CSS) voor componenten (logo-letter/-url). */
export function brandingUitTokens(
  tokens: Partial<Record<ThemaTokenKey, string>>
): { logoLetter?: string; logoUrl?: string } {
  return {
    logoLetter: tokens["logo-letter"],
    logoUrl: tokens["logo-url"],
  };
}

/** Coerce een jsonb-flagwaarde naar boolean. Accepteert echte booleans en de
 *  strings "true"/"on"/"1". Alles anders → false. `undefined` = geen flag. */
export function flagAlsBoolean(waarde: unknown): boolean {
  if (typeof waarde === "boolean") return waarde;
  if (typeof waarde === "string") return ["true", "on", "1"].includes(waarde.toLowerCase());
  if (typeof waarde === "number") return waarde !== 0;
  return false;
}
