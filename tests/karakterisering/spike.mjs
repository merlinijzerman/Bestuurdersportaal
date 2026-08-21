// ============================================================================
//  W1 — SPIKE: bewijs de sessie→cookie-brug end-to-end.
// ----------------------------------------------------------------------------
//  1. Seed minimaal: 1 fonds + 1 gebruiker (rol bestuurder) + 1 profiel.
//  2. Log in via de cookie-jar (sessie.mjs) → Cookie-header.
//  3. GET /api/profiel MET cookie  → verwacht 200 + eigen profiel.
//     GET /api/profiel ZONDER cookie → verwacht 401.
//
//  Dit is throwaway spike-code (geen onderdeel van het definitieve harnas);
//  het doel is uitsluitend de riskantste aanname (de cookie-brug) te valideren
//  voordat de rest gebouwd wordt.
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { sessieCookies } from "./sessie.mjs";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP = process.env.APP_BASE_URL || "http://127.0.0.1:3000";

const FONDS_ID = "00000000-0000-4000-8000-000000000001";
const EMAIL = "w1-bestuurder@karakterisering.invalid";
const PASSWORD = "W1-spike-Aa1!wachtwoord";

function log(stap, obj) {
  console.log(`\n── ${stap} ──`);
  if (obj !== undefined) console.log(typeof obj === "string" ? obj : JSON.stringify(obj, null, 2));
}

async function seed(admin) {
  // Fonds (idempotent).
  {
    const { error } = await admin
      .from("fondsen")
      .upsert({ id: FONDS_ID, naam: "Testfonds W1", slug: "testfonds-w1" }, { onConflict: "id" });
    if (error) throw new Error(`fondsen upsert: ${error.message}`);
  }

  // Gebruiker: bestaande opruimen (idempotent), dan aanmaken + app_metadata.
  const { data: bestaand } = await admin.auth.admin.listUsers();
  const oud = bestaand?.users?.find((u) => u.email === EMAIL);
  if (oud) await admin.auth.admin.deleteUser(oud.id);

  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    app_metadata: { fonds_id: FONDS_ID },
    user_metadata: { naam: "W1 Bestuurder" },
  });
  if (cErr) throw new Error(`createUser: ${cErr.message}`);
  const userId = created.user.id;

  // GoTrue toont app_metadata niet betrouwbaar tijdens de insert-trigger:
  // expliciet nazetten (patroon uit verify-supabase-managed-functional.mjs).
  const { error: mErr } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { ...(created.user.app_metadata ?? {}), fonds_id: FONDS_ID },
  });
  if (mErr) throw new Error(`updateUserById: ${mErr.message}`);

  // Profiel (id = auth.uid()); rol default bestuurder.
  const { error: pErr } = await admin
    .from("profielen")
    .upsert(
      { id: userId, fonds_id: FONDS_ID, naam: "W1 Bestuurder", rol: "bestuurder" },
      { onConflict: "id" }
    );
  if (pErr) throw new Error(`profielen upsert: ${pErr.message}`);

  return userId;
}

async function main() {
  for (const [k, v] of Object.entries({ URL, ANON, SERVICE })) {
    if (!v) throw new Error(`env ${k} ontbreekt`);
  }
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  log("SEED");
  const userId = await seed(admin);
  console.log(`gebruiker: ${userId}  fonds: ${FONDS_ID}`);

  log("LOGIN (cookie-jar)");
  const { cookieHeader, cookies, userId: sessieUser } = await sessieCookies({
    url: URL,
    anonKey: ANON,
    email: EMAIL,
    password: PASSWORD,
  });
  console.log(`cookies: ${cookies.map((c) => c.name).join(", ")}`);
  console.log(`sessie-user == seed-user: ${sessieUser === userId}`);

  log("GET /api/profiel MET cookie");
  const metRes = await fetch(`${APP}/api/profiel`, { headers: { cookie: cookieHeader } });
  const metBody = await metRes.text();
  console.log(`status: ${metRes.status}`);
  console.log(`content-type: ${metRes.headers.get("content-type")}`);
  console.log(metBody.slice(0, 600));

  log("GET /api/profiel ZONDER cookie");
  const zonderRes = await fetch(`${APP}/api/profiel`);
  console.log(`status: ${zonderRes.status}`);
  console.log((await zonderRes.text()).slice(0, 200));

  // Oordeel.
  log("OORDEEL");
  const brugOk = metRes.status === 200 && metBody.includes("\"profiel\"");
  const gateOk = zonderRes.status === 401;
  console.log(`cookie-brug (200 + eigen profiel): ${brugOk ? "GROEN" : "ROOD"}`);
  console.log(`401-gate zonder sessie:            ${gateOk ? "GROEN" : "ROOD"}`);
  if (!brugOk || !gateOk) process.exit(1);
  console.log("\n✅ SPIKE GROEN — de cookie-brug werkt end-to-end.");
}

main().catch((e) => {
  console.error("\n❌ SPIKE FOUT:", e.message);
  process.exit(1);
});
