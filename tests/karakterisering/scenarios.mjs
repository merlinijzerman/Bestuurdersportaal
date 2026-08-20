// ============================================================================
//  W1 — Scenariotabel (datatabel, geen losse testbestanden — §4.5).
// ----------------------------------------------------------------------------
//  Eén rij = één snapshot. Velden:
//    slug      bestandsnaam van de snapshot (uniek)
//    method    HTTP-methode
//    path      pad onder de app-host
//    rol       'anon' of een van de vier rollen (bepaalt de sessiecookie)
//    body      request-body (JSON) — optioneel
//    verwacht  'json' | 'bytes' | 'redirect' — bepaalt de snapshotvorm
//    headers   extra request-headers — optioneel
//    preseed   async (ctx) => {}  — DB-voorbewerking vóór het request
//
//  TIER 1 (framework-bewijs): routes met minimale seed. Domein-graaf-routes
//  (documenten/procedures/besluiten/…) volgen als tier 2.
// ============================================================================
import { LIMIET_ZOEKEN, LIMIET_ZOEKEN_ENDPOINT } from "./ratelimit-const.mjs";
import { FIX } from "./config.mjs";

const LEEG = {};

export const scenarios = [
  // ── /api/profiel — brede select · capability · A2 ──────────────────────────
  { slug: "profiel.get.bestuurder", method: "GET", path: "/api/profiel", rol: "bestuurder", verwacht: "json" },
  { slug: "profiel.get.anon", method: "GET", path: "/api/profiel", rol: "anon", verwacht: "json" },
  { slug: "profiel.patch.anon", method: "PATCH", path: "/api/profiel", rol: "anon", body: LEEG, verwacht: "json" },

  // ── /api/healthz/ping — publiek, altijd {ok:true} ──────────────────────────
  { slug: "healthz-ping.get", method: "GET", path: "/api/healthz/ping", rol: "anon", verwacht: "json" },

  // ── /api/platform/healthz — gedeelde cron-auth; DEPLOY_TARGET=app → skipped ─
  { slug: "platform-healthz.get.anon", method: "GET", path: "/api/platform/healthz", rol: "anon", verwacht: "json" },

  // ── /api/instellingen — A2 · profielen(naam,fonds_id,rol) · capability ──────
  { slug: "instellingen.get.beheerder", method: "GET", path: "/api/instellingen", rol: "beheerder", verwacht: "json" },
  { slug: "instellingen.get.anon", method: "GET", path: "/api/instellingen", rol: "anon", verwacht: "json" },
  { slug: "instellingen.post.anon", method: "POST", path: "/api/instellingen", rol: "anon", body: LEEG, verwacht: "json" },

  // ── /api/risicos — A1 multiline · weigerAlsModuleUit · 400 ─────────────────
  { slug: "risicos.post.bestuurder.invalid", method: "POST", path: "/api/risicos", rol: "bestuurder", body: { titel: "" }, verwacht: "json" },
  { slug: "risicos.post.anon", method: "POST", path: "/api/risicos", rol: "anon", body: LEEG, verwacht: "json" },

  // ── /api/contact — publiek; CSRF-gate (geen Origin in prod → geweigerd) ─────
  { slug: "contact.post.anon.geen-origin", method: "POST", path: "/api/contact", rol: "anon", body: { naam: "T", organisatie: "O", email: "t@x.nl" }, headers: { "content-type": "application/json" }, verwacht: "json" },

  // ── /api/documents/[id]/bestand — non-JSON bytes · host-guard · [id] ───────
  { slug: "documents-bestand.get.bestuurder", method: "GET", path: `/api/documents/${FIX.document1}/bestand`, rol: "bestuurder", verwacht: "bytes" },
  { slug: "documents-bestand.get.anon", method: "GET", path: `/api/documents/${FIX.document1}/bestand`, rol: "anon", verwacht: "json" },
  { slug: "documents-bestand.get.404", method: "GET", path: `/api/documents/${FIX.documentOnbekend}/bestand`, rol: "bestuurder", verwacht: "json" },
  { slug: "documents-bestand.get.410-ingetrokken", method: "GET", path: `/api/documents/${FIX.documentIntrekken}/bestand`, rol: "bestuurder", verwacht: "json" },

  // ── /api/procesmodellen — catalogusContext() · capability(catalog.manage) ──
  { slug: "procesmodellen.get.bestuurder", method: "GET", path: "/api/procesmodellen", rol: "bestuurder", verwacht: "json" },
  { slug: "procesmodellen.get.anon", method: "GET", path: "/api/procesmodellen", rol: "anon", verwacht: "json" },
  { slug: "procesmodellen.post.bestuurder.403", method: "POST", path: "/api/procesmodellen", rol: "bestuurder", body: { naam: "x", generiek_procestype: "jaarplanning" }, verwacht: "json" },
  { slug: "procesmodellen.post.beheerder.invalid", method: "POST", path: "/api/procesmodellen", rol: "beheerder", body: LEEG, verwacht: "json" },
  { slug: "procesmodellen-id.get.bestuurder", method: "GET", path: `/api/procesmodellen/${FIX.procesmodel1}`, rol: "bestuurder", verwacht: "json" },
  { slug: "procesmodellen-id.patch.beheerder", method: "PATCH", path: `/api/procesmodellen/${FIX.procesmodel1}`, rol: "beheerder", body: { omschrijving: "W1 wijziging" }, verwacht: "json" },

  // ── /api/gremia — organen-factory (organen-route.ts) ───────────────────────
  { slug: "gremia.get.bestuurder", method: "GET", path: "/api/gremia", rol: "bestuurder", verwacht: "json" },
  { slug: "gremia.post.bestuurder.403", method: "POST", path: "/api/gremia", rol: "bestuurder", body: { naam: "x", type: "besluitvormend" }, verwacht: "json" },
  { slug: "gremia-id.patch.beheerder", method: "PATCH", path: `/api/gremia/${FIX.gremium1}`, rol: "beheerder", body: { naam: "W1 Gremium gewijzigd" }, verwacht: "json" },

  // ── /api/risicos/[id] — A1 · [id] expliciete fondscheck · 404 ──────────────
  { slug: "risicos-id.patch.anon", method: "PATCH", path: `/api/risicos/${FIX.risico1}`, rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "risicos-id.patch.bestuurder.404", method: "PATCH", path: `/api/risicos/${FIX.risicoOnbekend}`, rol: "bestuurder", body: LEEG, verwacht: "json" },
  { slug: "risicos-id.patch.bestuurder.200-noop", method: "PATCH", path: `/api/risicos/${FIX.risico1}`, rol: "bestuurder", body: LEEG, verwacht: "json" },

  // ── /api/decisions/[id] — [id] leunt op RLS · 404 ──────────────────────────
  { slug: "decisions-id.patch.anon", method: "PATCH", path: `/api/decisions/${FIX.decisionOnbekend}`, rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "decisions-id.patch.bestuurder.404", method: "PATCH", path: `/api/decisions/${FIX.decisionOnbekend}`, rol: "bestuurder", body: { titel: "x" }, verwacht: "json" },

  // ── /api/decisions/[id]/risks/[rid] — geneste [id] · RLS-only ──────────────
  { slug: "decisions-risks.patch.anon", method: "PATCH", path: `/api/decisions/${FIX.decisionOnbekend}/risks/${FIX.decisionRiskOnbekend}`, rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "decisions-risks.patch.bestuurder.400-status", method: "PATCH", path: `/api/decisions/${FIX.decisionOnbekend}/risks/${FIX.decisionRiskOnbekend}`, rol: "bestuurder", body: { status: "ongeldige-status" }, verwacht: "json" },

  // ── /api/agendapunten/[id] — A1 · [id] expliciete fondscheck · PATCH/DELETE ─
  { slug: "agendapunten-id.patch.anon", method: "PATCH", path: `/api/agendapunten/${FIX.agendapuntOnbekend}`, rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "agendapunten-id.patch.bestuurder.404", method: "PATCH", path: `/api/agendapunten/${FIX.agendapuntOnbekend}`, rol: "bestuurder", body: { titel: "x" }, verwacht: "json" },
  { slug: "agendapunten-id.delete.anon", method: "DELETE", path: `/api/agendapunten/${FIX.agendapuntOnbekend}`, rol: "anon", verwacht: "json" },

  // ── /api/gesprekken/[id] — DELETE · [id] RLS-only (SECURITY DEFINER RPC) ────
  { slug: "gesprekken-id.delete.anon", method: "DELETE", path: `/api/gesprekken/${FIX.gesprek1}`, rol: "anon", verwacht: "json" },
  { slug: "gesprekken-id.delete.invalid-id", method: "DELETE", path: "/api/gesprekken/geen-uuid", rol: "bestuurder", verwacht: "json" },
  { slug: "gesprekken-id.delete.bestuurder.404", method: "DELETE", path: `/api/gesprekken/${FIX.gesprekOnbekend}`, rol: "bestuurder", verwacht: "json" },
  { slug: "gesprekken-id.delete.bestuurder.200", method: "DELETE", path: `/api/gesprekken/${FIX.gesprek1}`, rol: "bestuurder", verwacht: "json" },

  // ── /api/zoeken — rate-limit · host-guard ──────────────────────────────────
  { slug: "zoeken.get.anon", method: "GET", path: "/api/zoeken?q=test", rol: "anon", verwacht: "json" },
  {
    slug: "zoeken.get.bestuurder.gezaaide-429",
    method: "GET",
    path: "/api/zoeken?q=test",
    rol: "bestuurder",
    verwacht: "json",
    // BESLUIT: teller vullen tot de limiet → deterministische 429 vóór enige
    // embedding-call.
    preseed: async ({ admin, users }) => {
      const uid = users.bestuurder.userId;
      await admin.from("rate_limit_events").delete().eq("gebruiker_id", uid).eq("endpoint", LIMIET_ZOEKEN_ENDPOINT);
      const rijen = Array.from({ length: LIMIET_ZOEKEN }, () => ({
        gebruiker_id: uid,
        endpoint: LIMIET_ZOEKEN_ENDPOINT,
      }));
      const { error } = await admin.from("rate_limit_events").insert(rijen);
      if (error) throw new Error(`preseed rate_limit_events: ${error.message}`);
    },
  },
];
