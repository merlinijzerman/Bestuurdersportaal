/**
 * promo/scenes.ts — het klikpad per scène.
 *
 * ── CALIBRATIE ───────────────────────────────────────────────────────────────
 * De navigatie-labels hieronder komen 1-op-1 uit core/lib/module-registry.ts en
 * zijn dus betrouwbaar. De selectors BINNEN een pagina (AI-invoerveld, knoppen
 * op de procedure-detailpagina) zijn een eerste inschatting: die moeten bij de
 * eerste run gecontroleerd worden. Alles wat mogelijk moet worden bijgesteld
 * staat in het blok SELECTORS — pas alleen daar aan, niet verspreid in de code.
 *
 * Faalt een scène, dan slaat de opname die scène over en gaat door; de montage
 * laat de scène dan weg. Zo levert een half-gekalibreerde run toch bruikbaar
 * materiaal op.
 */

import type { Page } from "@playwright/test";
import {
  klikOp,
  pauze,
  scrollNaar,
  typTekst,
  verkenPagina,
  wachtOpNieuw,
} from "./helpers";

// ─── SELECTORS (het enige calibratiepunt) ───────────────────────────────────
export const SELECTORS = {
  /** Navigatielabels — bron: core/lib/module-registry.ts */
  nav: {
    home: "Home",
    stuurinformatie: "Stuurinformatie",
    ai: "AI Assistent",
    bibliotheek: "Documentbibliotheek",
    vergaderingen: "Vergaderingen",
    processen: "Processen",
    risicomatrix: "Risicomatrix",
    governance: "Governance Log",
  },
  /** AI-module */
  ai: {
    /** Invoerveld voor de vraag. Alternatieven staan in de fallback-lijst. */
    invoer: [
      'textarea[placeholder*="vraag" i]',
      'textarea[placeholder*="Stel" i]',
      "form textarea",
      "textarea",
    ],
    /** Verzendknop; wordt overgeslagen als Enter al verstuurt. */
    verzenden: ['button[type="submit"]', 'button:has-text("Verstuur")', 'button:has-text("Vraag")'],
    /** Een element dat pas verschijnt als er een antwoord staat (bronvermelding). */
    bronMarkering: ['a:has-text("Bron")', '[data-bron]', 'button:has-text("Bron")', "article"],
  },
  /** Detailpagina's: het eerste rij-/kaartelement in een lijst. */
  eersteRij: 'main a[href*="/"]:visible',
  /** Elementen die niet in beeld mogen (dev-overlays e.d.). */
  ruis: ["#__next-build-watcher", "nextjs-portal", "[data-nextjs-toast]"],
};

/** De vraag die in de AI-scène wordt gesteld. Kies er één die aantoonbaar een
 *  antwoord mét bronvermelding oplevert in de demo-omgeving — vooraf testen. */
export const AI_VRAAG = "Wat zegt ons beleggingsbeleid over renterisico?";

// ─── Hulpjes ────────────────────────────────────────────────────────────────

/** Eerste selector uit de lijst die daadwerkelijk zichtbaar is. */
async function eersteZichtbare(page: Page, selectors: string[]) {
  for (const s of selectors) {
    const loc = page.locator(s).first();
    if (await loc.isVisible().catch(() => false)) return loc;
  }
  return null;
}

async function naarModule(page: Page, label: string) {
  const link = page.getByRole("link", { name: label, exact: false }).first();
  await klikOp(page, link);
  await page.waitForLoadState("networkidle").catch(() => {});
  await pauze(page, 900);
}

// ─── Scènes ─────────────────────────────────────────────────────────────────

export type SceneActie = (page: Page) => Promise<void>;

export const SCENE_ACTIES: Record<string, SceneActie> = {
  /** Overzicht: landing + rustige verkenning van de startpagina. */
  "02-overzicht": async (page) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle").catch(() => {});
    await pauze(page, 1600);
    await verkenPagina(page, 0.8, 1800);
    await scrollNaar(page, 0, 900);
    await naarModule(page, SELECTORS.nav.stuurinformatie);
    await pauze(page, 2200);
  },

  /** Bibliotheek: lijst met documenten, één document openen. */
  "03-bibliotheek": async (page) => {
    await page.goto("/bibliotheek");
    await page.waitForLoadState("networkidle").catch(() => {});
    await pauze(page, 1800);
    await verkenPagina(page, 0.6, 1600);
    await pauze(page, 1800);
  },

  /** AI-assistent: vraag stellen, antwoord met bron tonen, bron openen. */
  "04-ai": async (page) => {
    await page.goto("/ai");
    await page.waitForLoadState("networkidle").catch(() => {});
    await pauze(page, 1400);

    const invoer = await eersteZichtbare(page, SELECTORS.ai.invoer);
    if (!invoer) throw new Error("AI-invoerveld niet gevonden — SELECTORS.ai.invoer bijstellen");

    const bron = page.locator(SELECTORS.ai.bronMarkering.join(", "));
    const voor = await bron.count();

    await typTekst(page, invoer, AI_VRAAG, 42);
    await pauze(page, 500);

    const knop = await eersteZichtbare(page, SELECTORS.ai.verzenden);
    if (knop) await klikOp(page, knop);
    else await page.keyboard.press("Enter");

    // Wachttijd is echt (RAG + LLM). In de montage wordt dit stuk versneld,
    // maar het wordt niet weggeknipt: de kijker ziet dat er verwerkt wordt.
    await wachtOpNieuw(bron, voor, 45_000);
    await pauze(page, 2200);
    await verkenPagina(page, 0.5, 1400);

    // Bron openklikken — het onderscheidende punt van de module.
    const eersteBron = bron.nth(voor);
    if (await eersteBron.isVisible().catch(() => false)) {
      await klikOp(page, eersteBron);
      await pauze(page, 2600);
    } else {
      await pauze(page, 1800);
    }
  },

  /** Vergadering: kalender, dan één vergadering met agendapunten openen. */
  "05-vergadering": async (page) => {
    await page.goto("/vergaderingen");
    await page.waitForLoadState("networkidle").catch(() => {});
    await pauze(page, 1600);
    const rij = page.locator(SELECTORS.eersteRij).first();
    if (await rij.isVisible().catch(() => false)) {
      await klikOp(page, rij);
      await page.waitForLoadState("networkidle").catch(() => {});
      await pauze(page, 1800);
      await verkenPagina(page, 0.7, 1600);
    }
    await pauze(page, 1600);
  },

  /**
   * Proces / Decision Object — de slotscène en het onderscheidende deel.
   * Opent een lopende procedure, laat de statusgang zien en scrolt door naar
   * het auditspoor onderaan de detailpagina (geen aparte scène meer).
   */
  "06-proces": async (page) => {
    await page.goto("/procedures");
    await page.waitForLoadState("networkidle").catch(() => {});
    await pauze(page, 1400);
    const rij = page.locator(SELECTORS.eersteRij).first();
    if (await rij.isVisible().catch(() => false)) {
      await klikOp(page, rij);
      await page.waitForLoadState("networkidle").catch(() => {});
      await pauze(page, 1800);
    }
    await verkenPagina(page, 0.9, 2200);
    await scrollNaar(page, 1400, 1800);
    await pauze(page, 2000);
  },
};
