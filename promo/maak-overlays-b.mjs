/**
 * maak-overlays-b.mjs — overlays voor VARIANT B (review Timmer, 01-08).
 *
 * Bewust een eigen bestand naast maak-overlays.mjs. De opmaak verschilt op
 * bijna elk punt (voortgangsspoor, captionvlak onderin in plaats van kop
 * boven, goud accent, andere kaartindeling), en variant A is al akkoord —
 * die generator wil ik niet meer aanraken.
 *
 * Draaien:  node promo/maak-overlays-b.mjs        (Mac, met Playwright)
 *           node promo/_lokaal-overlays-b.mjs     (bouwomgeving zonder Playwright)
 *
 * Canvas 1080×1920. Het venster met de opname staat op y=440, hoogte 1200 —
 * gelijk aan variant A, zodat dezelfde opnames bruikbaar blijven.
 * Daarboven: merkregel + voortgangsspoor. Daaronder: het captionvlak.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const TEKSTEN = JSON.parse(
  fs.readFileSync(path.join(HIER, "promo-teksten-b.json"), "utf8")
);
const UIT = path.join(HIER, "overlays-9x16-b");

const B = TEKSTEN.merk;
const CTA = TEKSTEN.cta ?? {};
const SPOOR = TEKSTEN.spoor ?? [];

const W = 1080;
const H = 1920;
const VENSTER = { x: 0, y: 440, w: 1080, h: 1200 };

const basis = `
  @import url('https://fonts.googleapis.com/css2?family=Newsreader:wght@400;600;700&family=Inter:wght@400;500;600;700;800;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${W}px; height:${H}px; }
  body { font-family:'Inter',system-ui,sans-serif; -webkit-font-smoothing:antialiased;
         position:relative; overflow:hidden; }
  .serif { font-family:'Newsreader',Georgia,serif; }
`;

/**
 * Het voortgangsspoor. Drie woorden bovenin; het actieve staat in goud met een
 * gevuld blokje ervoor, de rest gedempt. Dit is de uitlegbaarheidslaag: de
 * kijker ziet op elk moment waar in de besluitketen hij zit.
 *
 * `actief` is de index (0/1/2) of null op de kaarten.
 */
function spoorHtml(actief) {
  if (!SPOOR.length) return "";
  const items = SPOOR.map((woord, i) => {
    const aan = i === actief;
    const kleur = aan ? B.accent : "rgba(255,255,255,.34)";
    const blok = aan ? B.accent : "rgba(255,255,255,.22)";
    return `<div class="stap">
      <div class="blok" style="background:${blok}"></div>
      <span style="color:${kleur};font-weight:${aan ? 800 : 600}">${esc(woord)}</span>
    </div>`;
  }).join("");
  return `<div class="spoor">${items}</div>`;
}

const spoorCss = `
  /* Drie woorden náást elkaar binnen 960px. Bij 19px liep "Aantoonbaar
     verantwoord" buiten het kader; 16px met krappere letterspatiëring en
     kleinere blokjes past met marge. */
  .spoor { position:absolute; left:60px; right:60px; top:150px;
           display:flex; align-items:center; gap:18px; }
  .stap { display:flex; align-items:center; gap:8px; }
  .blok { width:18px; height:4px; border-radius:2px; }
  .stap span { font-size:16px; letter-spacing:.04em; text-transform:uppercase; white-space:nowrap; }
`;

/** Merkregel linksboven: het gouden vierkant met de B, plus de productnaam. */
function logoHtml() {
  return `<div class="logo"><div class="mark">B</div><div class="naam">${esc(B.product)}</div></div>`;
}

const logoCss = `
  .logo { position:absolute; left:60px; top:56px; display:flex; align-items:center; gap:14px; }
  .mark { width:46px; height:46px; border-radius:12px; background:${B.accent}; color:${B.ink};
          font-weight:900; font-size:25px; display:flex; align-items:center; justify-content:center; }
  .naam { font-size:23px; font-weight:700; color:#fff; letter-spacing:.005em; }
`;

/**
 * Openingskaart. Alleen typografie op navy — geen stockbeeld van een
 * vergadertafel; die zijn generiek en kosten geloofwaardigheid bij deze
 * doelgroep. Onderin een gouden lijn die over de hele scèneduur vult; die
 * lijn is tegelijk de aankondiging van het voortgangsspoor dat erna komt.
 */
function hookHtml(scene) {
  return `<!doctype html><meta charset="utf-8"><style>${basis}${logoCss}
    body { background:${B.ink}; display:flex; align-items:center; }
    .gloed { position:absolute; right:-320px; bottom:-360px; width:1200px; height:1200px;
             border-radius:50%;
             background:radial-gradient(circle at 40% 40%, ${B.accent}26, ${B.accent}0A 55%, transparent 72%); }
    .inhoud { position:relative; padding:0 60px; }
    h1 { font-size:74px; line-height:1.12; color:#fff; font-weight:700;
         white-space:pre-line; letter-spacing:-.025em; }
    .lijn { position:absolute; left:60px; bottom:150px; height:4px; width:960px;
            background:rgba(255,255,255,.13); border-radius:2px; overflow:hidden; }
    .lijn i { display:block; height:100%; width:100%; background:${B.accent}; border-radius:2px; }
    .voet { position:absolute; left:60px; bottom:96px; font-size:22px; font-weight:500;
            color:rgba(255,255,255,.42); letter-spacing:.03em; }
  </style>
  <div class="gloed"></div>
  ${logoHtml()}
  <div class="inhoud"><h1 class="serif">${esc(scene.kop)}</h1></div>
  <div class="lijn"><i></i></div>
  <div class="voet">${esc(TEKSTEN.voettekst)}</div>`;
}

