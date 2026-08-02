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
 *
 * ── Opnemen is niet monteren ────────────────────────────────────────────────
 * Deze scènes mogen RUSTIG en volledig zijn. De montage knipt er per scène
 * alleen de betekenisvolle fragmenten uit (van/tot in promo-teksten.json), dus
 * een langere opname kost geen speelduur — hij geeft juist keuze. Kort en
 * gehaast opnemen is het probleem, niet de oplossing: dan is er geen bruikbaar
 * moment om uit te snijden.
 *
 * Na een nieuwe opname verschuiven de fragmenttijden. Herijken:
 *   bash promo/toon-frames.sh
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
    /**
     * Aan/uit-opties uit core/lib/doorgrond.ts (DOORGROND_SECTIES).
     *
     * We selecteren op de ONDERTITEL, niet op de kop. "Samenvatting" is een
     * deelstring van niets op dit paneel, maar wel van knoppen elders in het
     * portaal ("Lees samenvatting", "Verberg samenvatting"); has-text matcht op
     * deelstring, dus een kop is een fragiel anker zodra dit paneel ergens
     * anders wordt hergebruikt. De ondertitels zijn uniek.
     *
     * Let op: dit zijn TOGGLES. Bij het openen staat alleen Samenvatting aan.
     */
    sectieSamenvatting: 'button:has-text("De kern in tien regels")',
    sectieAandachtspunten: 'button:has-text("Wat vraagt aandacht of actie van het bestuur")',
    sectieVragen: 'button:has-text("Drie vragen om in de vergadering te stellen")',
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
    /**
     * Uitklapknop van een agendapunt (AgendapuntKaart.tsx r. 391-400):
     * aria-label wisselt tussen "Uitklappen" en "Inklappen", de inhoud is het
     * teken ▸ / ▾. In eerdere opnames bleef het punt dicht zonder dat de scène
     * faalde; daarom nu twee ingangen én een harde controle achteraf.
     */
    uitklappen: 'button[aria-label="Uitklappen"]',
    uitklappenNaam: "Uitklappen",
    uitklappenGlyph: 'button:has-text("▸")',
    leesSamenvatting: "Lees samenvatting",
    /**
     * Klapt het AI-paneel onder het agendapunt open (AgendapuntChat r. 737).
     * BEWUST een reguliere expressie: die knop bevat naast het label ook een
     * beschrijvende alinea ("Laat de AI helpen scherper na te denken…"). De
     * toegankelijke naam is dus die hele lap tekst, en een exacte match op de
     * labelzin faalt stilzwijgend — precies waarom de verdieping in eerdere
     * opnames nooit gebeurde.
     */
    vraagDoor: /Vraag door over dit agendapunt/,
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

/**
 * Klapt het eerste agendapunt uit en controleert dat het ook echt open staat.
 *
 * De vorige versie klikte en ging door. Klapte het punt niet uit, dan liep de
 * scène gewoon door en leverde een opname op die er compleet uitziet maar de
 * kern mist — dat kost een montageronde voordat je het doorhebt. Nu faalt de
 * scène luid: hij komt met ok:false in opname-log.json.
 */
async function klapAgendapuntUit(page: Page): Promise<void> {
  const open = async () =>
    (await page.getByRole("button", { name: SELECTORS.vergadering.leesSamenvatting }).count()) > 0;

  // 1. rechtstreeks op het aria-label — omzeilt de naamberekening van getByRole
  await klikEerste(page, SELECTORS.vergadering.uitklappen, 420, 6_000);
  await pauze(page, 900);

  // 2. terugval via het teken zelf
  if (!(await open())) {
    await klikEerste(page, SELECTORS.vergadering.uitklappenGlyph, 420, 3_000);
    await pauze(page, 900);
  }

  // 3. terugval via de rol
  if (!(await open())) {
    await klikKnop(page, SELECTORS.vergadering.uitklappenNaam, 420, 3_000);
    await pauze(page, 900);
  }

  if (!(await open())) {
    throw new Error(
      "Agendapunt klapt niet uit: alle drie de ingangen (aria-label, ▸, rol) " +
        "faalden. Controleer AgendapuntKaart.tsx en of het punt een " +
        "vergaderstuk MET AI-samenvatting heeft — zonder samenvatting is er " +
        "geen knop 'Lees samenvatting' en meet deze controle verkeerd."
    );
  }
}

