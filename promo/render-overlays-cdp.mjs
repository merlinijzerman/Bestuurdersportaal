/**
 * render-overlays-cdp.mjs — overlays van variant C renderen ZONDER Playwright.
 *
 * Hoort naast render-overlays.mjs en schrijft HETZELFDE plan.txt-formaat.
 * Voor omgevingen waar het npm-register geblokkeerd is en Playwright dus niet
 * te installeren valt. Op de Mac gebruik je gewoon:
 *   PROMO_VARIANT=c node promo/render-overlays.mjs
 *
 * Dit is NIET de oude `_lokaal-overlays-*.mjs`-opzet. Die gebruikte
 * `chrome --headless --screenshot` en is onbruikbaar; zie hieronder waarom.
 *
 * WAAROM NIET --screenshot VAN DE CLI
 * De voor de hand liggende route (`chrome --headless --window-size=1080,1920
 * --screenshot=x.png`) is onbetrouwbaar en faalt STIL:
 *   - --window-size zet het VENSTER, niet de viewport. Chromium 141 reserveert
 *     87 px voor vensterchroom, dus je viewport is 1833 px hoog. Alles wat met
 *     `bottom:` is gepositioneerd valt daarmee buiten beeld — bij variant C zijn
 *     dat de vertrouwensregel EN de voettekst "Demonstratieomgeving met fictieve
 *     gegevens". Je ziet een keurige render zonder disclaimer.
 *   - Compenseren naar --window-size=1080,2007 geeft wél viewport 1920, maar de
 *     PNG is dan 2007 px hoog met de pagina 13 px omlaag geschoven en onderaan
 *     afgekapt. Ook dat is met het blote oog niet te zien.
 * Daarom stuurt dit bestand Chromium via het DevTools-protocol aan, met
 * Emulation.setDeviceMetricsOverride. Dat is precies wat Playwright doet, dus
 * de PNG's zijn pixelgelijk aan de Mac-route — op het lettertype na, zie onder.
 *
 * LETTERTYPE — LEES DIT
 * De opmaak laadt Inter via een @import van Google Fonts. Is dat geblokkeerd,
 * dan valt de browser stil terug op system-ui: andere breedtes, andere
 * regelafbrekingen. Dit bestand doet twee dingen om dat zichtbaar te maken in
 * plaats van stil te laten gebeuren:
 *   1. het PROBEERT Inter te vinden (PROMO_INTER=/pad/naar/Inter.ttf of een
 *      geïnstalleerde systeem-Inter) en meldt expliciet wat het gebruikt;
 *   2. lukt dat niet, dan aliast het Inter naar de opgegeven vervanger
 *      (PROMO_FONT_FALLBACK, standaard "Liberation Sans") mét een echte bold,
 *      zodat de zware gewichten niet synthetisch uitgesmeerd worden.
 * Een render met vervangend lettertype is bruikbaar om TIMING en MONTAGE te
 * beoordelen, niet om typografie af te tekenen.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PROMO_CDP_PORT ?? 9333);
const FALLBACK = process.env.PROMO_FONT_FALLBACK ?? "Liberation Sans";

/** Zoekt de Chromium-binary; het pad verschilt per omgeving. */
function vindChrome() {
  if (process.env.PROMO_CHROME) return process.env.PROMO_CHROME;
  const wortel = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  const kandidaten = [];
  if (fs.existsSync(wortel)) {
    for (const d of fs.readdirSync(wortel)) {
      kandidaten.push(path.join(wortel, d, "chrome-linux", "chrome"));
      kandidaten.push(path.join(wortel, d, "chrome-linux", "headless_shell"));
    }
  }
  kandidaten.push("/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome");
  const hit = kandidaten.find((p) => fs.existsSync(p));
  if (!hit) throw new Error(`Geen Chromium gevonden. Zoek hem met: ls ${wortel}\nZet daarna PROMO_CHROME=/volledig/pad/naar/chrome`);
  return hit;
}

/** Is er een echte Inter? Zo ja, bed hem in als @font-face met file://. */
function fontRegel() {
  const expliciet = process.env.PROMO_INTER;
  if (expliciet && fs.existsSync(expliciet)) {
    const b64 = fs.readFileSync(expliciet).toString("base64");
    const mime = expliciet.endsWith(".woff2") ? "font/woff2" : "font/ttf";
    console.log(`  lettertype: ECHTE Inter uit ${expliciet}`);
    return `<style>@font-face{font-family:'Inter';src:url(data:${mime};base64,${b64});font-weight:100 1000}</style>`;
  }
  let systeem = "";
  try { systeem = execFileSync("fc-list", [":", "family"], { encoding: "utf8" }); } catch {}
  if (/(^|,)\s*Inter\s*(,|$)/m.test(systeem)) {
    console.log("  lettertype: ECHTE Inter (systeemfont)");
    return "";
  }
  console.log(`  lettertype: !! GEEN Inter — gealiast naar "${FALLBACK}". Typografie is NIET representatief.`);
  return `<style>
@font-face{font-family:'Inter';src:local('${FALLBACK}');font-weight:100 550;font-style:normal}
@font-face{font-family:'Inter';src:local('${FALLBACK} Bold');font-weight:551 1000;font-style:normal}
</style>`;
}

