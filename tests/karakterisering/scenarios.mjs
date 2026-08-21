// ============================================================================
//  W1 — Scenariotabel (datatabel, geen losse testbestanden — §4.5).
// ----------------------------------------------------------------------------
//  Eén rij = één snapshot. Velden:
//    slug      bestandsnaam van de snapshot (uniek)
//    method    HTTP-methode
//    path      pad onder de app-host
//    rol       'anon' of een van de vier rollen (bepaalt de sessiecookie)
//    body      request-body (JSON) — optioneel
//    rawBody   ruwe request-body zonder JSON.stringify — optioneel; voor
//              scenario's die juist een ONGELDIGE body moeten sturen
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

/** Delete met foutcontrole. Een ongecontroleerde delete in een preseed geeft
 *  hetzelfde stille falen als in seed.mjs: de opruiming wordt geweigerd (bv. door
 *  een append-only kind), de preseed loopt door, en de fout komt er twee stappen
 *  verderop uit als een duplicate-key of — erger — als een snapshot die groen is
 *  op de verkeerde grond. Zie de W4-sweep in seed.mjs. */
async function wis(admin, tabel, filter) {
  let q = admin.from(tabel).delete();
  for (const [kolom, waarde] of Object.entries(filter)) q = q.eq(kolom, waarde);
  const { error } = await q;
  if (error) throw new Error(`preseed delete ${tabel}: ${error.message}`);
}

// ── Gedeelde preseed-bouwstenen ──────────────────────────────────────────────
//  Upsert, nooit delete-en-herbouw: agendapunt_log en de stem-/besluitlogboeken
//  zijn append-only en hangen met CASCADE aan hun ouder. Een rij met auditregels
//  is daardoor niet meer te verwijderen — zie de W4-bevinding bij seedRisicos.

/** Agendapunt met categorie 'besluitvorming'; aangemaakt door de VOORZITTER,
 *  zodat de aanmaker-tak in POST /api/stemmingen niet per ongeluk open staat
 *  voor de bestuurder die het 403-scenario moet krijgen. */