/**
 * Zet de inklapstand van de navigatie vóór de pagina laadt.
 *
 * DashboardShell leest de voorkeur bij mount uit localStorage
 * ("nav-ingeklapt"; "1" = ingeklapt, marge 56px i.p.v. 256px). Door hem via
 * addInitScript te zetten begint de scène al in de juiste stand — geen klik op
 * beeld, geen animatie, geen seconden kwijt.
 *
 * Waarom niet overal ingeklapt: op de startpagina is de navigatie juist het
 * bewijs dát het een samenhangend platform is en geen chatbot. Daar hoort hij
 * uitgeklapt. Vanaf de tweede scène gaat de aandacht naar de functionaliteit.
 */
async function zetMenu(page: Page, ingeklapt: boolean): Promise<void> {
  await page.addInitScript((waarde) => {
    try {
      localStorage.setItem("nav-ingeklapt", waarde as string);
    } catch {
      /* localStorage niet beschikbaar — dan gewoon de standaardstand */
    }
  }, ingeklapt ? "1" : "0");
}

export const SCENE_ACTIES: Record<string, SceneActie> = {
  /**
   * Overzicht — alleen de persoonlijke startpagina.
   * Stuurinformatie is er bewust uit: die module wordt in de video niet
   * toegelicht, en de Wtp-cijfers daar zijn dummydata die in beeld onnodig
   * vragen oproepen ("welk fonds heeft €98,4 mld?").
   */
  "02-overzicht": async (page) => {
    await zetMenu(page, false); // navigatie uitgeklapt: toon het hele platform
    await page.goto("/");
    await page.waitForLoadState("networkidle").catch(() => {});
    await pauze(page, 2000);
    await verkenPagina(page, 0.55, 1600);
    await pauze(page, 1400);
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
    await zetMenu(page, true);
    await page.goto("/ai");
    await page.waitForLoadState("networkidle").catch(() => {});

    // Ruim landen op het startpunt: dit is een eigen beat in de montage
    // ("waar werkt u nu aan?" met de drie routes), niet alleen een aanloop.
    await pauze(page, 3000);

    if (!(await klikEerste(page, SELECTORS.ai.doorgrondKaart, 450))) {
      throw new Error(
        'Kaart "Een document doorgronden" niet gevonden of geen knop — staat er ' +
          "een recent document in de bibliotheek?"
      );
    }
    await pauze(page, 2600);

    // Kiezen wat je terugkrijgt.
    //
    // PROMO_AI_KEUZE=vragen  → alléén "Kritische vragen". Variant B moet de
    //   claim "een kritische sparringpartner, geen zoekmachine" bewíjzen met
    //   wat er in beeld staat; een samenvatting toont precies het tegendeel.
    // Leeg / anders → het oorspronkelijke pad (samenvatting + aandachtspunten)
    //   waarop variant A is opgenomen. Niet weggooien: variant A moet
    //   reproduceerbaar blijven.
    //
    // Volgorde is bewust: eerst Kritische vragen AAN, dan pas Samenvatting UIT.
    // Andersom sta je even op nul geselecteerde onderdelen, en dat kan het
    // formulier blokkeren.
    if ((process.env.PROMO_AI_KEUZE ?? "") === "vragen") {
      if (!(await klikEerste(page, SELECTORS.ai.sectieVragen, 380))) {
        throw new Error(
          'Optie "Kritische vragen" niet gevonden — staat de ondertitel nog op ' +
            '"Drie vragen om in de vergadering te stellen"? Zie SELECTORS.ai.'
        );
      }
      await pauze(page, 1400); // de keuze even laten staan: dit is beat 1 van de scène
      // BEGINTOESTAND: het paneel opent met TWEE onderdelen aan — Samenvatting
      // én Bestuurlijke aandachtspunten. (Vastgesteld op de opname van 10:17;
      // ik ging er eerst van uit dat alleen Samenvatting aanstond, en toen
      // bleef "aandachtspunten" in het antwoord staan.) Beide moeten dus uit,
      // anders komt het antwoord op ~40 regels uit en zakken de drie vragen
      // onder de invoerbalk weg.
      await klikEerste(page, SELECTORS.ai.sectieSamenvatting, 380);
      await pauze(page, 500);
      await klikEerste(page, SELECTORS.ai.sectieAandachtspunten, 380);
      await pauze(page, 900);
    } else {
      await klikEerste(page, SELECTORS.ai.sectieAandachtspunten, 380);
      await pauze(page, 700);
      await klikEerste(page, SELECTORS.ai.sectieVragen, 380);
      await pauze(page, 1100);
    }

    if (!(await klikEerste(page, SELECTORS.ai.starten, 420))) {
      throw new Error('Knop "Start →" niet gevonden — SELECTORS.ai.starten bijstellen');
    }

    // Vangnet: als er toch een scopevraag verschijnt, kies het fonds. Deze
    // route zou hem niet moeten tonen, dus kort wachten — anders staat de
    // scène telkens 2,5s dood te wachten op iets dat nooit verschijnt.
    await klikEerste(page, SELECTORS.ai.scopeFonds, 350, 400);

    await page
      .waitForSelector(SELECTORS.ai.invoerBezig, { timeout: 10_000 })
      .catch(() => {});
    await page
      .waitForSelector(SELECTORS.ai.invoerVrij, { timeout: 90_000 })
      .catch(() => {});
    await pauze(page, 1000);

    // Antwoord doorlopen en een bron openklikken. Bij de vragen-route verder
    // doorscrollen: de kritische vragen staan onderaan het antwoord, en met
    // 0,4 viewporthoogte bleven ze half achter de invoerbalk hangen.
    await verkenPagina(page, (process.env.PROMO_AI_KEUZE ?? "") === "vragen" ? 0.85 : 0.4, 1000);
    if (await klikKnop(page, SELECTORS.ai.bronPill, 420)) {
      await pauze(page, 1600);
    } else {
      await pauze(page, 900);
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
    await zetMenu(page, true);
    await page.goto("/vergaderingen");
    await page.waitForLoadState("networkidle").catch(() => {});

    // Drie niveaus, elk lang genoeg om er een eigen fragment uit te knippen:
    // de vergaderlijst, de vergadering zelf, en het uitgeklapte agendapunt.
    await pauze(page, 2800);

    if (await klikEerste(page, SELECTORS.vergadering.kaart)) {
      await page.waitForLoadState("networkidle").catch(() => {});
      await pauze(page, 2800);
    }

    // Kern van deze scène: het agendapunt moet open.
    await klapAgendapuntUit(page);
    await pauze(page, 2600);

    if (await klikKnop(page, SELECTORS.vergadering.leesSamenvatting, 420)) {
      await pauze(page, 2800);
      await verkenPagina(page, 0.45, 1400);
    }

    // AI-paneel onder het agendapunt openklappen. Faalt dit, dan mist de scène
    // haar kern — dus hard stoppen in plaats van doorlopen.
    if (!(await klikKnop(page, SELECTORS.vergadering.vraagDoor, 420, 6_000))) {
      throw new Error(
        "Knop 'Vraag door over dit agendapunt' niet gevonden. Let op: die knop " +
          "bevat óók een beschrijvende alinea, dus matchen op de exacte labelzin " +
          "werkt niet — SELECTORS.vergadering.vraagDoor moet een regex blijven."
      );
    }
    await pauze(page, 1800);

    // De persoonlijke voorbereiding daadwerkelijk laten opstellen. Dit is het
    // inhoudelijke hoogtepunt van deze scène: AI-duiding op het agendapunt.
    if (!(await klikEerste(page, SELECTORS.vergadering.voorbereiding, 420, 6_000))) {
      throw new Error(
        "Knop 'Help mij met de voorbereiding' niet gevonden — controleer " +
          "AgendapuntChat.tsx (de startchip die genereerVoorbereiding aanroept)."
      );
    }

    // De knop staat tijdens het genereren op disabled — start-/eindsignaal.
    await page
      .waitForSelector(SELECTORS.vergadering.voorbereidingBezig, { timeout: 8_000 })
      .catch(() => {});
    await page
      .waitForSelector(SELECTORS.vergadering.voorbereidingVrij, { timeout: 120_000 })
      .catch(() => {});

    // Ruim de tijd nemen: dit is het beeld waar de montage uit gaat knippen.
    await pauze(page, 2500);
    await verkenPagina(page, 0.55, 1800);
    await pauze(page, 2500);
  },

  /**
   * Proces / Decision Object — de slotscène. Opent een LOPENDE procedure
   * (/procedures/<id>), nadrukkelijk niet het aanmaakformulier op
   * /procedures/nieuw, en scrolt door naar het auditspoor.
   */
  "06-proces": async (page) => {
    await zetMenu(page, true);
    await page.goto("/procedures");
    await page.waitForLoadState("networkidle").catch(() => {});
    await pauze(page, 1000);

    if (!(await klikEerste(page, SELECTORS.procedure.kaart))) {
      throw new Error(
        "Geen lopende procedure gevonden op /procedures — zet er één klaar in de demo-omgeving"
      );
    }
    await page.waitForLoadState("networkidle").catch(() => {});
    await pauze(page, 1500);

    await verkenPagina(page, 0.75, 1800);
    await scrollNaar(page, 1400, 1600);
    await pauze(page, 1500);
  },
};
