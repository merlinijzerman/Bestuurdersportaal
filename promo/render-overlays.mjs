/**
 * render-overlays.mjs — rendert de overlays van variant B of C met Playwright.
 *
 *   PROMO_VARIANT=c node promo/render-overlays.mjs
 *   PROMO_VARIANT=b node promo/render-overlays.mjs
 *
 * Waarom dit bestand bestaat: `maak-overlays-b.mjs` en `maak-overlays-c.mjs`
 * zijn alléén modules. Ze bevatten de HTML-generatoren en exporteren die, maar
 * ze schrijven zelf geen PNG's en geen plan.txt. Variant A heeft die aandrijving
 * wél in `maak-overlays.mjs` zitten; bij B en C is hij bij het opsplitsen
 * blijven hangen in de sandbox-shims (`_lokaal-overlays-*.mjs`), en die roepen
 * een Chromium-binary aan op een pad dat alleen in de bouwomgeving bestaat.
 * Dit bestand is de ontbrekende schakel voor de Mac.
 *
 * Werkt voor beide varianten door te kijken wélke generatoren de module
 * exporteert — B kent hookHtml/slotHtml, C kent openingHtml/belofteHtml/ctaHtml.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const VARIANT = (process.env.PROMO_VARIANT ?? "").toLowerCase();

if (!["b", "c"].includes(VARIANT)) {
  console.error(
    "Zet PROMO_VARIANT op b of c.\n" +
      "  PROMO_VARIANT=c node promo/render-overlays.mjs\n" +
      "Variant A rendert met zijn eigen script: node promo/maak-overlays.mjs"
  );
  process.exit(1);
}

const m = await import(path.join(HIER, `maak-overlays-${VARIANT}.mjs`));

/** Kaartachtige scènes vullen het hele beeld; opnamescènes krijgen twee lagen. */
const KAARTTYPEN = ["kaart", "belofte", "slot"];

/** Kiest de juiste generator, ongeacht hoe de variant zijn functies noemt. */
function htmlVoor(scene, deel) {
  if (scene.type === "kaart") return (m.openingHtml ?? m.hookHtml)(scene);
  if (scene.type === "belofte") return m.belofteHtml(scene);
  if (scene.type === "slot") return (m.ctaHtml ?? m.slotHtml)(scene);
  return (m.scèneHtml ?? m.sceneHtml)(scene, deel);
}

fs.rmSync(m.UIT, { recursive: true, force: true });
fs.mkdirSync(m.UIT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: m.W, height: m.H },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

/**
 * `omitBackground` laat de tekstlaag transparant. Zonder die vlag krijgt de
 * PNG een witte ondergrond en dekt hij de opname eronder volledig af — dat is
 * precies de fout die de captions eerder onleesbaar maakte.
 */
async function schiet(html, bestand, transparant) {
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.screenshot({ path: bestand, omitBackground: transparant });
}

const plan = [];
let totaal = 0;

for (const scene of m.TEKSTEN.scenes) {
  const kaartachtig = KAARTTYPEN.includes(scene.type);

  await schiet(htmlVoor(scene, "achtergrond"), path.join(m.UIT, `${scene.id}.png`), false);
  if (!kaartachtig) {
    await schiet(
      htmlVoor(scene, "tekst"),
      path.join(m.UIT, `${scene.id}-tekst.png`),
      true
    );
  }

  if (kaartachtig) {
    // montage.sh kent alleen "kaart" en "slot" als dekkende scène; "belofte"
    // gedraagt zich identiek, dus die schrijven we weg als kaart.
    plan.push(`kaart|${scene.id}|${scene.duur}`);
    totaal += scene.duur;
  } else {
    plan.push(
      ["opname", scene.id, scene.duurDoel, scene.bron ?? scene.id, ...m.fragmentVelden(scene)].join("|")
    );
    totaal += scene.duurDoel;
  }
  console.log(`✓ ${scene.id}.png`);
}

fs.writeFileSync(path.join(m.UIT, "plan.txt"), plan.join("\n") + "\n");
await browser.close();

console.log(`\nStreefduur totaal: ${totaal}s`);
console.log(`Geschreven naar: ${path.relative(process.cwd(), m.UIT)}/`);