/**
 * Eindkaart. De drie woorden van het spoor, nu voluit, elk met het gouden
 * blokje dat de kijker in de video heeft zien oplichten. Daaronder de URL.
 * De disclaimer staat hier — en alléén hier; in variant A stond hij zowel in
 * de zijbalk als op de eindkaart.
 */
function slotHtml(scene) {
  const regels = String(scene.kop).split("\n").map(
    (r) => `<div class="claim"><div class="blok"></div><span>${esc(r)}</span></div>`
  ).join("");
  return `<!doctype html><meta charset="utf-8"><style>${basis}${logoCss}
    body { background:${B.ink}; display:flex; align-items:center; }
    .gloed { position:absolute; right:-300px; bottom:-380px; width:1300px; height:1300px;
             border-radius:50%;
             background:radial-gradient(circle at 40% 40%, ${B.accent}30, ${B.accent}0D 55%, transparent 72%); }
    .inhoud { position:relative; padding:0 60px; width:100%; }
    .claim { display:flex; align-items:center; gap:20px; margin-bottom:26px; }
    .claim .blok { width:26px; height:6px; border-radius:3px; background:${B.accent}; flex:none; }
    .claim span { font-size:54px; line-height:1.1; color:#fff; font-weight:700; letter-spacing:-.022em;
                  font-family:'Newsreader',Georgia,serif; }
    .url { margin-top:56px; font-size:34px; font-weight:700; color:${B.accent}; letter-spacing:.005em; }
    .voet { position:absolute; left:60px; bottom:96px; font-size:22px; font-weight:500;
            color:rgba(255,255,255,.42); letter-spacing:.03em; }
  </style>
  <div class="gloed"></div>
  ${logoHtml()}
  <div class="inhoud">
    ${regels}
    <div class="url">${esc(CTA.url ?? "")}</div>
  </div>
  <div class="voet">${esc(TEKSTEN.voettekst)}</div>`;
}

/**
 * Opnamescène, in TWEE lagen — zelfde principe als variant A:
 *   "achtergrond" = navy vlak, merkregel, voortgangsspoor, venstervulling
 *   "tekst"       = het captionvlak onderin, met een eigen in-/uitvloeier
 * Zo blijft het spoor muurvast staan tijdens een overgang en vloeit alleen de
 * caption mee.
 *
 * Captionvlak: maximaal twee regels vet plus twee regels cursief, ontworpen op
 * Nederlandse regellengte. De Engelse versie wordt 15-20% korter en mag het
 * kader niet leeg laten ogen — vandaar een vast blok en geen meegroeiende hoogte.
 */
function scèneHtml(scene, deel = "alles") {
  const V = VENSTER;
  const toonVast = deel !== "tekst";
  const toonTekst = deel !== "achtergrond";
  const n = String(scene.kop ?? "").length;
  const kopPx = n <= 44 ? 46 : n <= 60 ? 41 : 37;
  return `<!doctype html><meta charset="utf-8"><style>${basis}${logoCss}${spoorCss}
    body { background:${toonVast ? B.ink : "transparent"}; }
    .venster { position:absolute; left:${V.x}px; top:${V.y}px; width:${V.w}px; height:${V.h}px;
               background:${B.paper}; box-shadow:0 -16px 54px rgba(0,0,0,.45); }
    /* Vast captionvlak onder het venster. Hoogte staat vast (280px) zodat een
       kortere Engelse regel het kader niet leeg laat ogen. */
    .caption { position:absolute; left:0; right:0; top:${V.y + V.h}px; height:280px;
               padding:34px 60px 0 60px; }
    .kop { font-size:${kopPx}px; line-height:1.22; font-weight:700; color:#fff;
           letter-spacing:-.016em; }
    .sub { margin-top:14px; font-size:27px; line-height:1.34; font-weight:400; font-style:italic;
           color:rgba(255,255,255,.76); }
    .voet { position:absolute; left:60px; bottom:34px; font-size:20px; font-weight:500;
            color:rgba(255,255,255,.34); letter-spacing:.03em; }
  </style>
  ${toonVast ? `${logoHtml()}
  ${spoorHtml(scene.spoor ?? null)}
  <div class="venster"></div>
  <div class="voet">${esc(TEKSTEN.voettekst)}</div>` : ""}
  ${toonTekst ? `<div class="caption">
    <div class="kop">${esc(scene.kop)}</div>
    ${scene.sub ? `<div class="sub">${esc(scene.sub)}</div>` : ""}
  </div>` : ""}`;
}

/** van:tot:zoom:cx:cy:markering — het zesde veld leest montage.sh als drawbox. */
function fragmentVelden(scene) {
  const frags = scene.fragmentenVerticaal?.length
    ? scene.fragmentenVerticaal
    : [{ van: 0, tot: 0, zoom: 1, cx: 0.5, cy: 0.5 }];
  return frags.map(
    (f) =>
      `${f.van ?? 0}:${f.tot ?? 0}:${f.zoom ?? 1}:${f.cx ?? 0.5}:${f.cy ?? 0.5}:${f.markering ?? "-"}`
  );
}

function esc(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export {
  hookHtml, slotHtml, scèneHtml, fragmentVelden,
  TEKSTEN, UIT, W, H, VENSTER,
};
