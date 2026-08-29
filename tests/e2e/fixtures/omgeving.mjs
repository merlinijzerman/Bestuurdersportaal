import { bevestigVeiligeSeedDoelomgeving } from "../../karakterisering/seed-doelomgeving.mjs";

const STANDAARD_ORIGINS = Object.freeze({
  fondsA: "http://fonds-a.localhost:3000",
  fondsB: "http://fonds-b.localhost:3000",
  onbekend: "http://onbekend.localhost:3000",
  platform: "http://beheer.localhost:3000",
});

function doelFout(reden) {
  return new Error(`E2E GEBLOKKEERD: ${reden}`);
}

function bevestigLokaleAppOrigin(naam, waarde) {
  let url;
  try {
    url = new URL(waarde);
  } catch {
    throw doelFout(`${naam} ontbreekt of is geen geldige URL.`);
  }
  const lokaal =
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost");
  if (url.protocol !== "http:" || !lokaal || url.username || url.password) {
    throw doelFout(`${naam} moet een lokale http-origin zonder credentials zijn.`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw doelFout(`${naam} mag geen pad, query of fragment bevatten.`);
  }
  return url.origin;
}

/**
 * Fail-closed vóór een adminclient, seedquery of browserstart.
 * WP3 is muterend en mag daarom uitsluitend tegen de lokale CLI-stack draaien;
 * zelfs de expliciet toegestane read-only Preview-ref uit WP0 wordt geweigerd.
 */
export function bevestigVeiligeE2eDoelomgeving(env = process.env) {
  if (env.SEED_DOELOMGEVING !== "local") {
    throw doelFout("SEED_DOELOMGEVING moet exact 'local' zijn.");
  }
  bevestigVeiligeSeedDoelomgeving({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    doelomgeving: env.SEED_DOELOMGEVING,
  });
  if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw doelFout("de lokale Supabase anon- en service-role-key zijn verplicht.");
  }

  const origins = {
    fondsA: bevestigLokaleAppOrigin(
      "E2E_FONDS_A_ORIGIN",
      env.E2E_FONDS_A_ORIGIN ?? STANDAARD_ORIGINS.fondsA
    ),
    fondsB: bevestigLokaleAppOrigin(
      "E2E_FONDS_B_ORIGIN",
      env.E2E_FONDS_B_ORIGIN ?? STANDAARD_ORIGINS.fondsB
    ),
    onbekend: bevestigLokaleAppOrigin(
      "E2E_ONBEKENDE_ORIGIN",
      env.E2E_ONBEKENDE_ORIGIN ?? STANDAARD_ORIGINS.onbekend
    ),
    platform: bevestigLokaleAppOrigin(
      "E2E_PLATFORM_ORIGIN",
      env.E2E_PLATFORM_ORIGIN ?? STANDAARD_ORIGINS.platform
    ),
  };
  if (new Set(Object.values(origins)).size !== Object.keys(origins).length) {
    throw doelFout("de vier E2E-origins moeten van elkaar verschillen.");
  }

  return {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    origins,
  };
}
