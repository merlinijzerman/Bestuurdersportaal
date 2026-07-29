/**
 * promo/scenes.ts — het klikpad per scène.
 *
 * De selectors hieronder zijn afgeleid uit de daadwerkelijke componenten:
 *  - nav-labels            → core/lib/module-registry.ts
 *  - "Een document doorgronden" → ai/_components/Startpunt.tsx +
 *                            DocumentDoorgronden.tsx (secties + "Start →")
 *  - antwoord-gereed       → AssistentClient.tsx (textarea disabled={laden})
 *  - [Bron N]-pill         → ai/_components/AntwoordWeergave.tsx (BronPill)
 *  - "Uitklappen"          → vergaderingen/_components/AgendapuntKaart.tsx
 *  - "Lees samenvatting"   → idem, per vergaderstuk
 *  - procedurekaart        → procedures/page.tsx (<Link href="/procedures/{id}">)
 *
 * Moet er toch iets bij: pas het uitsluitend aan in SELECTORS hieronder.
 * Een falende scène stopt de run niet; die scène ontbreekt in de montage.
 */

import type { Locator, Page } from "@playwright/test";
import { klikOp, pauze, scrollNaar, verkenPagina } from "./helpers";

// ─── SELECTORS (het enige calibratiepunt) ───────────────────────────────────
export const SELECTORS = {
  nav: {
    home: "Home",
    ai: "AI Assistent",
    bibliotheek: "Documentbibliotheek",
    vergaderingen: "Vergaderingen",
    processen: "Processen",
  },
  ai: {
    /**
     * Route "Een document doorgronden" (Startpunt.tsx → DocumentDoorgronden.tsx).
     * Bewust NIET de vrije-vraagroute: daar stelt de assistent altijd eerst de
     * scopevraag ("voor uw fonds of in algemene zin?"), wat in een teaser leest
     * als "hij geeft geen antwoord". Via deze route zit het document al in
     * scope, dus die tussenstap valt weg en je ziet in beeld waaróp het
     * antwoord is gebaseerd.
     */
    doorgrondKaart: 'button:has-text("Een document doorgronden")',
    /** Aan/uit-opties uit core/lib/doorgrond.ts (DOORGROND_SECTIES). */
    sectieSamenvatting: 'button:has-text("Bestuurlijke aandachtspunten")',
    sectieVragen: 'button:has-text("Kritische vragen")',
    starten: 'button:has-text("Start →")',
    invoer: 'textarea[placeholder^="Stel een vraag"]',
    /** Tijdens het genereren staat de textarea op disabled. */
    invoerBezig: 'textarea[placeholder^="Stel een vraag"][disabled]',
    invoerVrij: 'textarea[placeholder^="Stel een vraag"]:not([disabled])',
    /** Vangnet: mocht er tóch een scopevraag komen, kies dan het fonds. */
    scopeFonds: 'button:has-text("Voor mijn fonds")',
    /** De klikbare [Bron N]-pill in het antwoord. */
    bronPill: /^Bron \d+/,
  },
  vergadering: {
    /** Vergaderkaart in de lijst; sluit de "nieuwe vergadering"-route uit. */
    kaart: 'a[href^="/vergaderingen/"]:not([href$="/nieuw"])',
    uitklappen: "Uitklappen",
    leesSamenvatting: "Lees samenvatting",
    /** Klapt het AI-paneel onder het agendapunt open (AgendapuntChat). */
    vraagDoor: "Vraag door over dit agendapunt",
    /** Startknop die de persoonlijke voorbereiding daadwerkelijk genereert. */
    voorbereiding: 'button:has-text("met de voorbereiding")',
    voorbereidingBezig: 'button:has-text("met de voorbereiding")[disabled]',
    voorbereidingVrij: 'button:has-text("met de voorbereiding"):not([disabled])',
  },
  procedure: {
    /** Lopende procedure; expliciet NIET /procedures/nieuw. */
    kaart: 'a[href^="/procedures/"]:not([href="/procedures/nieuw"])',
  },
  ruis: ["#__next-build-watcher", "nextjs-portal", "[data-nextjs-toast]"],
};

