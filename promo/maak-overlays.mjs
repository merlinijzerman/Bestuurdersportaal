/**
 * promo/maak-overlays.mjs — rendert alle tekstkaarten en onderregels als PNG.
 *
 *   node promo/maak-overlays.mjs
 *
 * Waarom via Chromium en niet via ffmpeg-drawtext: zo hebben we volledige
 * typografische controle (huisstijlkleuren, serif-kop, uitlijning, tekstomloop)
 * en is de tekst te wijzigen zonder de filtergraph aan te raken.
 *
 * Drie soorten beeld:
 *   kaart   — dekkende openingskaart
 *   opname  — transparante onderregel over de schermopname (kop + regel + sub)
 *   slot    — dekkend eindscherm met dominante call-to-action
 *
 * Uitvoer: promo/overlays/<scene-id>.png + promo/overlays/plan.txt
 *
 * plan.txt-formaat (pipe-gescheiden, één regel per scène):
 *   kaart|<id>|<duur>
 *   slot|<id>|<duur>
 *   opname|<id>|<duurDoel>|<bron-id>|<van:tot:zoom:cx:cy>|...
 */

import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const TEKSTEN = JSON.parse(fs.readFileSync(path.join(HIER, "promo-teksten.json"), "utf8"));
const UIT = path.join(HIER, process.env.PROMO_LAYOUT === "kader" ? "overlays-kader" : "overlays");

const B = TEKSTEN.merk;
const CTA = TEKSTEN.cta ?? {};
const W = 1920;
const H = 1080;

/** Veilige marge: onder deze afstand tot de rand komt geen dragende tekst. */
const MARGE = 140;

/**
 * ── Twee opmaakvarianten ────────────────────────────────────────────────────
 *
 *   PROMO_LAYOUT=vol    (standaard) schermvullende opname, tekst in een balk
 *                       onderin over het beeld heen.
 *   PROMO_LAYOUT=kader  de opname staat als "venster" op een rustige
 *                       achtergrond: niets wordt afgesneden, en tekst staat
 *                       bóven en ónder het venster in plaats van eroverheen.
 *
 * Het venster is 1600×900 op 1920×1080 — 83% van de breedte. Ruimer kan niet
 * zonder de tekst er weer overheen te leggen: boven- en onderband hebben samen
 * 180px nodig. Dat is de rekensom achter "85–92%": met tekst bóven én ónder
 * het scherm is 83% het maximum dat nog leesbare banden overhoudt.
 */
const LAYOUT = process.env.PROMO_LAYOUT === "kader" ? "kader" : "vol";
const VENSTER = { x: 176, y: 100, w: 1568, h: 882, radius: 16 };

const basis = `
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${W}px; height:${H}px; background:transparent; }
  body {
    font-family: -apple-system, "Inter", "Helvetica Neue", Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .serif { font-family: Georgia, "Times New Roman", serif; }
`;

/**
 * Kopgrootte op de openingskaart, meeschalend met de lengte.
 * Een korte kop mag groot; een kop van twee volle regels moet kleiner, anders
 * loopt hij tegen de veilige marge aan of duwt hij de subregel uit beeld.
 */
function regelGrootte(regel = "") {
  const n = String(regel).length;
  if (n <= 50) return 46;
  if (n <= 70) return 42;
  return 37;
}

function kopGrootte(kop = "") {
  const n = String(kop).length;
  if (n <= 30) return 96;
  if (n <= 48) return 84;
  return 74;
}

/** Merkblok linksboven — herhaald op alle dekkende kaarten. */
function logoHtml() {
  return `<div class="logo"><div class="mark">B</div><div class="naam">${esc(B.product)}</div></div>`;
}

