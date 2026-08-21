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
//  62 scenario's over 25 routes; elke §3-variant gedekt. Happy path + 401 +
//  relevante foutpaden (400/403/404/409/410/429) + de twee BESLUIT-1-vormen
//  (bytes-download sha256; 307-redirect met genormaliseerd location_pad).
//  Bewust uitgesloten: SSE/LLM-routes (W5) en de besluit-graaf-happy-paths
//  (zware seed; dezelfde wrapper al gedekt via 401/404/400).
// ============================================================================
import { LIMIET_ZOEKEN, LIMIET_ZOEKEN_ENDPOINT } from "./ratelimit-const.mjs";
import { FIX, FONDS_ID } from "./config.mjs";

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

  // ── /api/procedures/[id] — profielen(naam) · [id] · 404 ────────────────────
  { slug: "procedures-id.patch.anon", method: "PATCH", path: `/api/procedures/${FIX.procedure1}`, rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "procedures-id.patch.bestuurder.404", method: "PATCH", path: `/api/procedures/${FIX.procedureOnbekend}`, rol: "bestuurder", body: { motivering: "W1 karakterisering", titel: "x" }, verwacht: "json" },

  // ── /api/procedures/[id]/requirements — profielen(naam,rol) · GET/POST ─────
  { slug: "procedures-requirements.get.bestuurder", method: "GET", path: `/api/procedures/${FIX.procedure1}/requirements`, rol: "bestuurder", verwacht: "json" },
  { slug: "procedures-requirements.get.anon", method: "GET", path: `/api/procedures/${FIX.procedure1}/requirements`, rol: "anon", verwacht: "json" },
  { slug: "procedures-requirements.post.bestuurder.403", method: "POST", path: `/api/procedures/${FIX.procedure1}/requirements`, rol: "bestuurder", body: { label: "x" }, verwacht: "json" },
  { slug: "procedures-requirements.post.beheerder.invalid", method: "POST", path: `/api/procedures/${FIX.procedure1}/requirements`, rol: "beheerder", body: LEEG, verwacht: "json" },

  // ── /api/expertises + /api/focusgebieden — organen-factory (siblings) ──────
  { slug: "expertises.get.bestuurder", method: "GET", path: "/api/expertises", rol: "bestuurder", verwacht: "json" },
  { slug: "expertises.get.anon", method: "GET", path: "/api/expertises", rol: "anon", verwacht: "json" },
  { slug: "expertises.post.bestuurder.403", method: "POST", path: "/api/expertises", rol: "bestuurder", body: { naam: "x" }, verwacht: "json" },
  { slug: "focusgebieden.get.bestuurder", method: "GET", path: "/api/focusgebieden", rol: "bestuurder", verwacht: "json" },
  { slug: "focusgebieden.post.bestuurder.403", method: "POST", path: "/api/focusgebieden", rol: "bestuurder", body: { naam: "x" }, verwacht: "json" },
  { slug: "expertises-id.patch.anon", method: "PATCH", path: `/api/expertises/${FIX.expertise1}`, rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "expertises-id.patch.beheerder", method: "PATCH", path: `/api/expertises/${FIX.expertise1}`, rol: "beheerder", body: { naam: "W1 Expertise gewijzigd" }, verwacht: "json" },

  // ── /api/stuurinformatie/beheer — weigerAlsModuleUit · capability ──────────
  { slug: "stuurinformatie-beheer.get.anon", method: "GET", path: "/api/stuurinformatie/beheer", rol: "anon", verwacht: "json" },
  { slug: "stuurinformatie-beheer.get.bestuurder.403", method: "GET", path: "/api/stuurinformatie/beheer", rol: "bestuurder", verwacht: "json" },
  { slug: "stuurinformatie-beheer.get.beheerder", method: "GET", path: "/api/stuurinformatie/beheer", rol: "beheerder", verwacht: "json" },

  // ── /api/aqlab/audit/[exportId] — withPlatformRead (platformsurface) ───────
  { slug: "aqlab-audit.get.anon", method: "GET", path: `/api/aqlab/audit/${FIX.aqlabExportOnbekend}`, rol: "anon", verwacht: "json" },
  { slug: "aqlab-audit.get.bestuurder", method: "GET", path: `/api/aqlab/audit/${FIX.aqlabExportOnbekend}`, rol: "bestuurder", verwacht: "json" },

  // ── /api/procedures/[id]/afschriften/[afschriftId]/download — 307-redirect ─
  { slug: "afschrift-download.get.anon", method: "GET", path: `/api/procedures/${FIX.procedure1}/afschriften/${FIX.afschrift1}/download`, rol: "anon", verwacht: "json" },
  { slug: "afschrift-download.get.bestuursbureau.403", method: "GET", path: `/api/procedures/${FIX.procedure1}/afschriften/${FIX.afschrift1}/download`, rol: "bestuursbureau", verwacht: "json" },
  { slug: "afschrift-download.get.bestuurder.404", method: "GET", path: `/api/procedures/${FIX.procedure1}/afschriften/${FIX.afschriftOnbekend}/download`, rol: "bestuurder", verwacht: "json" },
  { slug: "afschrift-download.get.bestuurder.307", method: "GET", path: `/api/procedures/${FIX.procedure1}/afschriften/${FIX.afschrift1}/download`, rol: "bestuurder", verwacht: "redirect" },

  // ── W2-pilots (baseline vóór wrapper-migratie) ────────────────────────────
  // Pilot 1: /api/classificatie/queue — GET, auth-variant A, leunt op RLS.
  { slug: "w2.classificatie-queue.get.bestuurder", method: "GET", path: "/api/classificatie/queue", rol: "bestuurder", verwacht: "json" },
  { slug: "w2.classificatie-queue.get.anon", method: "GET", path: "/api/classificatie/queue", rol: "anon", verwacht: "json" },
  // Pilot 2: /api/agendapunten/[id]/herstellen — POST, rolcheck + agendapunt_log.
  { slug: "w2.herstellen.post.anon", method: "POST", path: `/api/agendapunten/${FIX.agendapuntVerwijderd}/herstellen`, rol: "anon", verwacht: "json" },
  { slug: "w2.herstellen.post.bestuurder.404", method: "POST", path: `/api/agendapunten/${FIX.agendapuntOnbekend}/herstellen`, rol: "bestuurder", verwacht: "json" },
  { slug: "w2.herstellen.post.voorzitter.400-niet-verwijderd", method: "POST", path: `/api/agendapunten/${FIX.agendapunt1}/herstellen`, rol: "voorzitter", verwacht: "json" },
  { slug: "w2.herstellen.post.bestuurder.403", method: "POST", path: `/api/agendapunten/${FIX.agendapuntVerwijderd}/herstellen`, rol: "bestuurder", verwacht: "json" },
  { slug: "w2.herstellen.post.voorzitter.200", method: "POST", path: `/api/agendapunten/${FIX.agendapuntVerwijderd}/herstellen`, rol: "voorzitter", verwacht: "json" },

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

  // ── W3-proefroutes — baselines op ONGEWIJZIGDE code (issue #___) ────────────
  //  Vastgelegd vóór enige migratie, zodat de karakterisering iets bewijst.
  //  aqlab/assurance = de enige W3-route met host-guard (spec.hostGuard-pad);
  //  dossiers = de tweede, uniforme leesroute.
  { slug: "w3.aqlab-assurance.get.anon", method: "GET", path: "/api/aqlab/assurance", rol: "anon", verwacht: "json" },
  { slug: "w3.aqlab-assurance.get.bestuurder", method: "GET", path: "/api/aqlab/assurance", rol: "bestuurder", verwacht: "json" },
  { slug: "w3.dossiers.get.anon", method: "GET", path: "/api/dossiers", rol: "anon", verwacht: "json" },
  { slug: "w3.dossiers.get.bestuurder", method: "GET", path: "/api/dossiers", rol: "bestuurder", verwacht: "json" },

  // ── W3-fase 2 — baselines op ONGEWIJZIGDE code (issue #94) ──────────────────
  //  [id]-dossierroutes: 401 + 404-pad (happy-200 vergt de zware besluit-graaf-
  //  seed en is bewust uitgesloten, net als de bestaande decisions-scenario's).
  { slug: "w3.decisions-dossier.get.anon", method: "GET", path: `/api/decisions/${FIX.decisionOnbekend}/dossier`, rol: "anon", verwacht: "json" },
  { slug: "w3.decisions-dossier.get.bestuurder.404", method: "GET", path: `/api/decisions/${FIX.decisionOnbekend}/dossier`, rol: "bestuurder", verwacht: "json" },
  { slug: "w3.procedures-dossier.get.anon", method: "GET", path: `/api/procedures/${FIX.procedureOnbekend}/dossier`, rol: "anon", verwacht: "json" },
  { slug: "w3.procedures-dossier.get.bestuurder.404", method: "GET", path: `/api/procedures/${FIX.procedureOnbekend}/dossier`, rol: "bestuurder", verwacht: "json" },
  // notificaties: eigen gebruiker_id-scoping via RLS; lege lijst is een geldige 200.
  { slug: "w3.notificaties.get.anon", method: "GET", path: "/api/notificaties", rol: "anon", verwacht: "json" },
  { slug: "w3.notificaties.get.bestuurder", method: "GET", path: "/api/notificaties", rol: "bestuurder", verwacht: "json" },
  // afschriften-lijst: happy 200 (procedure1 heeft een afschrift geseed). De
  // bestuursbureau-variant oefent bewust het profiel?.rol -> ctx.rol-pad (isBureauRol).
  { slug: "w3.procedures-afschriften.get.anon", method: "GET", path: `/api/procedures/${FIX.procedure1}/afschriften`, rol: "anon", verwacht: "json" },
  { slug: "w3.procedures-afschriften.get.bestuurder", method: "GET", path: `/api/procedures/${FIX.procedure1}/afschriften`, rol: "bestuurder", verwacht: "json" },
  { slug: "w3.procedures-afschriften.get.bestuursbureau", method: "GET", path: `/api/procedures/${FIX.procedure1}/afschriften`, rol: "bestuursbureau", verwacht: "json" },

  // ══ W4 — de muterende routes ═══════════════════════════════════════════════
  //
  //  seed() draait ÉÉN keer, vóór de lus (run.mjs). Elk scenario dat een
  //  GESLAAGDE mutatie vastlegt zet daarom zijn eigen fixture vers in `preseed`,
  //  op een EIGEN UUID. Zonder dat wordt de volgorde van deze lijst dragend:
  //  de tweede geslaagde mutatie op dezelfde rij ziet het effect van de eerste,
  //  en `--record` zou dat als "gedrag" vastleggen (W4 §4).
  //
  //  Afwijzingspaden (401/400/403/404/…) muteren niets en hebben geen preseed
  //  nodig.

  // ── /api/notificaties/[id]/lezen — PATCH · [id] · idempotent ───────────────
  //  Ontvanger is bewust VOORZITTER: `w3.notificaties.get.bestuurder` legt een
  //  lege lijst vast, en een fixture op bestuurder zou die laten meebewegen met
  //  de volgorde van de lus.
  { slug: "w4.notificaties-lezen.patch.anon", method: "PATCH", path: `/api/notificaties/${FIX.notificatieLezen}/lezen`, rol: "anon", verwacht: "json" },
  {
    slug: "w4.notificaties-lezen.patch.voorzitter.200-geupdatet",
    method: "PATCH",
    path: `/api/notificaties/${FIX.notificatieLezen}/lezen`,
    rol: "voorzitter",
    verwacht: "json",
    preseed: async ({ admin, users }) => {
      await admin.from("notificaties").delete().eq("id", FIX.notificatieLezen);
      const { error } = await admin.from("notificaties").insert({
        id: FIX.notificatieLezen,
        ontvanger_id: users.voorzitter.userId,
        fonds_id: FONDS_ID,
        type: "procedure_afgerond",
        payload: { w4: "karakterisering" },
        gelezen_op: null,
      });
      if (error) throw new Error(`preseed notificatieLezen: ${error.message}`);
    },
  },
  // Onbekende id → géén fout, wel `geupdatet: false`. Muteert niets.
  { slug: "w4.notificaties-lezen.patch.voorzitter.onbekend", method: "PATCH", path: `/api/notificaties/${FIX.notificatieOnbekend}/lezen`, rol: "voorzitter", verwacht: "json" },

  // ── /api/notificaties/alles-lezen — POST · bulk-update met exact-count ─────
  //  `count` telt ÁLLE ongelezen rijen van de beller. De preseed maakt de
  //  beheerder-inbox daarom eerst leeg en zet er precies één terug, zodat
  //  `aantal_gewijzigd` deterministisch 1 is — ongeacht wat eerder in de lus
  //  gedraaid heeft.
  { slug: "w4.notificaties-alles-lezen.post.anon", method: "POST", path: "/api/notificaties/alles-lezen", rol: "anon", body: LEEG, verwacht: "json" },
  {
    slug: "w4.notificaties-alles-lezen.post.beheerder.200",
    method: "POST",
    path: "/api/notificaties/alles-lezen",
    rol: "beheerder",
    body: LEEG,
    verwacht: "json",
    preseed: async ({ admin, users }) => {
      await admin.from("notificaties").delete().eq("ontvanger_id", users.beheerder.userId);
      const { error } = await admin.from("notificaties").insert({
        id: FIX.notificatieAlles,
        ontvanger_id: users.beheerder.userId,
        fonds_id: FONDS_ID,
        type: "besluit_geregistreerd",
        payload: { w4: "karakterisering" },
        gelezen_op: null,
      });
      if (error) throw new Error(`preseed notificatieAlles: ${error.message}`);
    },
  },

  // ── /api/risicos/[id]/sluiten — POST · [id] · 400-motivering · audit ──────
  { slug: "w4.risicos-sluiten.post.anon", method: "POST", path: `/api/risicos/${FIX.risicoSluiten}/sluiten`, rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "w4.risicos-sluiten.post.bestuurder.400", method: "POST", path: `/api/risicos/${FIX.risicoSluiten}/sluiten`, rol: "bestuurder", body: LEEG, verwacht: "json" },
  {
    slug: "w4.risicos-sluiten.post.bestuurder.200",
    method: "POST",
    path: `/api/risicos/${FIX.risicoSluiten}/sluiten`,
    rol: "bestuurder",
    body: { motivering: "W4 karakterisering — sluitmotivering" },
    verwacht: "json",
    // Zet het risico vers op 'actief'; anders sluit de tweede run een al
    // gesloten risico en drijft de snapshot. UPSERT, geen delete: `risico_log`
    // is append-only en hangt met CASCADE aan `risicos`, dus een risico met
    // auditregels is niet meer te verwijderen.
    preseed: async ({ admin }) => {
      const { error } = await admin.from("risicos").upsert({
        id: FIX.risicoSluiten,
        fonds_id: FONDS_ID,
        titel: "W4 Risico (sluiten)",
        categorie: "operationeel_datakwaliteit",
        kans: 3, impact: 3, niveau: "middel",
        type_risico: "structureel", status: "actief",
        gesloten_op: null, gesloten_door: null, sluit_motivering: null,
      }, { onConflict: "id" });
      if (error) throw new Error(`preseed risicoSluiten: ${error.message}`);
    },
  },

  // ── /api/risicos/[id]/maatregelen — POST · volgorde = laatste + 1 ─────────
  { slug: "w4.risicos-maatregelen.post.anon", method: "POST", path: `/api/risicos/${FIX.risicoMaatregelen}/maatregelen`, rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "w4.risicos-maatregelen.post.bestuurder.400", method: "POST", path: `/api/risicos/${FIX.risicoMaatregelen}/maatregelen`, rol: "bestuurder", body: LEEG, verwacht: "json" },
  {
    slug: "w4.risicos-maatregelen.post.bestuurder.200",
    method: "POST",
    path: `/api/risicos/${FIX.risicoMaatregelen}/maatregelen`,
    rol: "bestuurder",
    body: { beschrijving: "W4 maatregel", verantwoordelijke: null },
    verwacht: "json",
    // NIET-IDEMPOTENTE INSERT (§4): de route bepaalt `volgorde` als laatste + 1.
    // Zonder het leegmaken van de maatregelenlijst groeit die per run.
    // `risico_maatregelen` is niet append-only, dus daar mag delete wél.
    preseed: async ({ admin }) => {
      const { error } = await admin.from("risicos").upsert({
        id: FIX.risicoMaatregelen,
        fonds_id: FONDS_ID,
        titel: "W4 Risico (maatregelen)",
        categorie: "operationeel_datakwaliteit",
        kans: 2, impact: 2, niveau: "laag",
        type_risico: "structureel", status: "actief",
      }, { onConflict: "id" });
      if (error) throw new Error(`preseed risicoMaatregelen: ${error.message}`);
      await admin.from("risico_maatregelen").delete().eq("risico_id", FIX.risicoMaatregelen);
    },
  },

  // ── /api/risicos/[id]/maatregelen/[mid] — PATCH · meervoudige [id]-params ─
  { slug: "w4.risicos-maatregel.patch.anon", method: "PATCH", path: `/api/risicos/${FIX.risicoMaatregelen}/maatregelen/${FIX.maatregel1}`, rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "w4.risicos-maatregel.patch.bestuurder.400", method: "PATCH", path: `/api/risicos/${FIX.risicoMaatregelen}/maatregelen/${FIX.maatregel1}`, rol: "bestuurder", body: { status: "onzin" }, verwacht: "json" },
  {
    slug: "w4.risicos-maatregel.patch.bestuurder.200",
    method: "PATCH",
    path: `/api/risicos/${FIX.risicoMaatregelen}/maatregelen/${FIX.maatregel1}`,
    rol: "bestuurder",
    body: { status: "genomen" },
    verwacht: "json",
    preseed: async ({ admin }) => {
      const { error: rErr } = await admin.from("risicos").upsert({
        id: FIX.risicoMaatregelen,
        fonds_id: FONDS_ID,
        titel: "W4 Risico (maatregelen)",
        categorie: "operationeel_datakwaliteit",
        kans: 2, impact: 2, niveau: "laag",
        type_risico: "structureel", status: "actief",
      }, { onConflict: "id" });
      if (rErr) throw new Error(`preseed risicoMaatregelen (patch): ${rErr.message}`);
      const { error } = await admin.from("risico_maatregelen").upsert({
        id: FIX.maatregel1,
        risico_id: FIX.risicoMaatregelen,
        beschrijving: "W4 maatregel (te wijzigen)",
        status: "open",
        volgorde: 1,
      }, { onConflict: "id" });
      if (error) throw new Error(`preseed maatregel1: ${error.message}`);
    },
  },
];
