// ============================================================================
//  scripts/platform_bootstrap_beheerders.mjs
//  Stap 1 van de bootstrap: de twee auth-accounts aanmaken via de Supabase
//  Admin API. Vervangt Deel 1 (route A/B) van
//  scripts/platform_bootstrap_beheerders.sql. Daarna nog steeds Deel 2 t/m 6 van
//  dat SQL-script draaien (identiteit + capabilities + audit + verificatie).
//
//  WAAROM DIT SCRIPT: de metadata-vlag {"platform": true} MOET via app_metadata
//  worden vastgelegd. GoTrue maakt app_metadata bij createUser() niet
//  betrouwbaar beschikbaar aan de inserttrigger; daarom volgt hieronder een
//  expliciete service-role update. De trigger bij_app_metadata voorkomt daarna
//  een tenant-profiel.
//
//  VEREIST in mvp/.env.local (of in de omgeving):
//    NEXT_PUBLIC_SUPABASE_URL=...
//    SUPABASE_SERVICE_ROLE_KEY=...   (Supabase → Project Settings → API)
//
//  ⚠️ WIJST .env.local NAAR PRODUCTIE? Deze accounts moeten in het project staan
//     dat achter beheer.bestuurdersportaal.com hangt. Controleer de URL die het
//     script afdrukt vóór je bevestigt.
//
//  GEBRUIK (vanuit map mvp/):
//    node scripts/platform_bootstrap_beheerders.mjs            # droogloop
//    node scripts/platform_bootstrap_beheerders.mjs --uitvoeren # daadwerkelijk
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function laadEnvLocal() {
  try {
    const hier = dirname(fileURLToPath(import.meta.url));
    const inhoud = readFileSync(join(hier, "..", ".env.local"), "utf8");
    for (const regel of inhoud.split("\n")) {
      const m = regel.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* geen .env.local — dan uit de omgeving */
  }
}
laadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Ontbrekende env: NEXT_PUBLIC_SUPABASE_URL en/of SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}

// Startwachtwoord — bewust tijdelijk. Laat beide beheerders dit direct wijzigen.
const START_WACHTWOORD = "Welkom01";

const BEHEERDERS = [
  { email: "merlin.ijzerman@the-paradox.com", naam: "Merlin IJzerman" },
  { email: "robert.timmer@the-paradox.com", naam: "Robert Timmer" },
];

const UITVOEREN = process.argv.includes("--uitvoeren");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Zoekt een bestaand auth-account op e-mailadres (paginerend). */
async function zoekGebruiker(email) {
  for (let pagina = 1; pagina <= 20; pagina++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page: pagina,
      perPage: 200,
    });
    if (error) throw error;
    const treffer = data.users.find(
      (u) => (u.email ?? "").toLowerCase() === email.toLowerCase()
    );
    if (treffer) return treffer;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  console.log(`Project : ${SUPABASE_URL}`);
  console.log(`Modus   : ${UITVOEREN ? "UITVOEREN" : "droogloop (geen wijzigingen)"}`);
  console.log("");

  for (const b of BEHEERDERS) {
    const bestaand = await zoekGebruiker(b.email);

    if (bestaand) {
      // WP1 (17-08-2026): de platform-vlag staat in app_metadata, niet in
      // user_metadata. user_metadata is client-schrijfbaar via signUp(); een
      // privilege-bit hoort daar niet. `app_metadata` is alleen met de
      // service-role te zetten — dus alleen vanuit dit script.
      const isPlatform = bestaand.app_metadata?.platform === true;
      const oudeVlagInUserMeta = bestaand.user_metadata?.platform === true;
      console.log(
        `• ${b.email} — bestaat al (id ${bestaand.id}), platform-vlag (app_metadata): ${isPlatform}`
      );
      if (oudeVlagInUserMeta && !isPlatform) {
        console.log(
          "  ⚠️ dit account draagt de OUDE conventie: platform-vlag in user_metadata.\n" +
            "  → wordt hieronder naar app_metadata getild. De vlag in user_metadata\n" +
            "    blijft staan als historisch spoor; maak_profiel negeert hem niet maar\n" +
            "    WEIGERT erop, en dat raakt alleen nieuwe inserts."
        );
      }
      if (!isPlatform) {
        console.log(
          "  ⚠️ app_metadata mist {\"platform\": true}. Dit account is waarschijnlijk " +
            "een tenant-account met profielen-rij; de 3b-guard weigert het dan.\n" +
            "  → zet de vlag en verwijder de profielen-rij (Deel 1/B3 in de SQL)."
        );
        if (UITVOEREN) {
          const { error } = await supabase.auth.admin.updateUserById(bestaand.id, {
            app_metadata: { ...bestaand.app_metadata, platform: true },
            user_metadata: { ...bestaand.user_metadata, naam: b.naam },
          });
          if (error) console.log(`  ✗ metadata bijwerken mislukt: ${error.message}`);
          else console.log("  ✓ app_metadata bijgewerkt (platform: true)");
        }
      }
      continue;
    }

    if (!UITVOEREN) {
      console.log(`• ${b.email} — zou worden aangemaakt (platform: true, auto-confirm)`);
      continue;
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email: b.email,
      password: START_WACHTWOORD,
      email_confirm: true, // geen mailbevestiging nodig
      // WP1: platform-vlag in app_metadata (server-only), naam in user_metadata.
      user_metadata: { naam: b.naam },
      app_metadata: { platform: true },
    });

    if (error) {
      console.log(`• ${b.email} — ✗ mislukt: ${error.message}`);
      console.log(
        "  Tip: 'geen fonds_id in app-metadata' betekent dat de platform-vlag " +
          "niet is meegekomen in app_metadata (maak_profiel is fail-closed)."
      );
      continue;
    }
    const { data: bijgewerkt, error: metadataError } = await supabase.auth.admin.updateUserById(
      data.user.id,
      { app_metadata: { ...(data.user.app_metadata ?? {}), platform: true } },
    );
    if (metadataError || bijgewerkt?.user?.app_metadata?.platform !== true) {
      console.log(`• ${b.email} — ✗ app_metadata kon niet veilig worden vastgelegd`);
      await supabase.auth.admin.deleteUser(data.user.id);
      continue;
    }
    console.log(`• ${b.email} — ✓ aangemaakt (id ${data.user.id})`);
  }

  console.log("");
  console.log("Volgende stap: draai Deel 2 t/m 6 van");
  console.log("scripts/platform_bootstrap_beheerders.sql in de Supabase SQL-editor.");
  console.log("Daarna inloggen op https://beheer.bestuurdersportaal.com/login");
  console.log("(wachtwoord → TOTP-enrollment → back-office).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
