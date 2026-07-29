# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: opname.spec.ts >> promo-opname
- Location: promo/opname.spec.ts:36:5

# Error details

```
TimeoutError: locator.fill: Timeout 15000ms exceeded.
Call log:
  - waiting for locator('input[type="email"]')

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - heading "404" [level=1] [ref=e4]
    - heading "This page could not be found." [level=2] [ref=e6]
  - button "Open Next.js Dev Tools" [ref=e12] [cursor=pointer]
  - alert [ref=e16]
```

# Test source

```ts
  1   | /**
  2   |  * promo/opname.spec.ts — neemt alle scènes op als losse videobestanden.
  3   |  *
  4   |  * Draaien:  npx playwright test --config=promo/playwright.config.ts
  5   |  * Vereist:  `npm run dev` draait op PROMO_BASE_URL (default http://localhost:3000)
  6   |  *           en de omgevingsvariabelen PROMO_EMAIL / PROMO_WACHTWOORD.
  7   |  *
  8   |  * Resultaat: promo/opnames/<scene-id>.webm + promo/opnames/opname-log.json
  9   |  *
  10  |  * Ontwerpkeuzes:
  11  |  * - Eén browsercontext per scène → hard afgebakende clips, geen knipwerk achteraf.
  12  |  * - Login gebeurt één keer; de sessie wordt hergebruikt via storageState.
  13  |  * - Een falende scène stopt de run niet; die scène ontbreekt gewoon in de montage.
  14  |  */
  15  | 
  16  | import { test, chromium, type Browser } from "@playwright/test";
  17  | import fs from "node:fs";
  18  | import path from "node:path";
  19  | import { installeerCursor, pauze, verbergRuis } from "./helpers";
  20  | import { SCENE_ACTIES, SELECTORS } from "./scenes";
  21  | 
  22  | const HIER = __dirname;
  23  | const TEKSTEN = JSON.parse(fs.readFileSync(path.join(HIER, "promo-teksten.json"), "utf8"));
  24  | 
  25  | const BASE_URL = process.env.PROMO_BASE_URL ?? "http://localhost:3000";
  26  | const EMAIL = process.env.PROMO_EMAIL ?? "";
  27  | const WACHTWOORD = process.env.PROMO_WACHTWOORD ?? "";
  28  | 
  29  | /** Opnameformaat. 1440×810 is 16:9; de montage schaalt naar 1920×1080, wat de
  30  |  *  UI groter en dus leesbaarder maakt op een telefoon (LinkedIn-feed). */
  31  | const VIEWPORT = { width: 1440, height: 810 };
  32  | 
  33  | const OPNAMEDIR = path.join(HIER, "opnames");
  34  | const AUTHBESTAND = path.join(HIER, ".auth", "staat.json");
  35  | 
  36  | test("promo-opname", async () => {
  37  |   test.setTimeout(15 * 60 * 1000);
  38  |   if (!EMAIL || !WACHTWOORD) {
  39  |     throw new Error(
  40  |       "Zet PROMO_EMAIL en PROMO_WACHTWOORD (demo-account op het demofonds) voordat je opneemt."
  41  |     );
  42  |   }
  43  | 
  44  |   fs.rmSync(OPNAMEDIR, { recursive: true, force: true });
  45  |   fs.mkdirSync(OPNAMEDIR, { recursive: true });
  46  |   fs.mkdirSync(path.dirname(AUTHBESTAND), { recursive: true });
  47  | 
  48  |   const browser: Browser = await chromium.launch({
  49  |     args: ["--force-device-scale-factor=1", "--hide-scrollbars"],
  50  |   });
  51  | 
  52  |   // ── 1. Eenmalig inloggen en de sessie bewaren ────────────────────────────
  53  |   {
  54  |     const ctx = await browser.newContext({ baseURL: BASE_URL, viewport: VIEWPORT });
  55  |     const page = await ctx.newPage();
  56  |     await page.goto("/login");
  57  |     // Let op: de labels op de loginpagina zijn niet aan de inputs gekoppeld
  58  |     // (geen htmlFor, input niet genest) — getByLabel werkt daar dus niet.
  59  |     // Type-selectors zijn op deze pagina eenduidig.
> 60  |     await page.locator('input[type="email"]').fill(EMAIL, { timeout: 15_000 });
      |                                               ^ TimeoutError: locator.fill: Timeout 15000ms exceeded.
  61  |     await page.locator('input[type="password"]').fill(WACHTWOORD, { timeout: 15_000 });
  62  |     await page.getByRole("button", { name: /inloggen/i }).click();
  63  |     await page.waitForURL((u: URL) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  64  |     await ctx.storageState({ path: AUTHBESTAND });
  65  |     await ctx.close();
  66  |     console.log("✓ ingelogd, sessie bewaard");
  67  |   }
  68  | 
  69  |   // ── 2. Scène voor scène opnemen ──────────────────────────────────────────
  70  |   const log: Array<{ id: string; bestand?: string; ok: boolean; fout?: string }> = [];
  71  | 
  72  |   for (const scene of TEKSTEN.scenes) {
  73  |     if (scene.type !== "opname") continue;
  74  |     const actie = SCENE_ACTIES[scene.id];
  75  |     if (!actie) {
  76  |       log.push({ id: scene.id, ok: false, fout: "geen actie gedefinieerd" });
  77  |       continue;
  78  |     }
  79  | 
  80  |     const ctx = await browser.newContext({
  81  |       baseURL: BASE_URL,
  82  |       viewport: VIEWPORT,
  83  |       storageState: AUTHBESTAND,
  84  |       recordVideo: { dir: OPNAMEDIR, size: VIEWPORT },
  85  |       colorScheme: "light",
  86  |       locale: "nl-NL",
  87  |       timezoneId: "Europe/Amsterdam",
  88  |       reducedMotion: "no-preference",
  89  |     });
  90  |     await installeerCursor(ctx);
  91  |     const page = await ctx.newPage();
  92  | 
  93  |     let ok = true;
  94  |     let fout: string | undefined;
  95  |     try {
  96  |       await page.goto("/");
  97  |       await verbergRuis(page, SELECTORS.ruis);
  98  |       await pauze(page, 400);
  99  |       await actie(page);
  100 |       await pauze(page, 800); // rustige uitloop, zodat de fade niet in een klik valt
  101 |     } catch (e) {
  102 |       ok = false;
  103 |       fout = e instanceof Error ? e.message : String(e);
  104 |       console.warn(`✗ scène ${scene.id}: ${fout}`);
  105 |     }
  106 | 
  107 |     const video = page.video();
  108 |     await ctx.close(); // pas ná close is het videobestand compleet
  109 | 
  110 |     let bestand: string | undefined;
  111 |     if (video && ok) {
  112 |       const bron = await video.path();
  113 |       bestand = path.join(OPNAMEDIR, `${scene.id}.webm`);
  114 |       fs.renameSync(bron, bestand);
  115 |       console.log(`✓ scène ${scene.id} → ${path.basename(bestand)}`);
  116 |     } else if (video) {
  117 |       await video.delete().catch(() => {});
  118 |     }
  119 |     log.push({ id: scene.id, bestand: bestand ? path.basename(bestand) : undefined, ok, fout });
  120 |   }
  121 | 
  122 |   await browser.close();
  123 |   fs.writeFileSync(path.join(OPNAMEDIR, "opname-log.json"), JSON.stringify(log, null, 2));
  124 | 
  125 |   const mislukt = log.filter((r) => !r.ok);
  126 |   console.log(`\nKlaar: ${log.length - mislukt.length}/${log.length} scènes opgenomen.`);
  127 |   if (mislukt.length) {
  128 |     console.log("Bijstellen in promo/scenes.ts → SELECTORS:");
  129 |     for (const m of mislukt) console.log(`  - ${m.id}: ${m.fout}`);
  130 |   }
  131 | });
  132 | 
```