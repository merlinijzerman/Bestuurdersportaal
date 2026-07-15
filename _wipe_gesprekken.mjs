// Eenmalig hulpscript: back-up + hard delete van gesprekken voor ÉÉN gebruiker.
// Raakt governance_events/governance_log (append-only auditspoor) NIET aan.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";

const EMAIL = "merlinijzerman@gmail.com";
// Back-up wordt naast dit script geschreven (in de mvp-map).
const BACKUP = new URL("./gesprekken-backup-merlin-2026-07-15.json", import.meta.url);

// .env.local parsen (geen secrets loggen)
const env = Object.fromEntries(
  readFileSync(new URL("./.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Ontbrekende env: URL of SERVICE_ROLE_KEY"); process.exit(1); }

const db = createClient(url, key, { auth: { persistSession: false } });

// 1) user id bij e-mail vinden (admin, gepagineerd)
let userId = null;
for (let page = 1; page <= 20 && !userId; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
  if (error) { console.error("listUsers-fout:", error.message); process.exit(1); }
  const u = data.users.find((x) => (x.email || "").toLowerCase() === EMAIL.toLowerCase());
  if (u) userId = u.id;
  if (data.users.length < 200) break;
}
if (!userId) { console.error(`Geen gebruiker gevonden voor ${EMAIL}`); process.exit(1); }
console.log("Gebruiker-id gevonden:", userId);

// 2) gesprekken ophalen (alle, incl. gearchiveerde) voor deze gebruiker
const { data: rijen, error: selErr } = await db
  .from("gesprekken")
  .select("*")
  .eq("gebruiker_id", userId);
if (selErr) { console.error("Select-fout:", selErr.message); process.exit(1); }

console.log(`Gevonden gesprekken: ${rijen.length}`);
const perFonds = {};
for (const r of rijen) perFonds[r.fonds_id ?? "null"] = (perFonds[r.fonds_id ?? "null"] || 0) + 1;
console.log("Verdeling per fonds_id:", JSON.stringify(perFonds));

if (rijen.length === 0) { console.log("Niets te verwijderen. Klaar."); process.exit(0); }

// 3) back-up wegschrijven VÓÓR verwijderen
writeFileSync(BACKUP, JSON.stringify({ geexporteerd: new Date().toISOString(), gebruiker_id: userId, aantal: rijen.length, gesprekken: rijen }, null, 2));
console.log("Back-up geschreven:", BACKUP.pathname);

// 4) hard delete, gescoped op gebruiker
const { error: delErr, count } = await db
  .from("gesprekken")
  .delete({ count: "exact" })
  .eq("gebruiker_id", userId);
if (delErr) { console.error("Delete-fout:", delErr.message); process.exit(1); }
console.log(`Hard verwijderd: ${count} gesprek(ken).`);

// 5) verificatie: 0 over
const { count: rest } = await db
  .from("gesprekken")
  .select("*", { count: "exact", head: true })
  .eq("gebruiker_id", userId);
console.log(`Resterend voor deze gebruiker: ${rest}`);
