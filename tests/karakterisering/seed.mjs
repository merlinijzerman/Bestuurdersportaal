// ============================================================================
//  W1 — Deterministische seed.
// ----------------------------------------------------------------------------
//  Eén fonds, vier gebruikers (één per rol) met expliciete profielen-rij, en
//  (in latere tiers) een vaste set domein-fixtures met vaste UUID's.
//
//  Idempotent: `seed()` ruimt eerst de eigen testgebruikers en fonds-rijen op en
//  bouwt daarna vers op. Auth-user-UUID's variëren per run (GoTrue); de
//  normalisatielaag mapt ze. Domein-UUID's zijn vast.
// ============================================================================
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { ENV, FONDS_ID, ROLLEN, WACHTWOORD, emailVoor, FIX, DOCUMENT1_BYTES, DOCUMENT1_PAD, AFSCHRIFT1_PAD } from "./config.mjs";

// ── W4-BESLUIT: elke delete wordt gecontroleerd ─────────────────────────────
//  Het defect dat W4 blootlegde bij `seedRisicos` was niet de append-only
//  cascade maar de ONGECONTROLEERDE delete. Daardoor kwam een geblokkeerde
//  opruiming eruit als een duplicate-key op de insert erna — twee stappen
//  verderop, met een melding die niets zegt over de oorzaak. Een gecontroleerde
//  delete faalt op de plek waar het misgaat, met de reden erbij.
//
//  Sweep over alle seed*-functies (W4): zes ongecontroleerde deletes en één
//  ongecontroleerde storage-remove. Alle zeven lopen nu hierlangs.
async function wis(admin, tabel, kolom, waarde) {
  const { error } = await admin.from(tabel).delete().eq(kolom, waarde);
  if (error) throw new Error(`delete ${tabel}: ${error.message}`);
}

export function adminClient() {
  return createClient(ENV.url, ENV.serviceKey, { auth: { persistSession: false } });
}

async function vindGebruikerOpEmail(admin, email) {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email ?? "") === email);
    if (hit) return hit;
    if (users.length < 200) return null;
  }
  return null;
}

// Hergebruik de testgebruiker als hij al bestaat (idempotent zonder delete):
// side-effectrijen (append-only logs, gesprekken) verwijzen via FK naar de
// user-id, dus users verwijderen faalt na de eerste run. Hergebruik houdt de
// auth-UUID ook stabiel — nog steeds gedekt door de UUID-normalisatie.
async function vindOfMaakGebruiker(admin, rol) {
  const email = emailVoor(rol);
  const bestaand = await vindGebruikerOpEmail(admin, email);
  if (bestaand) {
    const { error } = await admin.auth.admin.updateUserById(bestaand.id, {
      password: WACHTWOORD,
      app_metadata: { ...(bestaand.app_metadata ?? {}), fonds_id: FONDS_ID },
    });
    if (error) throw new Error(`updateUserById(${rol}, hergebruik): ${error.message}`);
    return { rol, email, password: WACHTWOORD, userId: bestaand.id };
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: WACHTWOORD,
    email_confirm: true,
    app_metadata: { fonds_id: FONDS_ID },
    user_metadata: { naam: `W1 ${rol}` },
  });
  if (error) throw new Error(`createUser(${rol}): ${error.message}`);
  const userId = data.user.id;
  // GoTrue toont app_metadata niet betrouwbaar tijdens de insert-trigger.
  const { error: mErr } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { ...(data.user.app_metadata ?? {}), fonds_id: FONDS_ID },
  });
  if (mErr) throw new Error(`updateUserById(${rol}): ${mErr.message}`);
  return { rol, email, password: WACHTWOORD, userId };
}

/**
 * Bouwt de volledige seed op en geeft de fixture-verwijzingen terug.
 * @returns {Promise<{fondsId:string, users:Record<string,{email,password,userId,rol}>}>}
 */
export async function seed(admin = adminClient()) {
  // 1. Fonds.
  {
    const { error } = await admin
      .from("fondsen")
      .upsert({ id: FONDS_ID, naam: "Testfonds W1", slug: "testfonds-w1" }, { onConflict: "id" });
    if (error) throw new Error(`fondsen: ${error.message}`);
  }

  // 2. Gebruikers + profielen (één per rol) — hergebruik indien aanwezig.
  const users = {};
  for (const rol of ROLLEN) {
    const u = await vindOfMaakGebruiker(admin, rol);
    users[rol] = u;
    const { error } = await admin
      .from("profielen")
      .upsert(
        { id: u.userId, fonds_id: FONDS_ID, naam: `W1 ${rol}`, rol },
        { onConflict: "id" }
      );
    if (error) throw new Error(`profielen(${rol}): ${error.message}`);
  }

  // 4. Domein-fixtures (tier 2).
  await seedDocumenten(admin);
  await seedCatalogus(admin);
  await seedRisicos(admin);
  await seedGesprekken(admin, users);
  await seedProcedures(admin);
  await seedAfschrift(admin);
  await seedAgendapunten(admin, users);

  return { fondsId: FONDS_ID, users };
}

