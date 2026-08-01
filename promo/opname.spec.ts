/**
 * promo/opname.spec.ts — neemt alle scènes op als losse videobestanden.
 *
 * Draaien:  npx playwright test --config=promo/playwright.config.ts
 * Vereist:  `npm run dev` draait op PROMO_BASE_URL (default http://localhost:3000)
 *           en de omgevingsvariabelen PROMO_EMAIL / PROMO_WACHTWOORD.
 *
 * Resultaat: promo/opnames/<bron-id>.webm + promo/opnames/opname-log.json
 *
 * Let op het onderscheid tussen twee id's in promo-teksten.json:
 *   `id`   — de scène in de MONTAGE (bv. "02-omgeving"); bepaalt de overlay
 *   `bron` — de OPNAME (bv. "02-overzicht"); bepaalt de sleutel in
 *            SCENE_ACTIES en de bestandsnaam van de .webm
 * Ze verschillen omdat de montagevolgorde is herschikt terwijl de klikpaden
 * hun eigen naam hielden. Ontbreekt `bron`, dan is hij gelijk aan `id`.
 *
 * Ontwerpkeuzes:
 * - Eén browsercontext per scène → hard afgebakende clips, geen knipwerk achteraf.
 * - Login gebeurt één keer; de sessie wordt hergebruikt via storageState.
 * - Een falende scène stopt de run niet; die scène ontbreekt gewoon in de montage.
 */

import { test, chromium, type Browser } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { installeerCursor, pauze, verbergRuis } from "./helpers";
import { SCENE_ACTIES, SELECTORS } from "./scenes";

const HIER = __dirname;
const TEKSTEN = JSON.parse(fs.readFileSync(path.join(HIER, "promo-teksten.json"), "utf8"));

const BASE_URL = process.env.PROMO_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.PROMO_EMAIL ?? "";
const WACHTWOORD = process.env.PROMO_WACHTWOORD ?? "";

/**
 * Opnameformaat.
 *
 * Standaard 1440×810 (16:9); de montage schaalt naar 1920×1080.
 *
 * Voor de staande versie neem je apart op bij een SMAL venster:
 *
 *   PROMO_VIEWPORT=1080x1200 PROMO_OPNAMEDIR=opnames-9x16 \
 *     npx playwright test --config=promo/playwright.config.ts
 *
 * Dat is beter dan een staande uitsnede uit de brede opname: het portaal is
 * responsive, dus bij een smal venster herschikt de interface zichzelf en past
 * hij van nature in een staand kader — zonder dat er iets wordt afgesneden.
 * Bijkomend: bij 1080 in plaats van 1440 breed wordt de interfacetekst een
 * derde groter ten opzichte van het beeldkader.
 */
const VP = (process.env.PROMO_VIEWPORT ?? "1440x810").split("x").map(Number);
const VIEWPORT = { width: VP[0] || 1440, height: VP[1] || 810 };

const OPNAMEDIR = path.join(HIER, process.env.PROMO_OPNAMEDIR ?? "opnames");
const AUTHBESTAND = path.join(HIER, ".auth", "staat.json");

/**
 * Selectief opnieuw opnemen:  PROMO_SCENES=02-overzicht,04-ai
 *
 * Leeg (default) = alle scènes, en dan wordt de opnamemap eerst geleegd.
 * Staat er wél een selectie, dan blijven de overige .webm's staan en worden
 * alleen de genoemde overschreven. Dat scheelt niet zozeer opnametijd als wel
 * montagewerk: de fragmenttijden in promo-teksten.json zijn per opname
 * uitgemeten, dus elke opname die je onnodig vervangt moet opnieuw worden
 * herijkt. Gebruik de BRON-id (de sleutel in SCENE_ACTIES), niet de scène-id.
 */
