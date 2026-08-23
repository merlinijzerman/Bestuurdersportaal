// ============================================================================
//  Module-registry (T8, besluit 0050) — de GESLOTEN, in-code bron van waarheid
//  voor welke modules het portaal kent. Puur/isomorf (geen I/O), bruikbaar in
//  server- én client-componenten.
// ----------------------------------------------------------------------------
//  WAAROM in code i.p.v. vrije tekst in de DB: `module_key` mag geen open enum
//  zijn. Het manifest (public.fonds_module_manifest) zet PER FONDS bekende keys
//  aan/uit, maar de VERZAMELING geldige keys en hun betekenis (route, label,
//  sectie, default) staat hier vast. Een key die niet in deze registry staat, is
//  deterministisch "onbekend" → niet beschikbaar (de app negeert hem).
//
//  KERNRANDVOORWAARDE (v0.4 §9): dit is een BESCHIKBAARHEIDS-registry, GEEN
//  autorisatiemodel. `rolVereist` hieronder is louter UI-cosmetica (welke items
//  we tonen); de echte autorisatie zit server-side in requireCapability() + RLS
//  per route. Een module "aan" in het manifest opent nooit een capability-gate.
// ============================================================================

/** Alle door het portaal gekende modules. Uitbreiden = hier een key toevoegen. */
export const MODULE_KEYS = [
  "home",
  "stuurinformatie",
  "klantbeeld",
  "ai",
  "bibliotheek",
  "vergaderingen",
  "notulen",
  "stemmingen",
  "procedures",
  "risicomatrix",
  "beheer",
  "governance",
  "assurance",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export type ModuleDef = {
  key: ModuleKey;
  /** Navigatie-label. */
  label: string;
  /** Route-prefix; ook gebruikt door de server-guard om een request→module te mappen. */
  href: string;
  /** Navigatie-sectie (groepskop in de sidebar). */
  section: string;
  /** Verschijnt deze module als eigen NAVIGATIE-item en doet hij mee in de
   *  pad→module-mapping? Default (afwezig) = true: alle Horizon-modules zijn
   *  navigeerbaar. `false` markeert een SUB-FUNCTIE binnen een andere module:
   *  hij heeft wel een eigen beschikbaarheidsvlag (en dus een eigen server-
   *  guard), maar géén eigen sidebar-item en geen eigen pad. Zo kan zijn `href`
   *  samenvallen met die van de dragende module zonder de nav te dupliceren of
   *  moduleVanPad() dubbelzinnig te maken. Zie besluit VEN-2 (stemmingen). */
  navigeerbaar?: boolean;
  icon: string;
  iconSrc?: string;
  badge?: string;
  /** UI-cosmetisch rolfilter (GEEN autorisatie). */
  rolVereist?: string;
  /** Beschikbaar als een fonds géén manifest-rij voor deze module heeft.
   *  Alle bestaande modules staan default AAN → Horizon-gedrag ongewijzigd. */
  defaultActief: boolean;
  /** Mag deze module via het manifest worden uitgezet? Kern-infrastructuur
   *  (home, beheer, governance) blijft altijd beschikbaar zodat een fonds zich
   *  niet per ongeluk buitensluit van beheer/audit. */
  manifestBeheerbaar: boolean;
};

/** Registry — bron van waarheid. Volgorde = weergavevolgorde in de navigatie. */
export const MODULE_REGISTRY: Record<ModuleKey, ModuleDef> = {
  home: {
    key: "home", label: "Home", href: "/", section: "Overzicht",
    icon: "⌂", defaultActief: true, manifestBeheerbaar: false,
  },
  stuurinformatie: {
    key: "stuurinformatie", label: "Stuurinformatie", href: "/dashboard", section: "Overzicht",
    icon: "◐", defaultActief: true, manifestBeheerbaar: true,
  },
  klantbeeld: {
    key: "klantbeeld", label: "Klantbeeld", href: "/klantbeeld", section: "Overzicht",
    icon: "◍", defaultActief: true, manifestBeheerbaar: true,
  },
  ai: {
    key: "ai", label: "AI Assistent", href: "/ai", section: "Kennisbase",
    icon: "✦", iconSrc: "/ai-assistent.png", badge: "AI",
    defaultActief: true, manifestBeheerbaar: true,
  },
  bibliotheek: {
    key: "bibliotheek", label: "Documentbibliotheek", href: "/bibliotheek", section: "Kennisbase",
    icon: "▤", defaultActief: true, manifestBeheerbaar: true,
  },
  vergaderingen: {
    key: "vergaderingen", label: "Vergaderingen", href: "/vergaderingen", section: "Bestuur",
    icon: "▦", defaultActief: true, manifestBeheerbaar: true,
  },
  notulen: {
    key: "notulen", label: "Besluiten & Notulen", href: "/notulen", section: "Bestuur",
    icon: "✓", defaultActief: true, manifestBeheerbaar: true,
  },
  // VEN-2 (besluit opdrachtgever 23-08-2026): stemmen is niet toegezegd aan
  // fonds 1 en hoort bestuurlijk separaat te worden ingevoerd. De functie blijft
  // in de codebase — ze is een PRODUCENT in de bewijsketen (stemverslag-bewijs,
  // fn_build_decision_dossier, afschrift-manifest `bevat_stemgedrag`, dissent-FK)
  // — maar staat voor elk fonds UIT en is niet per fonds aan te zetten.
  //
  //   defaultActief: false      → geen manifestrij = niet beschikbaar (geen migratie).
  //   manifestBeheerbaar: false → niet in het tenant-zelfservicescherm; aanzetten
  //                               vergt een CODEwijziging. Dat is de juiste drempel
  //                               voor een functie die eerst een bestuurlijk besluit
  //                               nodig heeft — en het voorkomt dat een voorzitter
  //                               hem aanzet inclusief het quorumdefect (zie het
  //                               ticket §5: `fonds stem insert` laat een beheerder
  //                               meestemmen terwijl de quorumnoemer alleen
  //                               bestuurder/voorzitter telt).
  //   navigeerbaar: false       → stemmen is een sub-functie ín /vergaderingen,
  //                               geen eigen menu-item. Daarom mag de href met die
  //                               van `vergaderingen` samenvallen.
  //
  // LET OP: deze combinatie werkt alleen doordat beschikbareModuleKeys() voor een
  // niet-manifestbeheerbare key op defaultActief terugvalt in plaats van hem
  // onvoorwaardelijk beschikbaar te maken. Zie de toelichting daar.
  stemmingen: {
    key: "stemmingen", label: "Stemmen", href: "/vergaderingen", section: "Bestuur",
    icon: "▦", defaultActief: false, manifestBeheerbaar: false, navigeerbaar: false,
  },
  procedures: {
    key: "procedures", label: "Processen", href: "/procedures", section: "Bestuur",
    icon: "◧", defaultActief: true, manifestBeheerbaar: true,
  },
  risicomatrix: {
    key: "risicomatrix", label: "Risicomatrix", href: "/risicomatrix", section: "Bestuur",
    icon: "◇", defaultActief: true, manifestBeheerbaar: true,
  },
  beheer: {
    key: "beheer", label: "Catalogus & organen", href: "/beheer", section: "Beheer",
    icon: "⚙", rolVereist: "beheerder", defaultActief: true, manifestBeheerbaar: false,
  },
  governance: {
    key: "governance", label: "Governance Log", href: "/governance", section: "Beheer",
    icon: "◎", rolVereist: "beheerder", defaultActief: true, manifestBeheerbaar: false,
  },
  // AQL-4 scherm 9 — read-only assurance-view (kwaliteitsborging AI). In het NAV
  // alleen voor de beheerder getoond (rolVereist='beheerder'): in de MVP voegt de
  // view voor niet-beheerders nog niets toe (2026-08-12). Dit is louter UI-
  // cosmetica (zie §9-randvoorwaarde hierboven) — de echte gate blijft server-side
  // in /api/aqlab/assurance; de route zelf verandert niet. Kern-audit-infra
  // (manifestBeheerbaar=false): een fonds kan zich niet per ongeluk uitsluiten.
  // NB langste-pad-match maakt /governance/assurance deze module (niet 'governance').
  assurance: {
    key: "assurance", label: "Kwaliteitsborging AI", href: "/governance/assurance", section: "Beheer",
    icon: "◇", rolVereist: "beheerder", defaultActief: true, manifestBeheerbaar: false,
  },
};

/** Type-guard: is een willekeurige string een bekende module_key? */
export function isModuleKey(x: string | null | undefined): x is ModuleKey {
  return typeof x === "string" && (MODULE_KEYS as readonly string[]).includes(x);
}

/** Registry-definities in weergavevolgorde. */
export function alleModules(): ModuleDef[] {
  return MODULE_KEYS.map((k) => MODULE_REGISTRY[k]);
}

/** Modules die via het manifest aan/uit mogen (voor het beheerscherm). */
export function beheerbareModules(): ModuleDef[] {
  return alleModules().filter((m) => m.manifestBeheerbaar);
}

/**
 * Effectieve beschikbaarheid — de KERNREGEL, gedeeld door UI en server-guard.
 * Puur: neemt de ruwe manifest-overrides (module_key → actief) en leidt de set
 * beschikbare keys af. Onbekende keys in `overrides` worden genegeerd; ontbrekende
 * keys vallen terug op registry.defaultActief.
 *
 * `manifestBeheerbaar: false` betekent: HET MANIFEST kan deze key niet wijzigen —
 * de registry beslist, via defaultActief. Voor de kern-infrastructuur (home,
 * beheer, governance, assurance; alle defaultActief=true) is dat onveranderd
 * "altijd beschikbaar, ook als een foutieve manifest-rij 'uit' zegt"
 * (self-lockout-preventie). Voor een key met defaultActief=false betekent het
 * "overal uit en niet per fonds aan te zetten" (VEN-2, `stemmingen`).
 *
 * Tot VEN-2 stond hier een onvoorwaardelijke `add()` voor elke niet-beheerbare
 * key. Dat las als "kern = altijd aan", maar codeerde feitelijk "niet-beheerbaar
 * = altijd aan" en maakte defaultActief voor die keys dood. De combinatie
 * defaultActief=false + manifestBeheerbaar=false zou dan het TEGENOVERGESTELDE
 * doen van wat ze leest. Gedrag voor de bestaande keys is identiek.
 */
export function beschikbareModuleKeys(
  overrides: ReadonlyMap<string, boolean> | Record<string, boolean> | null | undefined
): Set<ModuleKey> {
  const lees = (k: ModuleKey): boolean | undefined => {
    if (!overrides) return undefined;
    if (typeof (overrides as ReadonlyMap<string, boolean>).get === "function") {
      return (overrides as ReadonlyMap<string, boolean>).get(k);
    }
    const rec = overrides as Record<string, boolean>;
    return Object.prototype.hasOwnProperty.call(rec, k) ? rec[k] : undefined;
  };
  const beschikbaar = new Set<ModuleKey>();
  for (const key of MODULE_KEYS) {
    const def = MODULE_REGISTRY[key];
    if (!def.manifestBeheerbaar) {
      // Manifest genegeerd: de registry beslist. Kern-infra (defaultActief=true)
      // blijft dus altijd beschikbaar; een bewust uitgezette module blijft uit.
      if (def.defaultActief) beschikbaar.add(key);
      continue;
    }
    const override = lees(key);
    if (override ?? def.defaultActief) beschikbaar.add(key);
  }
  return beschikbaar;
}

/** Map een request-pad naar de module_key waartoe het hoort (server-guard). */
export function moduleVanPad(pad: string): ModuleKey | null {
  // Langste match wint (bv. "/klantbeeld/deelnemers" → klantbeeld).
  let match: ModuleDef | null = null;
  for (const def of alleModules()) {
    if (def.href === "/") continue; // home matcht anders alles
    // Sub-functies (navigeerbaar=false) delen de href van hun dragende module en
    // mogen die mapping niet dubbelzinnig maken; hun guard is route-expliciet.
    if (def.navigeerbaar === false) continue;
    if (pad === def.href || pad.startsWith(def.href + "/")) {
      if (!match || def.href.length > match.href.length) match = def;
    }
  }
  return match?.key ?? null;
}