// ── W2-pilot: vergadering + agendapunten (herstellen-route) ─────────────────
// Upsert (geen delete): agendapunt_log verwijst append-only naar agendapunt_id,
// dus deleten faalt na de eerste run. Upsert RESET verwijderd_op naar de vaste
// staat zodat de 200-herstel-run reproduceerbaar blijft.
async function seedAgendapunten(admin, users) {
  {
    const { error } = await admin.from("vergaderingen").upsert(
      { id: FIX.vergadering1, fonds_id: FONDS_ID, titel: "W1 Vergadering", datum: "2026-01-01T10:00:00Z" },
      { onConflict: "id" }
    );
    if (error) throw new Error(`vergaderingen: ${error.message}`);
  }
  {
    const { error } = await admin.from("agendapunten").upsert(
      { id: FIX.agendapunt1, vergadering_id: FIX.vergadering1, titel: "W1 Agendapunt actief", verwijderd_op: null },
      { onConflict: "id" }
    );
    if (error) throw new Error(`agendapunten(actief): ${error.message}`);
  }
  {
    const { error } = await admin.from("agendapunten").upsert(
      {
        id: FIX.agendapuntVerwijderd,
        vergadering_id: FIX.vergadering1,
        titel: "W1 Agendapunt verwijderd",
        verwijderd_op: "2026-01-02T10:00:00Z",
        verwijderd_door: users.voorzitter.userId,
        verwijder_reden: "W1 fixture",
      },
      { onConflict: "id" }
    );
    if (error) throw new Error(`agendapunten(verwijderd): ${error.message}`);
  }
}