const ALLEEN = (process.env.PROMO_SCENES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

test("promo-opname", async () => {
  test.setTimeout(15 * 60 * 1000);
  if (!EMAIL || !WACHTWOORD) {
    throw new Error(
      "Zet PROMO_EMAIL en PROMO_WACHTWOORD (demo-account op het demofonds) voordat je opneemt."
    );
  }

  if (ALLEEN.length) {
    fs.mkdirSync(OPNAMEDIR, { recursive: true });
    for (const id of ALLEEN) {
      fs.rmSync(path.join(OPNAMEDIR, `${id}.webm`), { force: true });
    }
    console.log(`→ alleen opnieuw opnemen: ${ALLEEN.join(", ")} (rest blijft staan)`);
  } else {
    fs.rmSync(OPNAMEDIR, { recursive: true, force: true });
    fs.mkdirSync(OPNAMEDIR, { recursive: true });
  }
  fs.mkdirSync(path.dirname(AUTHBESTAND), { recursive: true });

  const browser: Browser = await chromium.launch({
    args: ["--force-device-scale-factor=1", "--hide-scrollbars"],
  });

  // ── 1. Eenmalig inloggen en de sessie bewaren ────────────────────────────
  {
    const ctx = await browser.newContext({ baseURL: BASE_URL, viewport: VIEWPORT });
    const page = await ctx.newPage();
    console.log(`→ opnemen tegen ${BASE_URL} (${VIEWPORT.width}×${VIEWPORT.height} → ${path.basename(OPNAMEDIR)}/)`);
    const resp = await page.goto("/login");
    if (resp && resp.status() >= 400) {
      throw new Error(
        `/login gaf HTTP ${resp.status()} op ${BASE_URL}. Draait de dev-server daar, ` +
          `en klopt PROMO_BASE_URL? (nu: ${process.env.PROMO_BASE_URL ?? "niet gezet"})`
      );
    }
    // Let op: de labels op de loginpagina zijn niet aan de inputs gekoppeld
    // (geen htmlFor, input niet genest) — getByLabel werkt daar dus niet.
    // Type-selectors zijn op deze pagina eenduidig.
    await page.locator('input[type="email"]').fill(EMAIL, { timeout: 15_000 });
    await page.locator('input[type="password"]').fill(WACHTWOORD, { timeout: 15_000 });
    await page.getByRole("button", { name: /inloggen/i }).click();
    // Blijft de URL op /login staan, dan is dat vrijwel altijd een geweigerde
    // login en niet een trage server. Een kale time-out wijst dan de verkeerde
    // kant op, dus lezen we de melding van de pagina zelf uit.
    try {
      await page.waitForURL((u: URL) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
    } catch {
      const melding = (
        await page
          .locator('[role="alert"], [data-fout], .fout, .error')
          .first()
          .textContent({ timeout: 2_000 })
          .catch(() => null)
      )?.trim();
      throw new Error(
        `Inloggen mislukt op ${BASE_URL} met PROMO_EMAIL="${EMAIL}". ` +
          (melding ? `De pagina meldt: "${melding}". ` : "") +
          `Controleer of PROMO_EMAIL en PROMO_WACHTWOORD echte inloggegevens van ` +
          `het demo-account zijn — de URL bleef op /login staan.`
      );
    }
    await ctx.storageState({ path: AUTHBESTAND });
    await ctx.close();
    console.log("✓ ingelogd, sessie bewaard");
  }

  // ── 2. Scène voor scène opnemen ──────────────────────────────────────────
  const log: Array<{ id: string; bestand?: string; ok: boolean; fout?: string }> = [];

  for (const scene of TEKSTEN.scenes) {
    if (scene.type !== "opname") continue;
    const opnameId: string = scene.bron ?? scene.id;
    if (ALLEEN.length && !ALLEEN.includes(opnameId)) continue;
    const actie = SCENE_ACTIES[opnameId];
    if (!actie) {
      log.push({
        id: opnameId,
        ok: false,
        fout:
          `geen actie gedefinieerd voor "${opnameId}" (scène "${scene.id}"). ` +
          `Beschikbaar in SCENE_ACTIES: ${Object.keys(SCENE_ACTIES).join(", ")}`,
      });
      continue;
    }

    const ctx = await browser.newContext({
      baseURL: BASE_URL,
      viewport: VIEWPORT,
      storageState: AUTHBESTAND,
      recordVideo: { dir: OPNAMEDIR, size: VIEWPORT },
      colorScheme: "light",
      locale: "nl-NL",
      timezoneId: "Europe/Amsterdam",
      reducedMotion: "no-preference",
    });
    await installeerCursor(ctx);
    const page = await ctx.newPage();

    // Dev-overlays bij élke navigatie verbergen. Eerder gebeurde dat na een
    // goto("/") vooraf — dat gaf aan het begin van iedere scène een seconde
    // homepage in beeld. Nu navigeert alleen de scène zelf.
    page.on("load", () => {
      verbergRuis(page, SELECTORS.ruis).catch(() => {});
    });

    let ok = true;
    let fout: string | undefined;
    try {
      await actie(page);
      await pauze(page, 800); // rustige uitloop, zodat de fade niet in een klik valt
    } catch (e) {
      ok = false;
      fout = e instanceof Error ? e.message : String(e);
      console.warn(`✗ scène ${opnameId}: ${fout}`);
    }

    const video = page.video();
    await ctx.close(); // pas ná close is het videobestand compleet

    let bestand: string | undefined;
    if (video && ok) {
      const tijdelijk = await video.path();
      bestand = path.join(OPNAMEDIR, `${opnameId}.webm`);
      fs.renameSync(tijdelijk, bestand);
      console.log(`✓ scène ${opnameId} → ${path.basename(bestand)}`);
    } else if (video) {
      await video.delete().catch(() => {});
    }
    log.push({ id: opnameId, bestand: bestand ? path.basename(bestand) : undefined, ok, fout });
  }

  await browser.close();
  // Bij een deelopname beschrijft het log alleen de opnieuw opgenomen scènes;
  // aparte bestandsnaam, zodat het log van de volledige run intact blijft.
  fs.writeFileSync(
    path.join(OPNAMEDIR, ALLEEN.length ? "opname-log-deel.json" : "opname-log.json"),
    JSON.stringify(log, null, 2)
  );

  const mislukt = log.filter((r) => !r.ok);
  console.log(`\nKlaar: ${log.length - mislukt.length}/${log.length} scènes opgenomen.`);
  if (mislukt.length) {
    console.log("Bijstellen in promo/scenes.ts:");
    for (const m of mislukt) console.log(`  - ${m.id}: ${m.fout}`);
  }
});