/** Openingskaart — zet in vier seconden het onderwerp neer. */
function kaartHtml(scene) {
  return `<!doctype html><meta charset="utf-8"><style>${basis}
    body { background:${B.paper}; display:flex; align-items:center; }
    .vlak { position:absolute; inset:0; overflow:hidden; }
    .blob { position:absolute; right:-260px; top:-220px; width:1100px; height:1100px;
            border-radius:50%; background:radial-gradient(circle at 30% 30%, ${B.accent}22, ${B.accent}05 60%, transparent 70%); }
    .streep { position:absolute; left:0; top:0; bottom:0; width:10px; background:${B.accent}; }
    .inhoud { position:relative; padding:0 ${MARGE}px; max-width:1560px; }
    .logo { display:flex; align-items:center; gap:18px; margin-bottom:60px; }
    .mark { width:64px; height:64px; border-radius:18px; background:${B.accent}; color:#fff;
            font-weight:900; font-size:34px; display:flex; align-items:center; justify-content:center; }
    .naam { font-size:30px; font-weight:700; color:${B.ink}; letter-spacing:.01em; }
    h1 { font-size:${kopGrootte(scene.kop)}px; line-height:1.08; color:${B.ink}; font-weight:700; white-space:pre-line; letter-spacing:-.025em; }
    p  { margin-top:40px; font-size:40px; line-height:1.45; color:${B.muted}; white-space:pre-line; max-width:1300px; }
    .voet { position:absolute; left:${MARGE}px; bottom:64px; font-size:21px; color:${B.muted}; letter-spacing:.03em; }
  </style>
  <div class="vlak"><div class="blob"></div><div class="streep"></div></div>
  <div class="inhoud">
    ${logoHtml()}
    <h1 class="serif">${esc(scene.kop)}</h1>
    <p>${esc(scene.sub)}</p>
  </div>
  <div class="voet">${esc(TEKSTEN.voettekst)}</div>`;
}

/**
 * Eindscherm — de call-to-action moet visueel domineren.
 * Bewust één boodschap, één knop, één URL: alles wat er nog bij staat,
 * concurreert met de enige handeling die we van de kijker vragen.
 */
function slotHtml(scene) {
  return `<!doctype html><meta charset="utf-8"><style>${basis}
    body { background:${B.ink}; display:flex; align-items:center; }
    .vlak { position:absolute; inset:0; overflow:hidden; }
    .blob { position:absolute; right:-320px; bottom:-380px; width:1300px; height:1300px;
            border-radius:50%; background:radial-gradient(circle at 40% 40%, ${B.accent}55, ${B.accent}18 55%, transparent 72%); }
    .inhoud { position:relative; padding:0 ${MARGE}px; max-width:1600px; }
    .logo { display:flex; align-items:center; gap:18px; margin-bottom:56px; }
    .mark { width:64px; height:64px; border-radius:18px; background:${B.accent}; color:#fff;
            font-weight:900; font-size:34px; display:flex; align-items:center; justify-content:center; }
    .naam { font-size:30px; font-weight:700; color:#fff; letter-spacing:.01em; }
    h1 { font-size:80px; line-height:1.14; color:#fff; font-weight:700; white-space:pre-line; letter-spacing:-.022em; }
    /* De call-to-action moet het zwaarste element op dit scherm zijn — zwaarder
       dan de belofte erboven. Dit is het enige moment waarop we iets vragen. */
    .cta { margin-top:64px; display:flex; align-items:center; gap:40px; }
    .knop { background:${B.accent}; color:#fff; font-size:46px; font-weight:700;
            padding:32px 64px; border-radius:18px; letter-spacing:-.01em;
            box-shadow:0 22px 60px rgba(91,79,224,.5); }
    .url { font-size:42px; font-weight:600; color:#fff; letter-spacing:.005em; }
    .voet { position:absolute; left:${MARGE}px; bottom:64px; font-size:21px; color:rgba(255,255,255,.55); letter-spacing:.03em; }
  </style>
  <div class="vlak"><div class="blob"></div></div>
  <div class="inhoud">
    ${logoHtml()}
    <h1 class="serif">${esc(scene.kop)}</h1>
    <div class="cta">
      <div class="knop">${esc(CTA.knop ?? "Plan een live demo")}</div>
      <div class="url">${esc(CTA.url ?? "")}</div>
    </div>
  </div>
  <div class="voet">${esc(TEKSTEN.voettekst)}</div>`;
}

/**
 * Onderregel over de schermopname.
 * Eén hoofdzin groot, één subzin kleiner. De scrim loopt ver door zodat de
 * tekst leesbaar blijft ongeacht wat er onder in het portaal staat.
 */