async function zetAgendapuntBesluit(admin, users, id = FIX.agendapuntBesluit) {
  const { error } = await admin.from("agendapunten").upsert(
    {
      id,
      vergadering_id: FIX.vergadering1,
      titel: "W4 Agendapunt besluitvorming",
      categorie: "besluitvorming",
      aangemaakt_door: users.voorzitter.userId,
      verwijderd_op: null,
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`preseed agendapuntBesluit: ${error.message}`);
}

/** Wist de rate-limit-teller voor één endpoint. Nodig zodra een scenario een
 *  begrensde route raakt: het harnas draait `--verify` 3x achter elkaar (en in
 *  CI ook), dus zonder wissen tikt de teller door en slaat de respons ergens
 *  in ronde 2 of 3 om naar 429. Dat is dezelfde volgorde-afhankelijkheid als in
 *  §4, alleen dan via een teller in plaats van via een fixture. */
async function wisLimiet(admin, endpoint) {
  await wis(admin, "rate_limit_events", { endpoint });
}

/** Vergadering in een vaste staat. Upsert-reset, nooit delete: `vergadering_log`
 *  is append-only en hangt er met CASCADE aan. */
async function zetVergaderingFixture(admin, users, id, extra = {}) {
  const { error } = await admin.from("vergaderingen").upsert(
    {
      id,
      fonds_id: FONDS_ID,
      titel: "W4 Vergadering fixture",
      datum: "2026-03-01T10:00:00Z",
      locatie: "W4",
      status: "gepland",
      aangemaakt_door: users.voorzitter.userId,
      gearchiveerd_op: null,
      gearchiveerd_door: null,
      ...extra,
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`preseed vergadering ${id}: ${error.message}`);
}

/** Agendapunt in een vaste staat op een EIGEN vergadering. */
async function zetVergadering(admin, id, titel) {
  const { error } = await admin.from("vergaderingen").upsert(
    { id, fonds_id: FONDS_ID, titel, datum: "2026-02-01T10:00:00Z" },
    { onConflict: "id" }
  );
  if (error) throw new Error(`preseed vergadering ${titel}: ${error.message}`);
}

async function zetAgendapunt(admin, users, id, extra = {}) {
  await zetVergadering(admin, FIX.vergaderingAgendapunt, "W4 Vergadering");
  const { error } = await admin.from("agendapunten").upsert(
    {
      id,
      vergadering_id: FIX.vergaderingAgendapunt,
      titel: "W4 Agendapunt",
      categorie: "informatie",
      volgorde: 1,
      aangemaakt_door: users.voorzitter.userId,
      verwijderd_op: null,
      verwijderd_door: null,
      verwijder_reden: null,
      ...extra,
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`preseed agendapunt ${id}: ${error.message}`);
}

/** Document in een vaste staat. Upsert-reset: `documenten` heeft append-only
 *  kinderen (`extraction_run`, `comparison_results`) met NO ACTION, dus zodra er
 *  één extractie of vergelijking op staat is de rij niet meer te verwijderen. */
async function zetDocument(admin, id, actief) {
  const { error } = await admin.from("documenten").upsert(
    {
      id,
      fonds_id: FONDS_ID,
      bibliotheek: "fonds",
      bron: "Intern",
      titel: `W4 Document (${actief ? "actief" : "gedeactiveerd"})`,
      bestandsnaam: "w4-document.pdf",
      bestandstype: "pdf",
      opslag_pad: `${FONDS_ID}/w4-document.pdf`,
      actief,
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`preseed document ${id}: ${error.message}`);
}

/** Eén inbrengregel van de BESTUURDER op een vast agendapunt. */
async function zetInbreng(admin, users) {
  await zetAgendapunt(admin, users, FIX.agendapuntInbreng);
  const { error } = await admin.from("agendapunt_inbreng").upsert(
    {
      id: FIX.inbreng1,
      agendapunt_id: FIX.agendapuntInbreng,
      gebruiker_id: users.bestuurder.userId,
      gebruiker_naam: "W1 bestuurder",
      tekst: "W4 bestaande inbreng",
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`preseed inbreng1: ${error.message}`);
}

/** Stemronde in een vaste staat; geopend door de VOORZITTER, op een EIGEN
 *  agendapunt — `idx_stemming_een_open` laat maar één open ronde per agendapunt
 *  toe, dus gedeelde agendapunten laten de preseeds op elkaar botsen. */
async function zetStemming(admin, users, id, status, agendapuntId) {
  await zetAgendapuntBesluit(admin, users, agendapuntId);
  const { error } = await admin.from("stemmingen").upsert(
    {
      id,
      fonds_id: FONDS_ID,
      agendapunt_id: agendapuntId,
      vraag: "W4 stemvraag",
      status,
      geopend_door: users.voorzitter.userId,
      geopend_op: "2026-01-03T10:00:00Z",
      gesloten_op: status === "open" ? null : "2026-01-04T10:00:00Z",
      gesloten_door: status === "open" ? null : users.voorzitter.userId,
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`preseed stemming ${status}: ${error.message}`);
}

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
      await wis(admin, "rate_limit_events", { gebruiker_id: uid, endpoint: LIMIET_ZOEKEN_ENDPOINT });
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
      await wis(admin, "notificaties", { id: FIX.notificatieLezen });
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
      await wis(admin, "notificaties", { ontvanger_id: users.beheerder.userId });
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
      await wis(admin, "risico_maatregelen", { risico_id: FIX.risicoMaatregelen });
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

  // ══ stemmingen ═════════════════════════════════════════════════════════════
  //  Gedeelde bouwsteen: een agendapunt met categorie 'besluitvorming'. De
  //  W1-fixtures hebben die categorie niet, en zonder categorie stopt
  //  `POST /api/stemmingen` al bij de 400.
  //  Elke stemronde krijgt een EIGEN UUID: sluiten, intrekken en stemmen
  //  wijzigen alle drie dezelfde rij, dus één gedeelde ronde zou de volgorde
  //  van deze lijst dragend maken (§4).

  // ── /api/stemmingen — POST · bureau-403 · rol-403 · 200 ───────────────────
  { slug: "w4.stemmingen.post.anon", method: "POST", path: "/api/stemmingen", rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "w4.stemmingen.post.bestuurder.400-verplicht", method: "POST", path: "/api/stemmingen", rol: "bestuurder", body: LEEG, verwacht: "json" },
  { slug: "w4.stemmingen.post.bestuurder.404-agendapunt", method: "POST", path: "/api/stemmingen", rol: "bestuurder", body: { agendapunt_id: FIX.agendapuntOnbekend, vraag: "W4?" }, verwacht: "json" },
  { slug: "w4.stemmingen.post.bestuurder.400-categorie", method: "POST", path: "/api/stemmingen", rol: "bestuurder", body: { agendapunt_id: FIX.agendapunt1, vraag: "W4?" }, verwacht: "json" },
  {
    // Bureau-gate (BB-12). Oefent bewust het profiel?.rol -> ctx.rol-pad.
    slug: "w4.stemmingen.post.bestuursbureau.403",
    method: "POST", path: "/api/stemmingen", rol: "bestuursbureau",
    body: { agendapunt_id: FIX.agendapuntBesluit, vraag: "W4 bureau?" }, verwacht: "json",
    preseed: async ({ admin, users }) => zetAgendapuntBesluit(admin, users),
  },
  {
    // Bestuurder is niet voorzitter/beheerder en niet de aanmaker -> 403.
    slug: "w4.stemmingen.post.bestuurder.403-rol",
    method: "POST", path: "/api/stemmingen", rol: "bestuurder",
    body: { agendapunt_id: FIX.agendapuntBesluit, vraag: "W4 rol?" }, verwacht: "json",
    preseed: async ({ admin, users }) => zetAgendapuntBesluit(admin, users),
  },
  {
    // Happy path. NIET-IDEMPOTENT: elke run maakt een nieuwe stemronde-rij.
    // De preseed ruimt de rondes op dit agendapunt eerst op.
    slug: "w4.stemmingen.post.voorzitter.200",
    method: "POST", path: "/api/stemmingen", rol: "voorzitter",
    body: { vraag: "W4 stemronde?", agendapunt_id: FIX.agendapuntBesluit }, verwacht: "json",
    preseed: async ({ admin, users }) => {
      await zetAgendapuntBesluit(admin, users);
      await wis(admin, "stemmingen", { agendapunt_id: FIX.agendapuntBesluit });
    },
  },

  // ── /api/stemmingen/[id]/stemmen — POST · bureau-403 · 200 ────────────────
  { slug: "w4.stemmen.post.anon", method: "POST", path: `/api/stemmingen/${FIX.stemmingStemmen}/stemmen`, rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "w4.stemmen.post.bestuurder.400-keuze", method: "POST", path: `/api/stemmingen/${FIX.stemmingStemmen}/stemmen`, rol: "bestuurder", body: LEEG, verwacht: "json" },
  { slug: "w4.stemmen.post.bestuurder.404", method: "POST", path: `/api/stemmingen/${FIX.stemmingOnbekend}/stemmen`, rol: "bestuurder", body: { keuze: "voor" }, verwacht: "json" },
  {
    slug: "w4.stemmen.post.bestuurder.400-gesloten",
    method: "POST", path: `/api/stemmingen/${FIX.stemmingGesloten}/stemmen`, rol: "bestuurder",
    body: { keuze: "voor" }, verwacht: "json",
    preseed: async ({ admin, users }) => zetStemming(admin, users, FIX.stemmingGesloten, "gesloten", FIX.agendapuntGesloten),
  },
  {
    // Bureau-gate (BB-12) — `eigenProfiel?.rol` -> ctx.rol.
    slug: "w4.stemmen.post.bestuursbureau.403",
    method: "POST", path: `/api/stemmingen/${FIX.stemmingStemmen}/stemmen`, rol: "bestuursbureau",
    body: { keuze: "voor" }, verwacht: "json",
    preseed: async ({ admin, users }) => zetStemming(admin, users, FIX.stemmingStemmen, "open", FIX.agendapuntStemmen),
  },
  {
    slug: "w4.stemmen.post.bestuurder.200",
    method: "POST", path: `/api/stemmingen/${FIX.stemmingStemmen}/stemmen`, rol: "bestuurder",
    body: { keuze: "voor", motivering: "W4" }, verwacht: "json",
    // De stem is uniek per (stemming, stemgerechtigde): zonder opruimen levert
    // de tweede run het WIJZIGEN-pad op i.p.v. het insert-pad.
    preseed: async ({ admin, users }) => {
      await zetStemming(admin, users, FIX.stemmingStemmen, "open", FIX.agendapuntStemmen);
      await wis(admin, "stem_uitbrengingen", { stemming_id: FIX.stemmingStemmen });
    },
  },

  // ── /api/stemmingen/[id]/sluiten — POST · 403-starter · 200 ───────────────
  { slug: "w4.stemmingen-sluiten.post.anon", method: "POST", path: `/api/stemmingen/${FIX.stemmingSluiten}/sluiten`, rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "w4.stemmingen-sluiten.post.bestuurder.404", method: "POST", path: `/api/stemmingen/${FIX.stemmingOnbekend}/sluiten`, rol: "bestuurder", body: LEEG, verwacht: "json" },
  {
    slug: "w4.stemmingen-sluiten.post.bestuursbureau.403",
    method: "POST", path: `/api/stemmingen/${FIX.stemmingSluiten}/sluiten`, rol: "bestuursbureau",
    body: LEEG, verwacht: "json",
    preseed: async ({ admin, users }) => zetStemming(admin, users, FIX.stemmingSluiten, "open", FIX.agendapuntSluiten),
  },
  {
    // Bestuurder is niet de starter (voorzitter opende) en niet privileged.
    slug: "w4.stemmingen-sluiten.post.bestuurder.403-starter",
    method: "POST", path: `/api/stemmingen/${FIX.stemmingSluiten}/sluiten`, rol: "bestuurder",
    body: LEEG, verwacht: "json",
    preseed: async ({ admin, users }) => zetStemming(admin, users, FIX.stemmingSluiten, "open", FIX.agendapuntSluiten),
  },
  {
    slug: "w4.stemmingen-sluiten.post.voorzitter.200",
    method: "POST", path: `/api/stemmingen/${FIX.stemmingSluiten}/sluiten`, rol: "voorzitter",
    body: LEEG, verwacht: "json",
    preseed: async ({ admin, users }) => zetStemming(admin, users, FIX.stemmingSluiten, "open", FIX.agendapuntSluiten),
  },

  // ── /api/stemmingen/[id]/intrekken — POST · 400-niet-open · 200 ───────────
  { slug: "w4.stemmingen-intrekken.post.anon", method: "POST", path: `/api/stemmingen/${FIX.stemmingIntrekken}/intrekken`, rol: "anon", body: LEEG, verwacht: "json" },
  // De motiveringseis (>= 10 tekens) staat VOOR de lookup: dit is een 400, geen 404.
  { slug: "w4.stemmingen-intrekken.post.bestuurder.400-reden", method: "POST", path: `/api/stemmingen/${FIX.stemmingOnbekend}/intrekken`, rol: "bestuurder", body: { reden: "W4" }, verwacht: "json" },
  { slug: "w4.stemmingen-intrekken.post.bestuurder.404", method: "POST", path: `/api/stemmingen/${FIX.stemmingOnbekend}/intrekken`, rol: "bestuurder", body: { reden: "W4 onbekende stemronde" }, verwacht: "json" },
  {
    slug: "w4.stemmingen-intrekken.post.bestuurder.400-gesloten",
    method: "POST", path: `/api/stemmingen/${FIX.stemmingGesloten}/intrekken`, rol: "bestuurder",
    body: { reden: "W4 reeds gesloten ronde" }, verwacht: "json",
    preseed: async ({ admin, users }) => zetStemming(admin, users, FIX.stemmingGesloten, "gesloten", FIX.agendapuntGesloten),
  },
  {
    slug: "w4.stemmingen-intrekken.post.voorzitter.200",
    method: "POST", path: `/api/stemmingen/${FIX.stemmingIntrekken}/intrekken`, rol: "voorzitter",
    body: { reden: "W4 intrekreden" }, verwacht: "json",
    preseed: async ({ admin, users }) => zetStemming(admin, users, FIX.stemmingIntrekken, "open", FIX.agendapuntIntrekken),
  },

  // ══ agendapunten ═══════════════════════════════════════════════════════════

  // ── /api/agendapunten — POST · volgorde = max + 1 ─────────────────────────
  { slug: "w4.agendapunten.post.anon", method: "POST", path: "/api/agendapunten", rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "w4.agendapunten.post.bestuurder.400-verplicht", method: "POST", path: "/api/agendapunten", rol: "bestuurder", body: LEEG, verwacht: "json" },
  { slug: "w4.agendapunten.post.bestuurder.400-categorie", method: "POST", path: "/api/agendapunten", rol: "bestuurder", body: { vergadering_id: FIX.vergaderingNieuwAgendapunt, titel: "W4", categorie: "onzin" }, verwacht: "json" },
  {
    // NIET-IDEMPOTENT: `volgorde` is max + 1 over de vergadering. Eigen
    // vergadering + leegmaken houdt hem op 1.
    slug: "w4.agendapunten.post.voorzitter.200",
    method: "POST", path: "/api/agendapunten", rol: "voorzitter",
    body: { vergadering_id: FIX.vergaderingNieuwAgendapunt, titel: "W4 nieuw agendapunt", categorie: "informatie" },
    verwacht: "json",
    // EIGEN vergadering, los van de agendapunten die gewijzigd/verwijderd worden:
    // `agendapunt_log` is append-only met CASCADE, dus een vergadering waarop ooit
    // een agendapunt is verwijderd valt niet meer leeg te maken. De rijen die deze
    // POST zelf aanmaakt hebben geen logregel en gaan dus wél weg.
    preseed: async ({ admin }) => {
      await zetVergadering(admin, FIX.vergaderingNieuwAgendapunt, "W4 Vergadering (nieuw punt)");
      await wis(admin, "agendapunten", { vergadering_id: FIX.vergaderingNieuwAgendapunt });
    },
  },

  // ── /api/agendapunten/[id] — PATCH · DELETE · bureau-fail-safe (BB-15) ────
  {
    slug: "w4.agendapunten-id.patch.voorzitter.200",
    method: "PATCH", path: `/api/agendapunten/${FIX.agendapuntWijzigen}`, rol: "voorzitter",
    body: { titel: "W4 gewijzigde titel" }, verwacht: "json",
    preseed: async ({ admin, users }) => zetAgendapunt(admin, users, FIX.agendapuntWijzigen),
  },
  {
    // Bestuurder is niet de aanmaker (voorzitter is dat) en niet privileged.
    slug: "w4.agendapunten-id.patch.bestuurder.403",
    method: "PATCH", path: `/api/agendapunten/${FIX.agendapuntWijzigen}`, rol: "bestuurder",
    body: { titel: "W4 mag niet" }, verwacht: "json",
    preseed: async ({ admin, users }) => zetAgendapunt(admin, users, FIX.agendapuntWijzigen),
  },
  {
    // Bureau: de motiveringsplicht is voor deze rol fail-safe AAN (BB-15). Dit
    // scenario dekt de respons die daaruit volgt; BB-15 dekt de regel statisch.
    slug: "w4.agendapunten-id.patch.bestuursbureau",
    method: "PATCH", path: `/api/agendapunten/${FIX.agendapuntWijzigen}`, rol: "bestuursbureau",
    body: { titel: "W4 bureau" }, verwacht: "json",
    preseed: async ({ admin, users }) => zetAgendapunt(admin, users, FIX.agendapuntWijzigen),
  },
  {
    slug: "w4.agendapunten-id.delete.voorzitter.200",
    method: "DELETE", path: `/api/agendapunten/${FIX.agendapuntVerwijderen}`, rol: "voorzitter",
    body: { reden: "W4 verwijderreden voor de karakterisering" }, verwacht: "json",
    preseed: async ({ admin, users }) => zetAgendapunt(admin, users, FIX.agendapuntVerwijderen),
  },

  // ── /api/agendapunten/[id]/voorbereiding/notities — PATCH · upsert-pad ────
  { slug: "w4.notities.patch.anon", method: "PATCH", path: `/api/agendapunten/${FIX.agendapuntNotities}/voorbereiding/notities`, rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "w4.notities.patch.bestuurder.400", method: "PATCH", path: `/api/agendapunten/${FIX.agendapuntNotities}/voorbereiding/notities`, rol: "bestuurder", body: LEEG, verwacht: "json" },
  { slug: "w4.notities.patch.bestuurder.404", method: "PATCH", path: `/api/agendapunten/${FIX.agendapuntOnbekend}/voorbereiding/notities`, rol: "bestuurder", body: { vrije_notities: "W4" }, verwacht: "json" },
  {
    // De route doet update-of-insert. Zonder opruimen legt run 2 het UPDATE-pad
    // vast waar run 1 het INSERT-pad vastlegde.
    slug: "w4.notities.patch.bestuurder.200",
    method: "PATCH", path: `/api/agendapunten/${FIX.agendapuntNotities}/voorbereiding/notities`, rol: "bestuurder",
    body: { vrije_notities: "W4 notitie" }, verwacht: "json",
    preseed: async ({ admin, users }) => {
      await zetAgendapunt(admin, users, FIX.agendapuntNotities);
      await wis(admin, "voorbereidingen", { agendapunt_id: FIX.agendapuntNotities });
    },
  },

  // ══ vergaderingen ══════════════════════════════════════════════════════════
  { slug: "w4.vergaderingen.post.anon", method: "POST", path: "/api/vergaderingen", rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "w4.vergaderingen.post.bestuurder.400", method: "POST", path: "/api/vergaderingen", rol: "bestuurder", body: LEEG, verwacht: "json" },
  {
    // NIET-IDEMPOTENT: elke run maakt een nieuwe rij. Opruimen op TITEL, niet op
    // fonds: de andere vergaderingfixtures hebben `vergadering_log`-regels en
    // zijn daardoor onverwijderbaar.
    slug: "w4.vergaderingen.post.voorzitter.200",
    method: "POST", path: "/api/vergaderingen", rol: "voorzitter",
    body: { titel: "W4 nieuwe vergadering", datum: "2026-04-01T10:00:00Z" }, verwacht: "json",
    preseed: async ({ admin }) => wis(admin, "vergaderingen", { titel: "W4 nieuwe vergadering" }),
  },

  { slug: "w4.vergaderingen-id.patch.anon", method: "PATCH", path: `/api/vergaderingen/${FIX.vergaderingOnbekend}`, rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "w4.vergaderingen-id.patch.bestuurder.404", method: "PATCH", path: `/api/vergaderingen/${FIX.vergaderingOnbekend}`, rol: "bestuurder", body: { titel: "x" }, verwacht: "json" },
  {
    // Bestuurder is niet de aanmaker (voorzitter is dat) en niet privileged.
    slug: "w4.vergaderingen-id.patch.bestuurder.403",
    method: "PATCH", path: `/api/vergaderingen/${FIX.vergaderingWijzigen}`, rol: "bestuurder",
    body: { titel: "W4 mag niet" }, verwacht: "json",
    preseed: async ({ admin, users }) => zetVergaderingFixture(admin, users, FIX.vergaderingWijzigen),
  },
  {
    slug: "w4.vergaderingen-id.patch.voorzitter.400-geen-wijziging",
    method: "PATCH", path: `/api/vergaderingen/${FIX.vergaderingWijzigen}`, rol: "voorzitter",
    body: LEEG, verwacht: "json",
    preseed: async ({ admin, users }) => zetVergaderingFixture(admin, users, FIX.vergaderingWijzigen),
  },
  {
    slug: "w4.vergaderingen-id.patch.voorzitter.200",
    method: "PATCH", path: `/api/vergaderingen/${FIX.vergaderingWijzigen}`, rol: "voorzitter",
    body: { titel: "W4 gewijzigde vergadertitel" }, verwacht: "json",
    preseed: async ({ admin, users }) => zetVergaderingFixture(admin, users, FIX.vergaderingWijzigen),
  },

  { slug: "w4.vergaderingen-archief.post.anon", method: "POST", path: `/api/vergaderingen/${FIX.vergaderingArchief}/archief`, rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "w4.vergaderingen-archief.post.bestuurder.404", method: "POST", path: `/api/vergaderingen/${FIX.vergaderingOnbekend}/archief`, rol: "bestuurder", body: { actie: "archiveren" }, verwacht: "json" },
  {
    slug: "w4.vergaderingen-archief.post.voorzitter.200",
    method: "POST", path: `/api/vergaderingen/${FIX.vergaderingArchief}/archief`, rol: "voorzitter",
    body: { actie: "archiveren" }, verwacht: "json",
    preseed: async ({ admin, users }) => zetVergaderingFixture(admin, users, FIX.vergaderingArchief),
  },
  {
    // Tweede keer archiveren op een al gearchiveerde vergadering -> 400.
    slug: "w4.vergaderingen-archief.post.voorzitter.400-al-gearchiveerd",
    method: "POST", path: `/api/vergaderingen/${FIX.vergaderingArchief}/archief`, rol: "voorzitter",
    body: { actie: "archiveren" }, verwacht: "json",
    preseed: async ({ admin, users }) =>
      zetVergaderingFixture(admin, users, FIX.vergaderingArchief, {
        gearchiveerd_op: "2026-03-02T10:00:00Z",
        gearchiveerd_door: users.voorzitter.userId,
      }),
  },

  // ══ inbreng ════════════════════════════════════════════════════════════════
  { slug: "w4.inbreng.post.anon", method: "POST", path: "/api/inbreng", rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "w4.inbreng.post.bestuurder.400", method: "POST", path: "/api/inbreng", rol: "bestuurder", body: LEEG, verwacht: "json" },
  {
    // Bureau-gate (BB-12) — `profiel?.rol` -> ctx.rol.
    slug: "w4.inbreng.post.bestuursbureau.403",
    method: "POST", path: "/api/inbreng", rol: "bestuursbureau",
    body: { agendapunt_id: FIX.agendapuntInbreng, tekst: "W4 bureau-inbreng" }, verwacht: "json",
    preseed: async ({ admin, users }) => zetAgendapunt(admin, users, FIX.agendapuntInbreng),
  },
  {
    slug: "w4.inbreng.post.bestuurder.200",
    method: "POST", path: "/api/inbreng", rol: "bestuurder",
    body: { agendapunt_id: FIX.agendapuntInbreng, tekst: "W4 inbreng" }, verwacht: "json",
    preseed: async ({ admin, users }) => {
      await zetAgendapunt(admin, users, FIX.agendapuntInbreng);
      await wis(admin, "agendapunt_inbreng", { agendapunt_id: FIX.agendapuntInbreng });
    },
  },

  { slug: "w4.inbreng-id.delete.anon", method: "DELETE", path: `/api/inbreng/${FIX.inbrengOnbekend}`, rol: "anon", verwacht: "json" },
  { slug: "w4.inbreng-id.delete.bestuursbureau.403", method: "DELETE", path: `/api/inbreng/${FIX.inbrengOnbekend}`, rol: "bestuursbureau", verwacht: "json" },
  { slug: "w4.inbreng-id.delete.bestuurder.404", method: "DELETE", path: `/api/inbreng/${FIX.inbrengOnbekend}`, rol: "bestuurder", verwacht: "json" },
  {
    // Voorzitter probeert andermans inbreng te verwijderen -> 403.
    slug: "w4.inbreng-id.delete.voorzitter.403-niet-eigen",
    method: "DELETE", path: `/api/inbreng/${FIX.inbreng1}`, rol: "voorzitter", verwacht: "json",
    preseed: async ({ admin, users }) => zetInbreng(admin, users),
  },
  {
    slug: "w4.inbreng-id.delete.bestuurder.200",
    method: "DELETE", path: `/api/inbreng/${FIX.inbreng1}`, rol: "bestuurder", verwacht: "json",
    preseed: async ({ admin, users }) => zetInbreng(admin, users),
  },

  // ══ notulen ════════════════════════════════════════════════════════════════
  //  BEWUSTE LACUNE (§4): de happy paths van segmenteren en bevestigen zijn NIET
  //  gekarakteriseerd. Ze vereisen een echt notulendocument in storage plus een
  //  modelcall; dat herhaalbaar maken kost meer dan het oplevert, en de
  //  AI-routes staan sowieso in W5. De afwijzingspaden dekken wat de codemod
  //  hier raakt: de preambule, de capability-gate en de rate limit.
  //  Beide begrensde routes wissen hun teller in de preseed — anders slaat de
  //  respons in verify-ronde 2 of 3 om naar 429.
  { slug: "w4.notulen-segmenteer.post.anon", method: "POST", path: `/api/notulen/${FIX.documentOnbekend}/segmenteer`, rol: "anon", body: LEEG, verwacht: "json" },
  {
    slug: "w4.notulen-segmenteer.post.bestuurder.403-capability",
    method: "POST", path: `/api/notulen/${FIX.documentOnbekend}/segmenteer`, rol: "bestuurder",
    body: LEEG, verwacht: "json",
    preseed: async ({ admin }) => wisLimiet(admin, "segmenteer"),
  },
  {
    slug: "w4.notulen-segmenteer.post.voorzitter.404",
    method: "POST", path: `/api/notulen/${FIX.documentOnbekend}/segmenteer`, rol: "voorzitter",
    body: LEEG, verwacht: "json",
    preseed: async ({ admin }) => wisLimiet(admin, "segmenteer"),
  },
  {
    // Bestaand document, maar documenttype != 'notulen' -> 400.
    slug: "w4.notulen-segmenteer.post.voorzitter.400-geen-notulen",
    method: "POST", path: `/api/notulen/${FIX.document1}/segmenteer`, rol: "voorzitter",
    body: LEEG, verwacht: "json",
    preseed: async ({ admin }) => wisLimiet(admin, "segmenteer"),
  },

  { slug: "w4.notulen-bevestig.post.anon", method: "POST", path: `/api/notulen/segmenten/${FIX.segmentOnbekend}/bevestig`, rol: "anon", body: LEEG, verwacht: "json" },
  {
    slug: "w4.notulen-bevestig.post.bestuurder.403-capability",
    method: "POST", path: `/api/notulen/segmenten/${FIX.segmentOnbekend}/bevestig`, rol: "bestuurder",
    body: LEEG, verwacht: "json",
    preseed: async ({ admin }) => wisLimiet(admin, "notulen_bevestig"),
  },
  {
    // Zonder Idempotency-Key stopt de route VOOR de lookup: 400, geen 404.
    slug: "w4.notulen-bevestig.post.voorzitter.400-idempotency",
    method: "POST", path: `/api/notulen/segmenten/${FIX.segmentOnbekend}/bevestig`, rol: "voorzitter",
    body: LEEG, verwacht: "json",
    preseed: async ({ admin }) => wisLimiet(admin, "notulen_bevestig"),
  },
  {
    // MET sleutel wordt de lookup wél bereikt -> 404. Vaste sleutel: het
    // idempotentieregister is per (gebruiker, sleutel), en een wisselende
    // sleutel zou elke run een nieuwe reservering aanmaken.
    slug: "w4.notulen-bevestig.post.voorzitter.404",
    method: "POST", path: `/api/notulen/segmenten/${FIX.segmentOnbekend}/bevestig`, rol: "voorzitter",
    body: LEEG, verwacht: "json",
    headers: { "content-type": "application/json", "idempotency-key": "w4-karakterisering-bevestig" },
    preseed: async ({ admin }) => wisLimiet(admin, "notulen_bevestig"),
  },

  { slug: "w4.notulen-segment.patch.anon", method: "PATCH", path: `/api/notulen/segmenten/${FIX.segmentOnbekend}`, rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "w4.notulen-segment.patch.bestuurder.403-capability", method: "PATCH", path: `/api/notulen/segmenten/${FIX.segmentOnbekend}`, rol: "bestuurder", body: LEEG, verwacht: "json" },
  { slug: "w4.notulen-segment.patch.voorzitter.404", method: "PATCH", path: `/api/notulen/segmenten/${FIX.segmentOnbekend}`, rol: "voorzitter", body: { titel: "W4" }, verwacht: "json" },
  { slug: "w4.notulen-segment.delete.anon", method: "DELETE", path: `/api/notulen/segmenten/${FIX.segmentOnbekend}`, rol: "anon", verwacht: "json" },
  { slug: "w4.notulen-segment.delete.bestuurder.403-capability", method: "DELETE", path: `/api/notulen/segmenten/${FIX.segmentOnbekend}`, rol: "bestuurder", verwacht: "json" },
  // BEVINDING (observatielijst): een onbekend segment geeft hier 500
  // "Verwijderen mislukt", niet 404 — de RPC gooit en de route vertaalt dat niet.
  // Vastgelegd zoals het IS; repareren is deploy 3, niet W4.
  { slug: "w4.notulen-segment.delete.voorzitter.500-onbekend", method: "DELETE", path: `/api/notulen/segmenten/${FIX.segmentOnbekend}`, rol: "voorzitter", verwacht: "json" },

  // ══ documents ══════════════════════════════════════════════════════════════
  //  Drie routes in dit domein hebben GEEN eigen try/catch — daar wordt de
  //  wrapper de eerste vanger. Het verschil in foutrespons is apart gemeten en
  //  vastgelegd in de migratiecommit; het is niet als scenario op te nemen omdat
  //  het een geïnjecteerde exception vereist.
  //  Vier routes zijn fail-closed begrensd; die wissen hun teller (§4, derde
  //  faalvorm: een teller draagt staat over tussen verify-rondes).
  //
  //  OBSERVATIE: er is hier geen enkel 403-scenario op `documents.metadata.update`,
  //  en dat is geen omissie in de dekking. Die capability is aan ALLE VIER de
  //  rollen toegekend — inclusief bestuursbureau — dus hij scheidt niets. Wat
  //  eruitziet als een autorisatiepoort is er feitelijk geen. Staat op de
  //  observatielijst; repareren is deploy 3.

  // ── documents/[id] — PATCH · de-/reactiveren · 409 ────────────────────────
  { slug: "w4.documents-id.patch.anon", method: "PATCH", path: `/api/documents/${FIX.documentOnbekend}`, rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "w4.documents-id.patch.bestuurder.400-actie", method: "PATCH", path: `/api/documents/${FIX.documentOnbekend}`, rol: "bestuurder", body: { actie: "onzin" }, verwacht: "json" },
  { slug: "w4.documents-id.patch.bestuurder.404", method: "PATCH", path: `/api/documents/${FIX.documentOnbekend}`, rol: "bestuurder", body: { actie: "deactiveren" }, verwacht: "json" },
  {
    slug: "w4.documents-id.patch.bestuurder.403-reactiveren",
    method: "PATCH", path: `/api/documents/${FIX.documentGedeactiveerd}`, rol: "bestuurder",
    body: { actie: "reactiveren" }, verwacht: "json",
    preseed: async ({ admin }) => zetDocument(admin, FIX.documentGedeactiveerd, false),
  },
  {
    slug: "w4.documents-id.patch.voorzitter.200-deactiveren",
    method: "PATCH", path: `/api/documents/${FIX.documentDeactiveren}`, rol: "voorzitter",
    body: { actie: "deactiveren", reden: "W4 deactiveerreden" }, verwacht: "json",
    preseed: async ({ admin }) => zetDocument(admin, FIX.documentDeactiveren, true),
  },
  {
    slug: "w4.documents-id.patch.voorzitter.409-al-gedeactiveerd",
    method: "PATCH", path: `/api/documents/${FIX.documentGedeactiveerd}`, rol: "voorzitter",
    body: { actie: "deactiveren", reden: "W4 nogmaals" }, verwacht: "json",
    preseed: async ({ admin }) => zetDocument(admin, FIX.documentGedeactiveerd, false),
  },

  // ── documents/[id]/metadata — GET + PATCH ─────────────────────────────────
  { slug: "w4.documents-metadata.get.anon", method: "GET", path: `/api/documents/${FIX.document1}/metadata`, rol: "anon", verwacht: "json" },
  { slug: "w4.documents-metadata.get.bestuurder", method: "GET", path: `/api/documents/${FIX.document1}/metadata`, rol: "bestuurder", verwacht: "json" },
  { slug: "w4.documents-metadata.get.bestuurder.404", method: "GET", path: `/api/documents/${FIX.documentOnbekend}/metadata`, rol: "bestuurder", verwacht: "json" },
  { slug: "w4.documents-metadata.patch.anon", method: "PATCH", path: `/api/documents/${FIX.document1}/metadata`, rol: "anon", body: LEEG, verwacht: "json" },
  // `titel` is geen metadataveld hier; de plan-bouwer ziet nul wijzigingen -> 400.
  { slug: "w4.documents-metadata.patch.bestuurder.400-geen-wijzigingen", method: "PATCH", path: `/api/documents/${FIX.document1}/metadata`, rol: "bestuurder", body: { titel: "W4" }, verwacht: "json" },
  { slug: "w4.documents-metadata.patch.voorzitter.404", method: "PATCH", path: `/api/documents/${FIX.documentOnbekend}/metadata`, rol: "voorzitter", body: { titel: "W4" }, verwacht: "json" },

  // ── documents/[id]/ai-markering — PATCH ───────────────────────────────────
  { slug: "w4.documents-aimarkering.patch.anon", method: "PATCH", path: `/api/documents/${FIX.document1}/ai-markering`, rol: "anon", body: LEEG, verwacht: "json" },
  // Het veld heet `markering` en moet een boolean zijn.
  { slug: "w4.documents-aimarkering.patch.voorzitter.200", method: "PATCH", path: `/api/documents/${FIX.document1}/ai-markering`, rol: "voorzitter", body: { markering: true }, verwacht: "json" },
  { slug: "w4.documents-aimarkering.patch.voorzitter.400-waarde", method: "PATCH", path: `/api/documents/${FIX.document1}/ai-markering`, rol: "voorzitter", body: { markering: "onzin" }, verwacht: "json" },
  { slug: "w4.documents-aimarkering.patch.voorzitter.400-id", method: "PATCH", path: "/api/documents/geen-uuid/ai-markering", rol: "voorzitter", body: { ai_gegenereerd: true }, verwacht: "json" },

  // ── documents/[id]/agendapunten — GET + POST + DELETE ─────────────────────
  { slug: "w4.documents-agendapunten.get.anon", method: "GET", path: `/api/documents/${FIX.document1}/agendapunten`, rol: "anon", verwacht: "json" },
  { slug: "w4.documents-agendapunten.get.bestuurder", method: "GET", path: `/api/documents/${FIX.document1}/agendapunten`, rol: "bestuurder", verwacht: "json" },
  { slug: "w4.documents-agendapunten.post.anon", method: "POST", path: `/api/documents/${FIX.document1}/agendapunten`, rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "w4.documents-agendapunten.post.bestuurder.404-agendapunt", method: "POST", path: `/api/documents/${FIX.document1}/agendapunten`, rol: "bestuurder", body: { agendapunt_id: FIX.agendapuntOnbekend }, verwacht: "json" },
  { slug: "w4.documents-agendapunten.post.voorzitter.400", method: "POST", path: `/api/documents/${FIX.document1}/agendapunten`, rol: "voorzitter", body: LEEG, verwacht: "json" },
  { slug: "w4.documents-agendapunten.post.voorzitter.404", method: "POST", path: `/api/documents/${FIX.documentOnbekend}/agendapunten`, rol: "voorzitter", body: { agendapunt_id: FIX.agendapuntOnbekend }, verwacht: "json" },
  { slug: "w4.documents-agendapunten.delete.anon", method: "DELETE", path: `/api/documents/${FIX.document1}/agendapunten?agendapunt_id=${FIX.agendapuntOnbekend}`, rol: "anon", verwacht: "json" },
  // De DELETE leest agendapunt_id uit de BODY, niet uit de query — vandaar 400.
  { slug: "w4.documents-agendapunten.delete.bestuurder.400-ontbreekt", method: "DELETE", path: `/api/documents/${FIX.document1}/agendapunten?agendapunt_id=${FIX.agendapuntOnbekend}`, rol: "bestuurder", verwacht: "json" },

  // ── documents/[id]/procesinstanties — GET + POST + DELETE ─────────────────
  { slug: "w4.documents-procesinstanties.get.anon", method: "GET", path: `/api/documents/${FIX.document1}/procesinstanties`, rol: "anon", verwacht: "json" },
  { slug: "w4.documents-procesinstanties.get.bestuurder", method: "GET", path: `/api/documents/${FIX.document1}/procesinstanties`, rol: "bestuurder", verwacht: "json" },
  { slug: "w4.documents-procesinstanties.post.anon", method: "POST", path: `/api/documents/${FIX.document1}/procesinstanties`, rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "w4.documents-procesinstanties.post.bestuurder.400-ontbreekt", method: "POST", path: `/api/documents/${FIX.document1}/procesinstanties`, rol: "bestuurder", body: LEEG, verwacht: "json" },
  { slug: "w4.documents-procesinstanties.post.voorzitter.400", method: "POST", path: `/api/documents/${FIX.document1}/procesinstanties`, rol: "voorzitter", body: LEEG, verwacht: "json" },
  { slug: "w4.documents-procesinstanties.delete.anon", method: "DELETE", path: `/api/documents/${FIX.document1}/procesinstanties`, rol: "anon", verwacht: "json" },

  // ── documents/[id]/her-extract + opnieuw-verwerken — GEEN eigen try/catch ──
  { slug: "w4.documents-herextract.post.anon", method: "POST", path: `/api/documents/${FIX.documentOnbekend}/her-extract`, rol: "anon", body: LEEG, verwacht: "json" },
  {
    slug: "w4.documents-herextract.post.bestuurder.403",
    method: "POST", path: `/api/documents/${FIX.documentOnbekend}/her-extract`, rol: "bestuurder",
    body: LEEG, verwacht: "json",
    preseed: async ({ admin }) => wisLimiet(admin, "her_extract"),
  },
  {
    slug: "w4.documents-herextract.post.voorzitter.404",
    method: "POST", path: `/api/documents/${FIX.documentOnbekend}/her-extract`, rol: "voorzitter",
    body: LEEG, verwacht: "json",
    preseed: async ({ admin }) => wisLimiet(admin, "her_extract"),
  },
  { slug: "w4.documents-opnieuw.post.anon", method: "POST", path: `/api/documents/${FIX.documentOnbekend}/opnieuw-verwerken`, rol: "anon", body: LEEG, verwacht: "json" },
  {
    slug: "w4.documents-opnieuw.post.bestuurder.403",
    method: "POST", path: `/api/documents/${FIX.documentOnbekend}/opnieuw-verwerken`, rol: "bestuurder",
    body: LEEG, verwacht: "json",
    preseed: async ({ admin }) => wisLimiet(admin, "her_extract"),
  },
  {
    slug: "w4.documents-opnieuw.post.voorzitter.404",
    method: "POST", path: `/api/documents/${FIX.documentOnbekend}/opnieuw-verwerken`, rol: "voorzitter",
    body: LEEG, verwacht: "json",
    preseed: async ({ admin }) => wisLimiet(admin, "her_extract"),
  },

  // ── documents/bulk-metadata + de twee backfills ───────────────────────────
  { slug: "w4.documents-bulkmetadata.post.anon", method: "POST", path: "/api/documents/bulk-metadata", rol: "anon", body: LEEG, verwacht: "json" },
  {
    slug: "w4.documents-bulkmetadata.post.voorzitter.400-geen-ids",
    method: "POST", path: "/api/documents/bulk-metadata", rol: "voorzitter",
    body: { document_ids: [] }, verwacht: "json",
    preseed: async ({ admin }) => wisLimiet(admin, "bulk_metadata"),
  },
  { slug: "w4.documents-embeddings.post.anon", method: "POST", path: "/api/documents/embeddings-backfill", rol: "anon", body: LEEG, verwacht: "json" },
  {
    slug: "w4.documents-embeddings.post.bestuurder.403",
    method: "POST", path: "/api/documents/embeddings-backfill", rol: "bestuurder",
    body: LEEG, verwacht: "json",
    preseed: async ({ admin }) => wisLimiet(admin, "backfill"),
  },
  { slug: "w4.documents-reindex.post.anon", method: "POST", path: "/api/documents/reindex-backfill", rol: "anon", body: LEEG, verwacht: "json" },
  // ── documents/upload — HANDWERK.
  //  BESLUIT (W4, #96) — DE ENIGE RESPONS-ZICHTBARE GEDRAGSVERANDERING IN W4.
  //  Vóór de migratie parseerde de POST de request-body VOOR de sessiecontrole:
  //  een anonieme aanvraag met kapotte JSON kreeg 400 "Ongeldige aanvraag
  //  (verwacht JSON)". De wrapper draait auth per definitie eerst, dus dat is nu
  //  401 "Niet ingelogd".
  //
  //  Onvermijdelijk: de wrapper omhult de hele handler, dus de parse kan niet
  //  vóór de auth blijven zonder de route buiten de wrapper te houden.
  //  Verdedigbaar: 401 is wat de 76 andere routes een anonieme beller geven, en
  //  parse-feedback aan een niet-ingelogde beller is geen verlies.
  //  Deze snapshot is bewust BIJGEWERKT — de baseline met 400 staat in de
  //  voorgaande commit, dus het verschil is uit de historie af te lezen.
  { slug: "w4.documents-upload.post.anon.kapotte-json", method: "POST", path: "/api/documents/upload", rol: "anon", rawBody: "{dit is geen json", headers: { "content-type": "application/json" }, verwacht: "json" },
  { slug: "w4.documents-upload.post.anon", method: "POST", path: "/api/documents/upload", rol: "anon", body: LEEG, verwacht: "json" },
  { slug: "w4.documents-upload.get.anon", method: "GET", path: "/api/documents/upload", rol: "anon", verwacht: "json" },
  { slug: "w4.documents-upload.get.bestuurder", method: "GET", path: "/api/documents/upload", rol: "bestuurder", verwacht: "json" },
  {
    slug: "w4.documents-upload.post.bestuurder.400-bestandsnaam",
    method: "POST", path: "/api/documents/upload", rol: "bestuurder",
    body: { mode: "init", bestandsnaam: "", grootte: 10 }, verwacht: "json",
    preseed: async ({ admin }) => wisLimiet(admin, "upload"),
  },
  {
    slug: "w4.documents-reindex.post.bestuurder.403",
    method: "POST", path: "/api/documents/reindex-backfill", rol: "bestuurder",
    body: LEEG, verwacht: "json",
    preseed: async ({ admin }) => wisLimiet(admin, "backfill"),
  },
];
