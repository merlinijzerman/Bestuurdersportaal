export const E2E_WACHTWOORD = "WP3-E2E-Aa1!";
export const E2E_AI_EERSTE_DELTA =
  "Eerste gestreamde deel: de synthetische uitvoeringsafspraak staat in [Bron 1]. ";
export const E2E_AI_TWEEDE_DELTA = "De tweede controlewaarde staat in [Bron 2].";
export const E2E_AI_PROVIDER_FOUT_MARKER = "WP4_PROVIDER_FOUT";
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

export const E2E_PLATFORM_ACCOUNTS = Object.freeze({
  zonderCapability: Object.freeze({
    email: "wp3-platform-zonder-capability@e2e.invalid",
    naam: "Synthetisch platform zonder capability",
  }),
  observability: Object.freeze({
    email: "wp3-platform-observability@e2e.invalid",
    naam: "Synthetisch platform observability",
  }),
  granter: Object.freeze({
    email: "wp3-platform-granter@e2e.invalid",
    naam: "Synthetisch platform fixture-granter",
  }),
});

export const E2E_AI_BRONNEN = Object.freeze({
  fondsAUitvoering: Object.freeze({
    id: "00000000-0000-4000-8000-00000000e401",
    chunkId: "00000000-0000-4000-8000-00000000e411",
    titel: "WP4 synthetische uitvoeringsafspraak",
  }),
  fondsAControle: Object.freeze({
    id: "00000000-0000-4000-8000-00000000e402",
    chunkId: "00000000-0000-4000-8000-00000000e412",
    titel: "WP4 synthetisch controleprotocol",
  }),
  fondsBIsolatie: Object.freeze({
    id: "00000000-0000-4000-8000-00000000e403",
    chunkId: "00000000-0000-4000-8000-00000000e413",
    titel: "WP4 verboden ander-fondsdocument",
  }),
});

export const E2E_ASSISTENT_CONTEXT = Object.freeze({
  procedure: Object.freeze({
    id: "00000000-0000-4000-8000-00000000e501",
    titel: "WP4 synthetisch contextproces",
  }),
  vergadering: Object.freeze({
    id: "00000000-0000-4000-8000-00000000e502",
    titel: "WP4 synthetische contextvergadering",
  }),
  agendapunt: Object.freeze({
    id: "00000000-0000-4000-8000-00000000e503",
    titel: "WP4 synthetisch contextagendapunt",
  }),
  risico: Object.freeze({
    id: "00000000-0000-4000-8000-00000000e504",
    titel: "WP4 synthetisch context-risico",
  }),
});

export function e2eEmail(fondsSleutel, rol) {
  return `wp3-${fondsSleutel}-${rol}@e2e.invalid`;
}

export function authStateBestand(fondsSleutel, rol) {
  return `tests/e2e/.auth/${fondsSleutel}-${rol}.json`;
}

export function platformAuthStateBestand(account, niveau) {
  return `tests/e2e/.auth/platform-${account}-${niveau}.json`;
}
