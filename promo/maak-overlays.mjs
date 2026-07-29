/**
 * promo/maak-overlays.mjs — rendert alle tekstkaarten en onderregels als PNG.
 *
 *   node promo/maak-overlays.mjs
 *
 * Waarom via Chromium en niet via ffmpeg-drawtext: zo hebben we volledige
 * typografische controle (huisstijlkleuren, serif-kop, uitlijning, tekstomloop)
 * en is de tekst te wijzigen zonder de filtergraph aan te raken. Playwright is
 * toch al geïnstalleerd voor de opname.
 *
 * Uitvoer: promo/overlays/<scene-id>.png + promo/overlays/plan.txt
 */

import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const TEKSTEN = JSON.parse(fs.readFileSync(path.join(HIER, "promo-teksten.json"), "utf8"));
const UIT = path.join(HIER, "overlays");

const B = TEKSTEN.merk;
const W = 1920;
const H = 1080;

const basis = `
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${W}px; height:${H}px; background:transparent; }
  body {
    font-family: -apple-system, "Inter", "Helvetica Neue", Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .serif { font-family: Georgia, "Times New Roman", serif; }
`;

/** Volledige tekstkaart (opening/slot) — dekkend, dient als eigen shot. */
function kaartHtml(scene) {
  return `<!doctype html><meta charset="utf-8"><style>${basis}
    body { background:${B.paper}; display:flex; align-items:center; }
    .vlak { position:absolute; inset:0; overflow:hidden; }
    .blob { position:absolute; right:-260px; top:-220px; width:1100px; height:1100px;
            border-radius:50%; background:radial-gradient(circle at 30% 30%, ${B.accent}22, ${B.accent}05 60%, transparent 70%); }
    .streep { position:absolute; left:0; top:0; bottom:0; width:10px; background:${B.accent}; }
    .inhoud { position:relative; padding:0 150px; max-width:1500px; }
    .logo { display:flex; align-items:center; gap:18px; margin-bottom:56px; }
    .mark { width:64px; height:64px; border-radius:18px; background:${B.accent}; color:#fff;
            font-weight:900; font-size:34px; display:flex; align-items:center; justify-content:center; }
    .naam { font-size:28px; font-weight:700; color:${B.ink}; letter-spacing:.01em; }
    h1 { font-size:82px; line-height:1.08; color:${B.ink}; font-weight:700; white-space:pre-line; letter-spacing:-.02em; }
    p  { margin-top:36px; font-size:34px; line-height:1.5; color:${B.muted}; white-space:pre-line; max-width:1250px; }
    .voet { position:absolute; left:150px; bottom:64px; font-size:22px; color:${B.muted}; letter-spacing:.04em; }
  </style>
  <div class="vlak"><div class="blob"></div><div class="streep"></div></div>
  <div class="inhoud">
    <div class="logo"><div class="mark">B</div><div class="naam">${TEKSTEN.merk.product}</div></div>
    <h1 class="serif">${esc(scene.kop)}</h1>
    <p>${esc(scene.sub)}</p>
  </div>
  <div class="voet">${esc(TEKSTEN.voettekst)}</div>`;
}

/** Onderregel over de schermopname — transparant behalve de scrim onderin. */
function onderregelHtml(scene) {
  return `<!doctype html><meta charset="utf-8"><style>${basis}
    body { position:relative; }
    .scrim { position:absolute; left:0; right:0; bottom:0; height:420px;
             background:linear-gradient(to bottom, rgba(23,26,40,0) 0%, rgba(23,26,40,.55) 42%, rgba(23,26,40,.92) 100%); }
    .tekst { position:absolute; left:110px; bottom:104px; max-width:1500px; }
    .kop { display:flex; align-items:center; gap:16px; margin-bottom:20px; }
    .bar { width:52px; height:6px; border-radius:3px; background:${B.accent}; }
    .kop span { font-size:32px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:#C9C4FF; }
    .regel { font-size:54px; line-height:1.28; font-weight:600; color:#fff; letter-spacing:-.01em; }
    .voet { position:absolute; right:56px; top:44px; font-size:22px; font-weight:600; color:#fff;
            background:rgba(23,26,40,.62); border:1px solid rgba(255,255,255,.22);
            padding:10px 18px; border-radius:999px; letter-spacing:.02em; }
  </style>
  <div class="scrim"></div>
  <div class="tekst">
    <div class="kop"><div class="bar"></div><span>${esc(scene.kop)}</span></div>
    <div class="regel">${esc(scene.regel)}</div>
  </div>
  <div class="voet">${esc(TEKSTEN.voettekst)}</div>`;
}

function esc(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
fs.rmSync(UIT, { recursive: true, force: true });
fs.mkdirSync(UIT, { recursive: true });

const plan = [];
for (const scene of TEKSTEN.scenes) {
  const kaart = scene.type === "kaart";
  await page.setContent(kaart ? kaartHtml(scene) : onderregelHtml(scene), { waitUntil: "load" });
  await page.waitForTimeout(120);
  const bestand = path.join(UIT, `${scene.id}.png`);
  await page.screenshot({ path: bestand, omitBackground: !kaart });
  plan.push(`${scene.type}|${scene.id}|${kaart ? scene.duur : scene.duurDoel}`);
  console.log(`✓ ${path.basename(bestand)}`);
}
fs.writeFileSync(path.join(UIT, "plan.txt"), plan.join("\n") + "\n");
await browser.close();
console.log(`\n${plan.length} overlays gerenderd in promo/overlays/`);