/* ── minimale DevTools-protocolclient (Node 22 heeft WebSocket ingebouwd) ── */
function client(url) {
  const ws = new WebSocket(url);
  const wacht = new Map();
  const luisteraars = new Map();
  let id = 0;
  const klaar = new Promise((res) => ws.addEventListener("open", res));
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wacht.has(m.id)) { wacht.get(m.id)(m.result); wacht.delete(m.id); }
    if (m.method && luisteraars.has(m.method)) { luisteraars.get(m.method)(); luisteraars.delete(m.method); }
  });
  return {
    klaar,
    stuur: (method, params = {}) => new Promise((res) => { wacht.set(++id, res); ws.send(JSON.stringify({ id, method, params })); }),
    ooit: (method) => new Promise((res) => luisteraars.set(method, res)),
    dicht: () => ws.close(),
  };
}

const slaap = (ms) => new Promise((r) => setTimeout(r, ms));

const m = await import(path.join(HIER, "maak-overlays-c.mjs"));
const KAARTTYPEN = ["kaart", "belofte", "slot"];

function htmlVoor(scene, deel) {
  if (scene.type === "kaart") return (m.openingHtml ?? m.hookHtml)(scene);
  if (scene.type === "belofte") return m.belofteHtml(scene);
  if (scene.type === "slot") return (m.ctaHtml ?? m.slotHtml)(scene);
  return (m.scèneHtml ?? m.sceneHtml)(scene, deel);
}

const CHROME = vindChrome();
console.log(`  chromium  : ${CHROME}`);
const PATCH = fontRegel();

fs.rmSync(m.UIT, { recursive: true, force: true });
fs.mkdirSync(m.UIT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ovc-"));

const proc = spawn(CHROME, [
  "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
  "--force-color-profile=srgb", "--disable-lcd-text",
  `--remote-debugging-port=${PORT}`, "about:blank",
], { stdio: "ignore" });

let doel = null;
for (let i = 0; i < 60 && !doel; i++) {
  await slaap(250);
  try {
    const lijst = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    doel = lijst.find((t) => t.type === "page");
  } catch {}
}
if (!doel) { proc.kill(); throw new Error("Chromium kwam niet op via het debugprotocol."); }

const c = client(doel.webSocketDebuggerUrl);
await c.klaar;
await c.stuur("Page.enable");
await c.stuur("Emulation.setDeviceMetricsOverride", {
  width: m.W, height: m.H, deviceScaleFactor: 1, mobile: false,
});

async function schiet(html, bestand, transparant) {
  const f = path.join(tmp, `p${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(f, html.replace(/@import url\([^)]*\);?/g, "") + PATCH);
  await c.stuur("Emulation.setDefaultBackgroundColorOverride",
    transparant ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {});
  const geladen = c.ooit("Page.loadEventFired");
  await c.stuur("Page.navigate", { url: `file://${f}` });
  await geladen;
  await slaap(150);
  const { data } = await c.stuur("Page.captureScreenshot", {
    format: "png", captureBeyondViewport: false,
  });
  fs.writeFileSync(bestand, Buffer.from(data, "base64"));
}

const plan = [];
let totaal = 0;
for (const scene of m.TEKSTEN.scenes) {
  const kaartachtig = KAARTTYPEN.includes(scene.type);
  await schiet(htmlVoor(scene, "achtergrond"), path.join(m.UIT, `${scene.id}.png`), false);
  if (!kaartachtig) {
    await schiet(htmlVoor(scene, "tekst"), path.join(m.UIT, `${scene.id}-tekst.png`), true);
  }
  if (kaartachtig) { plan.push(`kaart|${scene.id}|${scene.duur}`); totaal += scene.duur; }
  else {
    plan.push(["opname", scene.id, scene.duurDoel, scene.bron ?? scene.id, ...m.fragmentVelden(scene)].join("|"));
    totaal += scene.duurDoel;
  }
  console.log(`✓ ${scene.id}`);
}

fs.writeFileSync(path.join(m.UIT, "plan.txt"), plan.join("\n") + "\n");
c.dicht(); proc.kill();
console.log(`\nStreefduur totaal: ${totaal}s`);
console.log(`Geschreven naar: ${m.UIT}`);
