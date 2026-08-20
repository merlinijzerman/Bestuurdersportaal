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
import { createClient } from "@supabase/supabase-js";
import { ENV, FONDS_ID, ROLLEN, WACHTWOORD, emailVoor, FIX, DOCUMENT1_BYTES, DOCUMENT1_PAD } from "./config.mjs";

export function adminClient() {
  return createClient(ENV.url, ENV.serviceKey, { auth: { persistSession: false } });
}

async function verwijderTestgebruikers(admin) {
  // Pagineer door alle gebruikers en verwijder de karakterisering-testaccounts.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const users = data?.users ?? [];
    const testers = users.filter((u) => (u.email ?? "").endsWith("@karakterisering.invalid"));
    for (const u of testers) await admin.auth.admin.deleteUser(u.id);
    if (users.length < 200) break;
  }
}

async function maakGebruiker(admin, rol) {
  const email = emailVoor(rol);
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
  // 1. Opruimen (idempotent).
  await verwijderTestgebruikers(admin);
  await admin.from("profielen").delete().eq("fonds_id", FONDS_ID);

  // 2. Fonds.
  {
    const { error } = await admin
      .from("fondsen")
      .upsert({ id: FONDS_ID, naam: "Testfonds W1", slug: "testfonds-w1" }, { onConflict: "id" });
    if (error) throw new Error(`fondsen: ${error.message}`);
  }

  // 3. Gebruikers + profielen (één per rol).
  const users = {};
  for (const rol of ROLLEN) {
    const u = await maakGebruiker(admin, rol);
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

  return { fondsId: FONDS_ID, users };
}

// ── Tier 2: documenten ──────────────────────────────────────────────────────
async function seedDocumenten(admin) {
  // Opruimen: rijen + storage-object + inzage-log van dit fonds.
  await admin.from("document_inzage").delete().eq("fonds_id", FONDS_ID);
  await admin.from("documenten").delete().eq("fonds_id", FONDS_ID);
  await admin.storage.from("documenten").remove([DOCUMENT1_PAD]);

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
    const { error } = await admin.from("documenten").insert({
      id: FIX.document1,
      fonds_id: FONDS_ID,
      bibliotheek: "fonds",
      bron: "Intern",
      titel: "W1 Document",
      bestandsnaam: "w1-document.pdf",
      bestandstype: "pdf",
      opslag_pad: DOCUMENT1_PAD,
      actief: true,
    });
    if (error) throw new Error(`documenten(actief): ${error.message}`);
  }

  // Ingetrokken document (410-pad; geen storage-object nodig — actief-check gaat voor).
  {
    const { error } = await admin.from("documenten").insert({
      id: FIX.documentIntrekken,
      fonds_id: FONDS_ID,
      bibliotheek: "fonds",
      bron: "Intern",
      titel: "W1 Ingetrokken document",
      bestandsnaam: "w1-ingetrokken.pdf",
      bestandstype: "pdf",
      opslag_pad: `${FONDS_ID}/w1-ingetrokken.pdf`,
      actief: false,
    });
    if (error) throw new Error(`documenten(intrekken): ${error.message}`);
  }
}

// Handmatig: `node --env-file=.env.local tests/karakterisering/seed.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const res = await seed();
  console.log("seed klaar:", JSON.stringify({ fondsId: res.fondsId, rollen: Object.keys(res.users) }));
}
