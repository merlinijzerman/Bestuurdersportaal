/**
 * maak-overlays-c.mjs — overlays voor VARIANT C (draaiboek v4).
 *
 * Deze render is de SOUND-OFF versie (export B uit het draaiboek): volledige
 * tweeregelige captions in beeld. De VO-versie (export A) gebruikt dezelfde
 * montage met korte ankers; die tekstlaag komt uit hetzelfde bestand zodra de
 * stem er is — vandaar dat kop/sub en het anker apart blijven staan.
 *
 * Vaste elementen volgens §5 van het draaiboek:
 *   - de rail: dunne lijn met zeven stille markeringen, direct boven het
 *     tekstblok, met één gouden punt die per scène opschuift
 *   - de vertrouwensregel rechtsonder, permanent vanaf scène 2
 *   - vast tekstblok, onderrand op 22% van de beeldhoogte
 *
 * LAAGVOLGORDE — hier zat de eerste fout. De montage legt de opname BOVEN de
 * achtergrondlaag en daar weer de tekstlaag overheen. Scrim en rail stonden
 * eerst in de achtergrondlaag en werden dus door de opname afgedekt; de witte
 * captions kwamen daardoor rechtstreeks op een lichte interface te staan en
 * waren onleesbaar. Scrim, rail en captions horen alle drie in de TEKSTLAAG.
 * Alleen het venster, het logo en de vertrouwensregel (die onder het venster
 * valt) mogen in de achtergrond.
 *
 * WAT HIER AFWIJKT VAN HET DRAAIBOEK, en waarom:
 * De rail beweegt niet continu maar verspringt per scène. Continue beweging
 * vraagt een overlay per frame; de montage werkt met één stilstaande PNG per
 * scène. De punt reset nergens en loopt netjes van links naar rechts — het
 * verschil is dat hij schokt in plaats van glijdt.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const TEKSTEN = JSON.parse(fs.readFileSync(path.join(HIER, "promo-teksten-c.json"), "utf8"));
const UIT = path.join(HIER, "overlays-9x16-c");

const B = TEKSTEN.merk;
const CTA = TEKSTEN.cta ?? {};
const RAIL = TEKSTEN.rail ?? [];

const W = 1080, H = 1920;
const VENSTER = { x: 0, y: 440, w: 1080, h: 1200 };

/* Tekstblok: onderrand op 22% van de beeldhoogte (§5) = y 1498. Het blok ligt
   dus over de onderkant van het venster heen; daarom een verloop-scrim, anders
   valt witte tekst weg op een lichte interface. */
const TEKST_ONDER = Math.round(H * 0.22);      // 422 px vanaf de onderkant
const TEKST_Y = H - TEKST_ONDER;               // 1498
const RAIL_Y = TEKST_Y - 210;

const basis = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${W}px; height:${H}px; }
  body { font-family:'Inter',system-ui,sans-serif; -webkit-font-smoothing:antialiased;
         position:relative; overflow:hidden; }
`;

const logoCss = `
  .logo { position:absolute; left:56px; top:52px; display:flex; align-items:center; gap:13px; }
  .mark { width:42px; height:42px; border-radius:11px; background:${B.accent}; color:${B.ink};
          font-weight:900; font-size:23px; display:flex; align-items:center; justify-content:center; }
  .naam { font-size:21px; font-weight:700; color:#fff; }
`;
const logo = `<div class="logo"><div class="mark">B</div><div class="naam">${esc(B.product)}</div></div>`;

/** De rail: zeven stille markeringen, één gouden punt op positie `actief`. */
function railHtml(actief) {
  if (actief === null || actief === undefined) return "";
  const n = RAIL.length;
  const punten = RAIL.map((_, i) => {
    const pct = (i / (n - 1)) * 100;
    const aan = i <= actief;
    return `<i style="left:${pct}%;background:${aan ? B.accent : "rgba(255,255,255,.28)"};
             width:${i === actief ? 13 : 7}px;height:${i === actief ? 13 : 7}px;
             margin-left:${i === actief ? -6.5 : -3.5}px;top:${i === actief ? -6.5 : -3.5}px"></i>`;
  }).join("");
  const vul = (actief / (n - 1)) * 100;
  return `<div class="rail"><span class="vul" style="width:${vul}%"></span>${punten}</div>`;
}

const railCss = `
  .rail { position:absolute; left:56px; right:56px; top:${RAIL_Y}px; height:2px;
          background:rgba(255,255,255,.20); }
  .rail .vul { position:absolute; left:0; top:0; height:2px; background:${B.accent}; }
  .rail i { position:absolute; border-radius:50%; }
`;

const scrimCss = `
  .scrim { position:absolute; left:0; right:0; top:${RAIL_Y - 190}px; bottom:0;
           background:linear-gradient(to bottom,
             rgba(11,31,58,0) 0%, rgba(11,31,58,.72) 26%,
             rgba(11,31,58,.94) 46%, ${B.ink} 60%); }
`;

/** Vertrouwensregel rechtsonder, permanent vanaf scène 2 (§5). */
const vertrouwen = (aan) => aan
  ? `<div class="vertrouwen">${esc(TEKSTEN.vertrouwensregel)}</div>` : "";
const vertrouwenCss = `
  .vertrouwen { position:absolute; right:56px; bottom:52px; font-size:24px; font-weight:500;
                color:rgba(255,255,255,.46); letter-spacing:.02em; text-align:right; }
`;