// ─── Hulpjes ────────────────────────────────────────────────────────────────

/**
 * Wacht tot een element zichtbaar is en geeft terug of dat lukte.
 *
 * Bewust NIET Locator.isVisible(): die vraagt de staat op dít moment op en
 * wacht niet. Bij een client-component die na hydratie verschijnt (zoals de
 * agendapuntkaart) is het antwoord dan "nee" terwijl het element een fractie
 * later gewoon in beeld staat — en slaat de scène een stap stilzwijgend over.
 */
async function wachtZichtbaar(loc: Locator, wachtMs: number): Promise<boolean> {
  return loc
    .waitFor({ state: "visible", timeout: wachtMs })
    .then(() => true)
    .catch(() => false);
}

/** Klikt het eerste element voor deze selector, of geeft false terug. */
async function klikEerste(
  page: Page,
  selector: string,
  hoverMs = 320,
  wachtMs = 8_000
): Promise<boolean> {
  const loc = page.locator(selector).first();
  if (!(await wachtZichtbaar(loc, wachtMs))) return false;
  await klikOp(page, loc, { hoverMs });
  return true;
}

/** Klikt de eerste knop met deze toegankelijke naam, of geeft false terug. */
async function klikKnop(
  page: Page,
  naam: string | RegExp,
  hoverMs = 320,
  wachtMs = 8_000
): Promise<boolean> {
  const loc = page.getByRole("button", { name: naam }).first();
  if (!(await wachtZichtbaar(loc, wachtMs))) return false;
  await klikOp(page, loc, { hoverMs });
  return true;
}

// ─── Scènes ─────────────────────────────────────────────────────────────────

export type SceneActie = (page: Page) => Promise<void>;