function onderregelHtml(scene) {
  const sub = scene.sub
    ? `<div class="sub">${esc(scene.sub)}</div>`
    : "";
  return `<!doctype html><meta charset="utf-8"><style>${basis}
    body { position:relative; }
    /* Zwaar aangezette scrim. Het portaal is een lichte interface; een subtiel
       verloop laat de kop precies daar wegvallen waar er een lichte kaart of
       checklist achter staat. Liever een duidelijk tekstvlak dan een elegante
       overgang die de boodschap onleesbaar maakt. */
    .scrim { position:absolute; left:0; right:0; bottom:0; height:660px;
             background:linear-gradient(to bottom,
               rgba(23,26,40,0) 0%,
               rgba(23,26,40,.42) 26%,
               rgba(23,26,40,.80) 52%,
               rgba(23,26,40,.95) 76%,
               rgba(23,26,40,.97) 100%); }
    .tekst { position:absolute; left:${MARGE}px; bottom:${MARGE}px; max-width:1560px; }
    .kop { display:flex; align-items:center; gap:16px; margin-bottom:22px; }
    .bar { width:56px; height:6px; border-radius:3px; background:${B.accent}; }
    .kop span { font-size:30px; font-weight:800; letter-spacing:.15em; text-transform:uppercase; color:#CFC9FF;
                text-shadow:0 2px 14px rgba(23,26,40,.9); }
    .regel { font-size:62px; line-height:1.2; font-weight:700; color:#fff; letter-spacing:-.018em;
             text-shadow:0 3px 22px rgba(23,26,40,.75); }
    .sub { margin-top:20px; font-size:35px; line-height:1.4; font-weight:400; color:rgba(255,255,255,.86); max-width:1400px;
           text-shadow:0 2px 16px rgba(23,26,40,.8); }
    .voet { position:absolute; right:56px; bottom:56px; font-size:20px; font-weight:500;
            color:rgba(255,255,255,.62); letter-spacing:.03em; }
  </style>
  <div class="scrim"></div>
  <div class="tekst">
    <div class="kop"><div class="bar"></div><span>${esc(scene.kop)}</span></div>
    <div class="regel">${esc(scene.regel)}</div>
    ${sub}
  </div>
  <div class="voet">${esc(TEKSTEN.voettekst)}</div>`;
}

/**
 * Kaderopmaak: dekkende achtergrond met een uitgespaard venster.
 *
 * De PNG is bewust ONDOORZICHTIG en bevat álles behalve de opname zelf: de
 * achtergrond, de slagschaduw en alle tekst. De montage legt de opname dáárna
 * op de vensterpositie. Omdat de tekst buiten het venster staat, kan hij per
 * definitie geen interfaceonderdeel afdekken — dat is precies het punt van
 * deze variant.
 */
function kaderHtml(scene) {
  const V = VENSTER;
  return `<!doctype html><meta charset="utf-8"><style>${basis}
    body { background:${B.ink}; }
    .vlak { position:absolute; inset:0; overflow:hidden; }
    .gloed { position:absolute; left:50%; top:-460px; transform:translateX(-50%);
             width:2200px; height:1500px; border-radius:50%;
             background:radial-gradient(ellipse at 50% 45%, ${B.accent}3A, ${B.accent}12 48%, transparent 68%); }
    /* Het venster zelf: alleen de schaduw en de afgeronde rand tellen — de
       vulling wordt in de montage door de opname vervangen. */
    .venster { position:absolute; left:${V.x}px; top:${V.y}px; width:${V.w}px; height:${V.h}px;
               border-radius:${V.radius}px; background:${B.paper};
               box-shadow:0 28px 70px rgba(0,0,0,.55), 0 2px 0 rgba(255,255,255,.10) inset;
               border:1px solid rgba(255,255,255,.10); }
    /* Eyebrow BOVEN de regel, niet ernaast: naast elkaar houdt de regel maar
       ~1250px over en loopt een lange zin over twee regels — die tweede regel
       verdwijnt dan achter het venster. Gestapeld heeft de regel de volle
       1600px en past hij altijd op één regel. */
    .kop { position:absolute; left:${V.x}px; right:${V.x}px; top:16px; }
    .eyebrow { display:flex; align-items:center; gap:14px; margin-bottom:6px; }
    .eyebrow span { font-size:19px; font-weight:800; letter-spacing:.16em; text-transform:uppercase;
                    color:#CFC9FF; white-space:nowrap; }
    .streepje { width:30px; height:4px; border-radius:2px; background:${B.accent}; }
    .regel { font-size:${regelGrootte(scene.regel)}px; font-weight:700; color:#fff;
             letter-spacing:-.018em; line-height:1.08; white-space:nowrap; }
    /* Top-verankerd, uitgerekend vanaf de vensterrand. Bewust NIET bottom:Npx:
       die is afhankelijk van de layoutviewport, en niet elke renderer meet die
       even groot. Top-verankerd staat de band altijd op dezelfde plek. */
    .onder { position:absolute; left:${V.x}px; right:${V.x}px; top:${V.y + V.h + 14}px;
             display:flex; align-items:baseline; justify-content:space-between; gap:40px; }
    .sub { font-size:25px; font-weight:400; color:rgba(255,255,255,.86); white-space:nowrap; }
    .voet { font-size:19px; font-weight:500; color:rgba(255,255,255,.50); letter-spacing:.03em;
            white-space:nowrap; }
  </style>
  <div class="vlak"><div class="gloed"></div></div>
  <div class="venster"></div>
  <div class="kop">
    <div class="eyebrow"><div class="streepje"></div><span>${esc(scene.kop)}</span></div>
    <div class="regel">${esc(scene.regel)}</div>
  </div>
  <div class="onder">
    <div class="sub">${esc(scene.sub ?? "")}</div>
    <div class="voet">${esc(TEKSTEN.voettekst)}</div>
  </div>`;
}