/** Opnamescène, twee lagen — vaste laag en tekstlaag met eigen timing. */
function scèneHtml(scene, deel = "alles") {
  const V = VENSTER;
  const vast = deel !== "tekst";
  const tekst = deel !== "achtergrond";
  const n = String(scene.kop ?? "").length;
  const kopPx = n <= 46 ? 44 : n <= 62 ? 39 : 35;
  return `<!doctype html><meta charset="utf-8"><style>${basis}${logoCss}${railCss}${scrimCss}${vertrouwenCss}
    body { background:${vast ? B.ink : "transparent"}; }
    .venster { position:absolute; left:${V.x}px; top:${V.y}px; width:${V.w}px; height:${V.h}px;
               background:${B.paper}; }
    .blok { position:absolute; left:56px; right:56px; top:${RAIL_Y + 40}px; }
    .kop { font-size:${kopPx}px; line-height:1.24; font-weight:700; color:#fff; letter-spacing:-.015em; }
    .sub { margin-top:12px; font-size:30px; line-height:1.3; font-weight:400; color:rgba(255,255,255,.80); }
  </style>
  ${vast ? `<div class="venster"></div>${logo}${vertrouwen(true)}` : ""}
  ${tekst ? `<div class="scrim"></div>${railHtml(scene.rail)}
    <div class="blok"><div class="kop">${esc(scene.kop)}</div>
    ${scene.sub ? `<div class="sub">${esc(scene.sub)}</div>` : ""}</div>` : ""}`;
}

/** Openingskaart (scène 1): navy, geen UI, rail zwak zichtbaar zonder punt. */
function openingHtml(scene) {
  return `<!doctype html><meta charset="utf-8"><style>${basis}${logoCss}
    body { background:${B.ink}; display:flex; align-items:center; }
    .gloed { position:absolute; right:-300px; bottom:-340px; width:1150px; height:1150px;
             border-radius:50%;
             background:radial-gradient(circle at 40% 40%, ${B.accent}22, ${B.accent}09 55%, transparent 72%); }
    .inhoud { position:relative; padding:0 56px; }
    h1 { font-size:62px; line-height:1.16; color:#fff; font-weight:700; white-space:pre-line;
         letter-spacing:-.022em; }
    .product { margin-top:34px; font-size:27px; line-height:1.35; font-weight:500; color:${B.accent}; }
    .rail0 { position:absolute; left:56px; right:56px; top:${RAIL_Y}px; height:2px;
             background:rgba(255,255,255,.13); }
  </style>
  <div class="gloed"></div>${logo}
  <div class="inhoud"><h1>${esc(scene.kop)}</h1>
    <div class="product">${esc(scene.sub)}</div></div>
  <div class="rail0"></div>`;
}

/** Scène 8 — de belofte. Drie regels, elk met een gouden railpunt ervoor. */
function belofteHtml(scene) {
  const regels = String(scene.kop).split("\n").map(
    (r) => `<div class="claim"><i></i><span>${esc(r)}</span></div>`).join("");
  return `<!doctype html><meta charset="utf-8"><style>${basis}${logoCss}
    body { background:${B.ink}; display:flex; align-items:center; }
    .inhoud { position:relative; padding:0 56px; width:100%; }
    .claim { display:flex; align-items:center; gap:22px; margin-bottom:30px; }
    .claim i { width:13px; height:13px; border-radius:50%; background:${B.accent}; flex:none; }
    .claim span { font-size:52px; line-height:1.1; color:#fff; font-weight:700; letter-spacing:-.02em; }
  </style>${logo}<div class="inhoud">${regels}</div>`;
}

/** Scène 9 — de call to action. De belofte blijft op 20% staan (§6). */
function ctaHtml(scene) {
  const kop = scene?.kop ?? "Ervaar het Bestuurdersportaal.";
  return `<!doctype html><meta charset="utf-8"><style>${basis}${logoCss}
    body { background:${B.ink}; display:flex; align-items:center; }
    .echo { position:absolute; left:56px; right:56px; top:520px; opacity:.20; }
    .echo div { font-size:52px; line-height:1.34; color:#fff; font-weight:700; }
    .inhoud { position:relative; padding:0 56px; width:100%; }
    h1 { font-size:52px; line-height:1.2; color:#fff; font-weight:700; white-space:pre-line;
         letter-spacing:-.02em; }
    /* Gevulde CTA-knop, teruggehaald uit variant A (verzoek 01-08). Goud met
       donkere tekst: op navy is dat het enige element met vol contrast, en het
       is het enige dat we van de kijker vragen. */
    .knop { display:inline-block; margin-top:44px; background:${B.accent}; color:${B.ink};
            font-size:34px; font-weight:800; padding:24px 46px; border-radius:15px;
            letter-spacing:-.01em; box-shadow:0 20px 54px rgba(200,162,75,.30); }
    .url { margin-top:26px; font-size:32px; font-weight:700; color:#fff; }
    .voet { position:absolute; left:56px; bottom:64px; font-size:22px; font-weight:500;
            color:rgba(255,255,255,.42); }
  </style>${logo}
  <div class="echo"><div>Goed voorbereid.</div><div>Zorgvuldig besloten.</div><div>Aantoonbaar verantwoord.</div></div>
  <div class="inhoud">
    <h1>${esc(kop)}</h1>
    <div><div class="knop">${esc(CTA.knop ?? "Plan een live demo")}</div></div>
    <div class="url">${esc(CTA.url)}</div>
  </div>
  <div class="voet">${esc(TEKSTEN.voettekst)}</div>`;
}

function fragmentVelden(scene) {
  const f = scene.fragmentenVerticaal ?? [{ van: 0, tot: 0, zoom: 1, cx: .5, cy: .5 }];
  return f.map((x) => `${x.van}:${x.tot}:${x.zoom ?? 1}:${x.cx ?? .5}:${x.cy ?? .5}:${x.markering ?? "-"}`);
}
function esc(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export { openingHtml, belofteHtml, ctaHtml, scèneHtml, fragmentVelden, TEKSTEN, UIT, W, H };