export const SCENE_ACTIES: Record<string, SceneActie> = {
  /**
   * Overzicht — alleen de persoonlijke startpagina.
   * Stuurinformatie is er bewust uit: die module wordt in de video niet
   * toegelicht, en de Wtp-cijfers daar zijn dummydata die in beeld onnodig
   * vragen oproepen ("welk fonds heeft €98,4 mld?").
   */
  "02-overzicht": async (page) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle").catch(() => {});
    await pauze(page, 1600);
    await verkenPagina(page, 0.75, 1800);
    await pauze(page, 1200);
  },

  /** Bibliotheek: de documentenlijst als kennisbasis. */
  "03-bibliotheek": async (page) => {
    await page.goto("/bibliotheek");
    await page.waitForLoadState("networkidle").catch(() => {});
    await pauze(page, 1600);
    await verkenPagina(page, 0.55, 1500);
    await pauze(page, 1200);
  },

  /**
   * AI-assistent — via "Een document doorgronden".
   * 1. de kaart aanklikken → scherpstelpaneel met het document al in context
   * 2. twee onderdelen kiezen die je wilt terugkrijgen
   * 3. Start → en wachten tot het antwoord compleet is
   * 4. een [Bron N]-pill openklikken — dát is het punt van deze scène
   *
   * Staat er geen recent document, dan is de kaart een link naar de
   * bibliotheek in plaats van een knop en faalt deze scène met een melding.
   */
  "04-ai": async (page) => {
    await page.goto("/ai");
    await page.waitForLoadState("networkidle").catch(() => {});
    await pauze(page, 1200);

    if (!(await klikEerste(page, SELECTORS.ai.doorgrondKaart, 450))) {
      throw new Error(
        'Kaart "Een document doorgronden" niet gevonden of geen knop — staat er ' +
          "een recent document in de bibliotheek?"
      );
    }
    await pauze(page, 1600);

    // Kiezen wat je terugkrijgt. Twee onderdelen: genoeg om de keuze te laten
    // zien, kort genoeg om het antwoord binnen de scène te houden.
    await klikEerste(page, SELECTORS.ai.sectieSamenvatting, 380);
    await pauze(page, 700);
    await klikEerste(page, SELECTORS.ai.sectieVragen, 380);
    await pauze(page, 900);

    if (!(await klikEerste(page, SELECTORS.ai.starten, 420))) {
      throw new Error('Knop "Start →" niet gevonden — SELECTORS.ai.starten bijstellen');
    }

    // Vangnet: als er toch een scopevraag verschijnt, kies het fonds.
    await klikEerste(page, SELECTORS.ai.scopeFonds, 350, 2_500);

    await page
      .waitForSelector(SELECTORS.ai.invoerBezig, { timeout: 10_000 })
      .catch(() => {});
    await page
      .waitForSelector(SELECTORS.ai.invoerVrij, { timeout: 90_000 })
      .catch(() => {});
    await pauze(page, 2000);

    // Antwoord doorlopen en een bron openklikken.
    await verkenPagina(page, 0.5, 1600);
    if (await klikKnop(page, SELECTORS.ai.bronPill, 420)) {
      await pauze(page, 2800);
    } else {
      await pauze(page, 1500);
    }
  },

  /**
   * Vergadering — vier stappen diep, zodat de kijker de hele keten ziet:
   *   1. vergadering openen
   *   2. agendapunt uitklappen (stukken worden zichtbaar)
   *   3. "Lees samenvatting" — de AI-samenvatting van het vergaderstuk
   *   4. "Vraag door over dit agendapunt" + de voorbereiding echt laten
   *      genereren — dát is de AI-functionaliteit in context
   */
  "05-vergadering": async (page) => {
    await page.goto("/vergaderingen");
    await page.waitForLoadState("networkidle").catch(() => {});
    await pauze(page, 1300);

    if (await klikEerste(page, SELECTORS.vergadering.kaart)) {
      await page.waitForLoadState("networkidle").catch(() => {});
      await pauze(page, 1300);
    }

    if (await klikKnop(page, SELECTORS.vergadering.uitklappen, 420)) {
      await pauze(page, 1500);
    }

    if (await klikKnop(page, SELECTORS.vergadering.leesSamenvatting, 420)) {
      await pauze(page, 2600);
      await verkenPagina(page, 0.5, 1600);
    }

    // AI-paneel onder het agendapunt openklappen.
    if (await klikKnop(page, SELECTORS.vergadering.vraagDoor, 420)) {
      await pauze(page, 1600);

      // Voorbereiding daadwerkelijk laten opstellen. De knop staat tijdens het
      // genereren op disabled — dat is het start-/eindsignaal.
      if (await klikEerste(page, SELECTORS.vergadering.voorbereiding, 420)) {
        await page
          .waitForSelector(SELECTORS.vergadering.voorbereidingBezig, { timeout: 8_000 })
          .catch(() => {});
        await page
          .waitForSelector(SELECTORS.vergadering.voorbereidingVrij, { timeout: 90_000 })
          .catch(() => {});
        await pauze(page, 2000);
        await verkenPagina(page, 0.6, 1800);
      }
    }
    await pauze(page, 1400);
  },

  /**
   * Proces / Decision Object — de slotscène. Opent een LOPENDE procedure
   * (/procedures/<id>), nadrukkelijk niet het aanmaakformulier op
   * /procedures/nieuw, en scrolt door naar het auditspoor.
   */
  "06-proces": async (page) => {
    await page.goto("/procedures");
    await page.waitForLoadState("networkidle").catch(() => {});
    await pauze(page, 1400);

    if (!(await klikEerste(page, SELECTORS.procedure.kaart))) {
      throw new Error(
        "Geen lopende procedure gevonden op /procedures — zet er één klaar in de demo-omgeving"
      );
    }
    await page.waitForLoadState("networkidle").catch(() => {});
    await pauze(page, 2000);

    await verkenPagina(page, 0.9, 2200);
    await scrollNaar(page, 1600, 2000);
    await pauze(page, 2000);
  },
};