/** Masker voor de afgeronde hoeken van het venster: wit vlak op zwart. */
function maskerHtml() {
  const V = VENSTER;
  return `<!doctype html><meta charset="utf-8"><style>
    * { margin:0; padding:0; }
    html, body { width:${V.w}px; height:${V.h}px; background:#000; }
    .r { width:${V.w}px; height:${V.h}px; border-radius:${V.radius}px; background:#fff; }
  </style><div class="r"></div>`;
}

function esc(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Serialiseert de fragmenten van een opnamescène naar plan.txt-velden.
 * In kaderopmaak wint `fragmentenKader` als die er is: daar horen andere
 * zoomniveaus bij (vast overzicht ↔ één detail) dan bij schermvullend.
 */
function fragmentVelden(scene) {
  const bron =
    LAYOUT === "kader" && scene.fragmentenKader?.length
      ? scene.fragmentenKader
      : scene.fragmenten;
  const frags = bron?.length
    ? bron
    : [{ van: 0, tot: 0, zoom: 1, cx: 0.5, cy: 0.5 }]; // 0:0 = hele opname
  return frags.map(
    (f) =>
      `${f.van ?? 0}:${f.tot ?? 0}:${f.zoom ?? 1}:${f.cx ?? 0.5}:${f.cy ?? 0.5}`
  );
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
fs.rmSync(UIT, { recursive: true, force: true });
fs.mkdirSync(UIT, { recursive: true });

// In kaderopmaak is óók de opnameoverlay dekkend, en is er een hoekmasker nodig.
if (LAYOUT === "kader") {
  await page.setViewportSize({ width: VENSTER.w, height: VENSTER.h });
  await page.setContent(maskerHtml(), { waitUntil: "load" });
  await page.screenshot({ path: path.join(UIT, "masker.png") });
  await page.setViewportSize({ width: W, height: H });
  console.log("✓ masker.png (afgeronde hoeken)");
}

const plan = [];
let totaal = 0;
for (const scene of TEKSTEN.scenes) {
  const kaartachtig = scene.type === "kaart" || scene.type === "slot";
  const dekkend = kaartachtig || LAYOUT === "kader";
  const html =
    scene.type === "kaart" ? kaartHtml(scene)
    : scene.type === "slot" ? slotHtml(scene)
    : LAYOUT === "kader" ? kaderHtml(scene)
    : onderregelHtml(scene);

  await page.setContent(html, { waitUntil: "load" });
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(UIT, `${scene.id}.png`), omitBackground: !dekkend });

  // Let op: `dekkend` bepaalt alleen of de PNG een achtergrond krijgt. Welke
  // plan-regel eruit rolt hangt af van het scènetype, niet van de opmaak — in
  // kaderopmaak zijn álle PNG's dekkend, óók die van opnamescènes.
  if (kaartachtig) {
    plan.push(`${scene.type}|${scene.id}|${scene.duur}`);
    totaal += scene.duur;
  } else {
    const bron = scene.bron ?? scene.id;
    plan.push(
      [`opname`, scene.id, scene.duurDoel, bron, ...fragmentVelden(scene)].join("|")
    );
    totaal += scene.duurDoel;
  }
  console.log(`✓ ${scene.id}.png`);
}
fs.writeFileSync(path.join(UIT, "plan.txt"), plan.join("\n") + "\n");
await browser.close();
console.log(`\n${plan.length} overlays gerenderd in ${path.basename(UIT)}/ (opmaak: ${LAYOUT})`);
console.log(`Streefduur totaal: ${totaal}s (werkelijke duur hangt af van de fragmentlengtes)`);
