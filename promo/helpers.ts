/**
 * promo/helpers.ts — opnamehulpmiddelen voor de promovideo.
 *
 * Playwright rendert de muiscursor niet in de video-opname; zonder hulp lijken
 * klikken te "teleporteren". Deze helpers injecteren daarom een zichtbare
 * cursor, bewegen de muis geïnterpoleerd en scrollen vloeiend, zodat de opname
 * leest als een menselijke rondleiding in plaats van een reeks sprongen.
 *
 * Geen productiecode: deze map draait alleen lokaal tegen `next dev`.
 */

import type { BrowserContext, Locator, Page } from "@playwright/test";

/** Injecteert een zichtbare cursor + klik-feedback in elke (sub)frame. */
export async function installeerCursor(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const maak = () => {
      if (document.getElementById("__promo_cursor")) return;
      const c = document.createElement("div");
      c.id = "__promo_cursor";
      c.style.cssText = [
        "position:fixed",
        "left:-100px",
        "top:-100px",
        "width:22px",
        "height:22px",
        "margin:-11px 0 0 -11px",
        "border-radius:50%",
        "background:rgba(91,79,224,0.25)",
        "border:2px solid rgba(91,79,224,0.95)",
        "box-shadow:0 2px 12px rgba(23,26,40,0.35)",
        "pointer-events:none",
        "z-index:2147483647",
        "transition:transform 90ms ease-out",
      ].join(";");
      document.documentElement.appendChild(c);
      document.addEventListener(
        "mousemove",
        (e) => {
          c.style.left = `${e.clientX}px`;
          c.style.top = `${e.clientY}px`;
        },
        true
      );
      document.addEventListener("mousedown", () => { c.style.transform = "scale(0.55)"; }, true);
      document.addEventListener("mouseup", () => { c.style.transform = "scale(1)"; }, true);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", maak);
    } else {
      maak();
    }
  });
}

export async function pauze(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}

/** Beweegt de muis geïnterpoleerd naar (x, y) — ~60 fps, ease-in-out. */
export async function beweegMuis(page: Page, x: number, y: number, ms = 550): Promise<void> {
  const stappen = Math.max(6, Math.round(ms / 16));
  const start = muisPositie.get(page) ?? { x: 40, y: 40 };
  for (let i = 1; i <= stappen; i++) {
    const t = i / stappen;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
    await page.mouse.move(start.x + (x - start.x) * e, start.y + (y - start.y) * e);
    await page.waitForTimeout(ms / stappen);
  }
  muisPositie.set(page, { x, y });
}

const muisPositie = new WeakMap<Page, { x: number; y: number }>();

/**
 * Klikt met zichtbare aanloop: scrollt het element in beeld, beweegt de muis
 * ernaartoe, houdt kort stil (zodat de kijker de hover ziet) en klikt dan.
 */
export async function klikOp(page: Page, doel: Locator, opties: { hoverMs?: number } = {}): Promise<void> {
  await doel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(180);
  const box = await doel.boundingBox();
  if (!box) throw new Error("klikOp: element heeft geen bounding box (niet zichtbaar?)");
  await beweegMuis(page, box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(opties.hoverMs ?? 320);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
}

/** Vloeiend scrollen over `ms` milliseconden (requestAnimationFrame in de pagina). */
export async function scrollNaar(page: Page, y: number, ms = 1400): Promise<void> {
  await page.evaluate(
    ({ y, ms }: { y: number; ms: number }) =>
      new Promise<void>((klaar) => {
        const start = window.scrollY;
        const delta = y - start;
        const t0 = performance.now();
        const stap = (nu: number) => {
          const t = Math.min(1, (nu - t0) / ms);
          const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          window.scrollTo(0, start + delta * e);
          if (t < 1) requestAnimationFrame(stap);
          else klaar();
        };
        requestAnimationFrame(stap);
      }),
    { y, ms }
  );
  await page.waitForTimeout(120);
}

/** Scrollt een vast aantal viewporthoogtes omlaag en weer terug naar boven. */
export async function verkenPagina(page: Page, factor = 0.9, ms = 1600): Promise<void> {
  const h = page.viewportSize()?.height ?? 810;
  await scrollNaar(page, Math.round(h * factor), ms);
  await pauze(page, 700);
}

/** Typt teken voor teken, met menselijke cadans. */
export async function typTekst(page: Page, veld: Locator, tekst: string, msPerTeken = 38): Promise<void> {
  await klikOp(page, veld, { hoverMs: 200 });
  await veld.type(tekst, { delay: msPerTeken });
}

/**
 * Wacht tot het aantal matches van `teller` toeneemt (bv. een nieuw AI-antwoord
 * dat verschijnt), maar nooit langer dan `maxMs`. Faalt bewust niet hard: een
 * uitblijvend antwoord mag de opname niet afbreken — dat zie je in de review.
 */
export async function wachtOpNieuw(teller: Locator, vanaf: number, maxMs = 45_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if ((await teller.count()) > vanaf) return true;
    await teller.page().waitForTimeout(500);
  }
  return false;
}

/** Verbergt elementen die niet in beeld horen (bv. dev-overlays). */
export async function verbergRuis(page: Page, selectors: string[]): Promise<void> {
  if (selectors.length === 0) return;
  await page.addStyleTag({
    content: `${selectors.join(",")} { display: none !important; }`,
  });
}
