// ============================================================================
//  W1 — Vaste configuratie voor het karakteriseringsharnas.
// ----------------------------------------------------------------------------
//  Alle UUID's die het harnas zelf plant zijn VAST (determinisme, leesbaarheid).
//  Auth-user-UUID's zijn de uitzondering: die genereert GoTrue per run en worden
//  door de normalisatielaag gemapt (BESLUIT #88). Domein-fixtures hieronder
//  krijgen herkenbare vaste UUID's.
// ============================================================================

export const ENV = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  appBaseUrl: process.env.APP_BASE_URL || "http://127.0.0.1:3000",
  cronSecret: process.env.CRON_SECRET || "",
};

export const FONDS_ID = "00000000-0000-4000-8000-000000000001";

// Vier rollen (profielen_rol_check): één sessie per rol.
export const ROLLEN = ["bestuurder", "voorzitter", "beheerder", "bestuursbureau"];

export const WACHTWOORD = "W1-karakterisering-Aa1!";

export function emailVoor(rol) {
  return `w1-${rol}@karakterisering.invalid`;
}

// Vaste domein-UUID's (per tier geseed). Herkenbare achtervoegsels.
export const FIX = {
  document1: "00000000-0000-4000-8000-0000000d0c01",
  documentIntrekken: "00000000-0000-4000-8000-0000000d0c02",
  documentOnbekend: "00000000-0000-4000-8000-0000000d0cff",
  procedure1: "00000000-0000-4000-8000-00000000cd01",
  risico1: "00000000-0000-4000-8000-0000000715c1",
};

// Vaste bytes voor de bestand-download (BESLUIT: body_sha256 i.p.v. ruwe bytes).
export const DOCUMENT1_BYTES = "%PDF-1.4 W1-KARAKTERISERING-FIXTURE\n";
export const DOCUMENT1_PAD = `${FONDS_ID}/w1-document.pdf`;
