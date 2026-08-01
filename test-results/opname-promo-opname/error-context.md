# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: opname.spec.ts >> promo-opname
- Location: promo/opname.spec.ts:73:5

# Error details

```
Error: /login gaf HTTP 500 op http://localhost:3000. Draait de dev-server daar, en klopt PROMO_BASE_URL? (nu: http://localhost:3000)
```

# Test source

```ts
  4   |  * Draaien:  npx playwright test --config=promo/playwright.config.ts
  5   |  * Vereist:  `npm run dev` draait op PROMO_BASE_URL (default http://localhost:3000)
  6   |  *           en de omgevingsvariabelen PROMO_EMAIL / PROMO_WACHTWOORD.
  7   |  *
  8   |  * Resultaat: promo/opnames/<bron-id>.webm + promo/opnames/opname-log.json
  9   |  *
  10  |  * Let op het onderscheid tussen twee id's in promo-teksten.json:
  11  |  *   `id`   — de scène in de MONTAGE (bv. "02-omgeving"); bepaalt de overlay
  12  |  *   `bron` — de OPNAME (bv. "02-overzicht"); bepaalt de sleutel in
  13  |  *            SCENE_ACTIES en de bestandsnaam van de .webm
  14  |  * Ze verschillen omdat de montagevolgorde is herschikt terwijl de klikpaden
  15  |  * hun eigen naam hielden. Ontbreekt `bron`, dan is hij gelijk aan `id`.
  16  |  *
  17  |  * Ontwerpkeuzes:
  18  |  * - Eén browsercontext per scène → hard afgebakende clips, geen knipwerk achteraf.
  19  |  * - Login gebeurt één keer; de sessie wordt hergebruikt via storageState.
  20  |  * - Een falende scène stopt de run niet; die scène ontbreekt gewoon in de montage.
  21  |  */
  22  | 
  23  | import { test, chromium, type Browser } from "@playwright/test";
  24  | import fs from "node:fs";
  25  | import path from "node:path";
  26  | import { installeerCursor, pauze, verbergRuis } from "./helpers";
  27  | import { SCENE_ACTIES, SELECTORS } from "./scenes";
  28  | 
  29  | const HIER = __dirname;
  30  | const TEKSTEN = JSON.parse(fs.readFileSync(path.join(HIER, "promo-teksten.json"), "utf8"));
  31  | 
  32  | const BASE_URL = process.env.PROMO_BASE_URL ?? "http://localhost:3000";
  33  | const EMAIL = process.env.PROMO_EMAIL ?? "";
  34  | const WACHTWOORD = process.env.PROMO_WACHTWOORD ?? "";
  35  | 
  36  | /**
  37  |  * Opnameformaat.
  38  |  *
  39  |  * Standaard 1440×810 (16:9); de montage schaalt naar 1920×1080.
  40  |  *
  41  |  * Voor de staande versie neem je apart op bij een SMAL venster:
  42  |  *
  43  |  *   PROMO_VIEWPORT=1080x1200 PROMO_OPNAMEDIR=opnames-9x16 \
  44  |  *     npx playwright test --config=promo/playwright.config.ts
  45  |  *
  46  |  * Dat is beter dan een staande uitsnede uit de brede opname: het portaal is
  47  |  * responsive, dus bij een smal venster herschikt de interface zichzelf en past
  48  |  * hij van nature in een staand kader — zonder dat er iets wordt afgesneden.
  49  |  * Bijkomend: bij 1080 in plaats van 1440 breed wordt de interfacetekst een
  50  |  * derde groter ten opzichte van het beeldkader.
  51  |  */
  52  | const VP = (process.env.PROMO_VIEWPORT ?? "1440x810").split("x").map(Number);
  53  | const VIEWPORT = { width: VP[0] || 1440, height: VP[1] || 810 };
  54  | 
  55  | const OPNAMEDIR = path.join(HIER, process.env.PROMO_OPNAMEDIR ?? "opnames");
  56  | const AUTHBESTAND = path.join(HIER, ".auth", "staat.json");
  57  | 
  58  | /**
  59  |  * Selectief opnieuw opnemen:  PROMO_SCENES=02-overzicht,04-ai
  60  |  *
  61  |  * Leeg (default) = alle scènes, en dan wordt de opnamemap eerst geleegd.
  62  |  * Staat er wél een selectie, dan blijven de overige .webm's staan en worden
  63  |  * alleen de genoemde overschreven. Dat scheelt niet zozeer opnametijd als wel
  64  |  * montagewerk: de fragmenttijden in promo-teksten.json zijn per opname
  65  |  * uitgemeten, dus elke opname die je onnodig vervangt moet opnieuw worden
  66  |  * herijkt. Gebruik de BRON-id (de sleutel in SCENE_ACTIES), niet de scène-id.
  67  |  */
  68  | const ALLEEN = (process.env.PROMO_SCENES ?? "")
  69  |   .split(",")
  70  |   .map((s) => s.trim())
  71  |   .filter(Boolean);
  72  | 
  73  | test("promo-opname", async () => {
  74  |   test.setTimeout(15 * 60 * 1000);
  75  |   if (!EMAIL || !WACHTWOORD) {
  76  |     throw new Error(
  77  |       "Zet PROMO_EMAIL en PROMO_WACHTWOORD (demo-account op het demofonds) voordat je opneemt."
  78  |     );
  79  |   }
  80  | 
  81  |   if (ALLEEN.length) {
  82  |     fs.mkdirSync(OPNAMEDIR, { recursive: true });
  83  |     for (const id of ALLEEN) {
  84  |       fs.rmSync(path.join(OPNAMEDIR, `${id}.webm`), { force: true });
  85  |     }
  86  |     console.log(`→ alleen opnieuw opnemen: ${ALLEEN.join(", ")} (rest blijft staan)`);
  87  |   } else {
  88  |     fs.rmSync(OPNAMEDIR, { recursive: true, force: true });
  89  |     fs.mkdirSync(OPNAMEDIR, { recursive: true });
  90  |   }
  91  |   fs.mkdirSync(path.dirname(AUTHBESTAND), { recursive: true });
  92  | 
  93  |   const browser: Browser = await chromium.launch({
  94  |     args: ["--force-device-scale-factor=1", "--hide-scrollbars"],
  95  |   });
  96  | 
  97  |   // ── 1. Eenmalig inloggen en de sessie bewaren ────────────────────────────
  98  |   {
  99  |     const ctx = await browser.newContext({ baseURL: BASE_URL, viewport: VIEWPORT });
  100 |     const page = await ctx.newPage();
  101 |     console.log(`→ opnemen tegen ${BASE_URL} (${VIEWPORT.width}×${VIEWPORT.height} → ${path.basename(OPNAMEDIR)}/)`);
  102 |     const resp = await page.goto("/login");
  103 |     if (resp && resp.status() >= 400) {
> 104 |       throw new Error(
      |             ^ Error: /login gaf HTTP 500 op http://localhost:3000. Draait de dev-server daar, en klopt PROMO_BASE_URL? (nu: http://localhost:3000)
  105 |         `/login gaf HTTP ${resp.status()} op ${BASE_URL}. Draait de dev-server daar, ` +
  106 |           `en klopt PROMO_BASE_URL? (nu: ${process.env.PROMO_BASE_URL ?? "niet gezet"})`
  107 |       );
  108 |     }
  109 |     // Let op: de labels op de loginpagina zijn niet aan de inputs gekoppeld
  110 |     // (geen htmlFor, input niet genest) — getByLabel werkt daar dus niet.
  111 |     // Type-selectors zijn op deze pagina eenduidig.
  112 |     await page.locator('input[type="email"]').fill(EMAIL, { timeout: 15_000 });
  113 |     await page.locator('input[type="password"]').fill(WACHTWOORD, { timeout: 15_000 });
  114 |     await page.getByRole("button", { name: /inloggen/i }).click();
  115 |     // Blijft de URL op /login staan, dan is dat vrijwel altijd een geweigerde
  116 |     // login en niet een trage server. Een kale time-out wijst dan de verkeerde
  117 |     // kant op, dus lezen we de melding van de pagina zelf uit.
  118 |     try {
  119 |       await page.waitForURL((u: URL) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  120 |     } catch {
  121 |       const melding = (
  122 |         await page
  123 |           .locator('[role="alert"], [data-fout], .fout, .error')
  124 |           .first()
  125 |           .textContent({ timeout: 2_000 })
  126 |           .catch(() => null)
  127 |       )?.trim();
  128 |       throw new Error(
  129 |         `Inloggen mislukt op ${BASE_URL} met PROMO_EMAIL="${EMAIL}". ` +
  130 |           (melding ? `De pagina meldt: "${melding}". ` : "") +
  131 |           `Controleer of PROMO_EMAIL en PROMO_WACHTWOORD echte inloggegevens van ` +
  132 |           `het demo-account zijn — de URL bleef op /login staan.`
  133 |       );
  134 |     }
  135 |     await ctx.storageState({ path: AUTHBESTAND });
  136 |     await ctx.close();
  137 |     console.log("✓ ingelogd, sessie bewaard");
  138 |   }
  139 | 
  140 |   // ── 2. Scène voor scène opnemen ──────────────────────────────────────────
  141 |   const log: Array<{ id: string; bestand?: string; ok: boolean; fout?: string }> = [];
  142 | 
  143 |   for (const scene of TEKSTEN.scenes) {
  144 |     if (scene.type !== "opname") continue;
  145 |     const opnameId: string = scene.bron ?? scene.id;
  146 |     if (ALLEEN.length && !ALLEEN.includes(opnameId)) continue;
  147 |     const actie = SCENE_ACTIES[opnameId];
  148 |     if (!actie) {
  149 |       log.push({
  150 |         id: opnameId,
  151 |         ok: false,
  152 |         fout:
  153 |           `geen actie gedefinieerd voor "${opnameId}" (scène "${scene.id}"). ` +
  154 |           `Beschikbaar in SCENE_ACTIES: ${Object.keys(SCENE_ACTIES).join(", ")}`,
  155 |       });
  156 |       continue;
  157 |     }
  158 | 
  159 |     const ctx = await browser.newContext({
  160 |       baseURL: BASE_URL,
  161 |       viewport: VIEWPORT,
  162 |       storageState: AUTHBESTAND,
  163 |       recordVideo: { dir: OPNAMEDIR, size: VIEWPORT },
  164 |       colorScheme: "light",
  165 |       locale: "nl-NL",
  166 |       timezoneId: "Europe/Amsterdam",
  167 |       reducedMotion: "no-preference",
  168 |     });
  169 |     await installeerCursor(ctx);
  170 |     const page = await ctx.newPage();
  171 | 
  172 |     // Dev-overlays bij élke navigatie verbergen. Eerder gebeurde dat na een
  173 |     // goto("/") vooraf — dat gaf aan het begin van iedere scène een seconde
  174 |     // homepage in beeld. Nu navigeert alleen de scène zelf.
  175 |     page.on("load", () => {
  176 |       verbergRuis(page, SELECTORS.ruis).catch(() => {});
  177 |     });
  178 | 
  179 |     let ok = true;
  180 |     let fout: string | undefined;
  181 |     try {
  182 |       await actie(page);
  183 |       await pauze(page, 800); // rustige uitloop, zodat de fade niet in een klik valt
  184 |     } catch (e) {
  185 |       ok = false;
  186 |       fout = e instanceof Error ? e.message : String(e);
  187 |       console.warn(`✗ scène ${opnameId}: ${fout}`);
  188 |     }
  189 | 
  190 |     const video = page.video();
  191 |     await ctx.close(); // pas ná close is het videobestand compleet
  192 | 
  193 |     let bestand: string | undefined;
  194 |     if (video && ok) {
  195 |       const tijdelijk = await video.path();
  196 |       bestand = path.join(OPNAMEDIR, `${opnameId}.webm`);
  197 |       fs.renameSync(tijdelijk, bestand);
  198 |       console.log(`✓ scène ${opnameId} → ${path.basename(bestand)}`);
  199 |     } else if (video) {
  200 |       await video.delete().catch(() => {});
  201 |     }
  202 |     log.push({ id: opnameId, bestand: bestand ? path.basename(bestand) : undefined, ok, fout });
  203 |   }
  204 | 
```