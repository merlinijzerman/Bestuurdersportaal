export const E2E_WACHTWOORD = "WP3-E2E-Aa1!";
export const E2E_ROLLEN = Object.freeze([
  "bestuurder",
  "voorzitter",
  "beheerder",
  "bestuursbureau",
]);

export const E2E_FONDSEN = Object.freeze({
  a: Object.freeze({
    id: "00000000-0000-4000-8000-00000000e201",
    domeinId: "00000000-0000-4000-8000-00000000e211",
    naam: "Synthetisch E2E Fonds A",
    slug: "synthetisch-e2e-a",
    host: "fonds-a.localhost",
  }),
  b: Object.freeze({
    id: "00000000-0000-4000-8000-00000000e202",
    domeinId: "00000000-0000-4000-8000-00000000e212",
    naam: "Synthetisch E2E Fonds B",
    slug: "synthetisch-e2e-b",
    host: "fonds-b.localhost",
  }),
});

export function e2eEmail(fondsSleutel, rol) {
  return `wp3-${fondsSleutel}-${rol}@e2e.invalid`;
}

export function authStateBestand(fondsSleutel, rol) {
  return `tests/e2e/.auth/${fondsSleutel}-${rol}.json`;
}