// ── Tier 2: afschrift (307-redirect naar signed URL — BESLUIT 1) ────────────
async function seedAfschrift(admin) {
  // Storage-object in de 'afschriften'-bucket onder <fonds_id>/…
  const bytes = new TextEncoder().encode("%PDF-1.4 W1-AFSCHRIFT-FIXTURE\n");
  const up = await admin.storage
    .from("afschriften")
    .upload(AFSCHRIFT1_PAD, bytes, { contentType: "application/pdf", upsert: true });
  if (up.error) throw new Error(`storage.upload(afschrift): ${up.error.message}`);

  const { error } = await admin.from("procedure_afschriften").upsert(
    {
      id: FIX.afschrift1,
      procedure_id: FIX.procedure1,
      fonds_id: FONDS_ID,
      versie: "actueel",
      status: "gereed",
      ai_leeswijzer: false,
      opslag_pad: AFSCHRIFT1_PAD,
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`procedure_afschriften: ${error.message}`);
}

// ── Tier 2: procedures ──────────────────────────────────────────────────────
// W4-BESLUIT: `ignoreDuplicates` eraf. Geen delete — een lopende procedure is
// bewust niet verwijderbaar (trigger), en `procedure_log` + `procedure_afschriften`
// hangen er append-only met CASCADE aan. Maar de upsert moet wél RESETTEN.
//
// De oude opmerking ("inhoud verandert nooit") klopte in W1: daar raakten alleen
// leesroutes deze fixture. Het procedures-domein van W4 telt 20 routes, waarvan
// er meerdere de procedure zélf muteren (PATCH /procedures/[id], stap-status,
// heropenen, besluiten). Met `ignoreDuplicates` blijft zo'n mutatie voor ALTIJD
// staan en drijft elke latere snapshot die deze procedure leest — precies de
// volgorde-afhankelijkheid uit §4, alleen dan in de gedeelde seed.
//
// Gemeten vóór de wijziging: `titel` handmatig veranderd, seed opnieuw gedraaid,
// titel bleef veranderd.
async function seedProcedures(admin) {
  const { error } = await admin.from("procedures").upsert(
    {
      id: FIX.procedure1,
      fonds_id: FONDS_ID,
      template_code: "algemeen",
      titel: "W1 Procedure",
      status: "lopend",
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`procedures: ${error.message}`);
}

// ── Tier 2: gesprekken (eigenaar = auth.uid, dus per-run user-id) ───────────
async function seedGesprekken(admin, users) {
  await wis(admin, "gesprekken", "fonds_id", FONDS_ID);
  const { error } = await admin.from("gesprekken").insert({
    id: FIX.gesprek1,
    gebruiker_id: users.bestuurder.userId,
    fonds_id: FONDS_ID,
    titel: "W1 Gesprek",
  });
  if (error) throw new Error(`gesprekken: ${error.message}`);
}

// ── Tier 2: risico's ────────────────────────────────────────────────────────
// W4-BESLUIT: upsert i.p.v. delete-en-herbouw, net als seedAgendapunten.
// `risico_log` is append-only (trigger weigert DELETE), en `risico_log.risico_id`
// hangt met ON DELETE CASCADE aan `risicos`. Zodra één risico een auditregel heeft
// — en dat is precies wat de W4-schrijfscenario's veroorzaken — faalt de
// delete-en-herbouw. De fout van die delete werd hier NIET gecontroleerd, dus het
// gevolg was geen leesbare melding maar een duplicate-key op de daaropvolgende
// insert. Upsert reset dezelfde vaste staat zonder de logketen te raken.
async function seedRisicos(admin) {
  const { error } = await admin.from("risicos").upsert(
    {
      id: FIX.risico1,
      fonds_id: FONDS_ID,
      titel: "W1 Risico",
      categorie: "operationeel_datakwaliteit",
      kans: 3,
      impact: 3,
      niveau: "middel",
      type_risico: "structureel",
      status: "actief",
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`risicos: ${error.message}`);
}

// ── Tier 2: catalogus (procesmodellen + organen/gremia) ─────────────────────
async function seedCatalogus(admin) {
  await wis(admin, "procesmodellen", "fonds_id", FONDS_ID);
  await wis(admin, "gremia", "fonds_id", FONDS_ID);
  await wis(admin, "expertises", "fonds_id", FONDS_ID);

  {
    const { error } = await admin.from("procesmodellen").insert({
      id: FIX.procesmodel1,
      fonds_id: FONDS_ID,
      generiek_procestype: "jaarplanning",
      naam: "W1 Procesmodel",
    });
    if (error) throw new Error(`procesmodellen: ${error.message}`);
  }
  {
    const { error } = await admin.from("gremia").insert({
      id: FIX.gremium1,
      fonds_id: FONDS_ID,
      naam: "W1 Gremium",
      type: "besluitvormend",
    });
    if (error) throw new Error(`gremia: ${error.message}`);
  }
  {
    const { error } = await admin.from("expertises").insert({
      id: FIX.expertise1,
      fonds_id: FONDS_ID,
      naam: "W1 Expertise",
    });
    if (error) throw new Error(`expertises: ${error.message}`);
  }
}

// ── Tier 2: documenten ──────────────────────────────────────────────────────
// W4-BESLUIT: upsert i.p.v. delete-en-herbouw, om dezelfde reden als seedRisicos
// maar met een andere FK-vorm. `documenten` heeft twee append-only kinderen —
// `extraction_run` en `comparison_results` — en die hangen er met NO ACTION aan.
// Zodra het documents-domein van W4 één extractie of vergelijking heeft gedraaid,
// weigert Postgres de delete. Cascade zou hier niet eens helpen: beide kinderen
// dragen zelf een no-delete-trigger.
//
// Het storage-object blijft wél weggegooid worden: `upload({ upsert: true })`
// hieronder zet het toch terug, en storage kent deze beperking niet.
async function seedDocumenten(admin) {
  // Opruimen: inzage-log + storage-object. De documentrijen zelf gaan via upsert.
  await wis(admin, "document_inzage", "fonds_id", FONDS_ID);
  {
    const { error } = await admin.storage.from("documenten").remove([DOCUMENT1_PAD]);
    if (error && !/not.?found/i.test(error.message)) {
      throw new Error(`storage.remove: ${error.message}`);
    }
  }

  // Storage-object onder <fonds_id>/… zodat de fonds-RLS-leespolicy het toelaat.
  {
    const bytes = new TextEncoder().encode(DOCUMENT1_BYTES);
    const { error } = await admin.storage
      .from("documenten")
      .upload(DOCUMENT1_PAD, bytes, { contentType: "application/pdf", upsert: true });
    if (error) throw new Error(`storage.upload: ${error.message}`);
  }

  // Actief document (bytes-download happy path).
  {
    const { error } = await admin.from("documenten").upsert({
      id: FIX.document1,
      fonds_id: FONDS_ID,
      bibliotheek: "fonds",
      bron: "Intern",
      titel: "W1 Document",
      bestandsnaam: "w1-document.pdf",
      bestandstype: "pdf",
      opslag_pad: DOCUMENT1_PAD,
      actief: true,
    }, { onConflict: "id" });
    if (error) throw new Error(`documenten(actief): ${error.message}`);
  }

  // Ingetrokken document (410-pad; geen storage-object nodig — actief-check gaat voor).
  {
    const { error } = await admin.from("documenten").upsert({
      id: FIX.documentIntrekken,
      fonds_id: FONDS_ID,
      bibliotheek: "fonds",
      bron: "Intern",
      titel: "W1 Ingetrokken document",
      bestandsnaam: "w1-ingetrokken.pdf",
      bestandstype: "pdf",
      opslag_pad: `${FONDS_ID}/w1-ingetrokken.pdf`,
      actief: false,
    }, { onConflict: "id" });
    if (error) throw new Error(`documenten(intrekken): ${error.message}`);
  }
}

// Handmatig: `node --env-file=.env.local tests/karakterisering/seed.mjs`
//
// W4: `file://${process.argv[1]}` i.p.v. pathToFileURL was hier een stille no-op.
// argv[1] is het pad zoals getypt (relatief), en een absoluut pad met een spatie
// erin — zoals de checkout van dit project — wordt in een file-URL als %20
// gecodeerd. De vergelijking sloeg dus nooit aan: het gedocumenteerde commando
// eindigde zonder uitvoer én zonder foutcode, en de DB bleef ongeseed. De rest
// van de repo gebruikt al `pathToFileURL(process.argv[1]).href`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const res = await seed();
  console.log("seed klaar:", JSON.stringify({ fondsId: res.fondsId, rollen: Object.keys(res.users) }));
}
