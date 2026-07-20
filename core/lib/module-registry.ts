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
    icon: "🏠", defaultActief: true, manifestBeheerbaar: false,
  },
  stuurinformatie: {
    key: "stuurinformatie", label: "Stuurinformatie", href: "/dashboard", section: "Overzicht",
    icon: "📊", defaultActief: true, manifestBeheerbaar: true,
  },
  klantbeeld: {
    key: "klantbeeld", label: "Klantbeeld", href: "/klantbeeld", section: "Overzicht",
    icon: "👥", defaultActief: true, manifestBeheerbaar: true,
  },
  ai: {
    key: "ai", label: "AI Assistent", href: "/ai", section: "Kennisbase",
    icon: "🤖", iconSrc: "/ai-assistent.png", badge: "AI",
    defaultActief: true, manifestBeheerbaar: true,
  },
  bibliotheek: {
    key: "bibliotheek", label: "Documentbibliotheek", href: "/bibliotheek", section: "Kennisbase",
    icon: "📚", defaultActief: true, manifestBeheerbaar: true,
  },
  vergaderingen: {
    key: "vergaderingen", label: "Vergaderingen", href: "/vergaderingen", section: "Bestuur",
    icon: "📅", defaultActief: true, manifestBeheerbaar: true,
  },
  notulen: {
    key: "notulen", label: "Besluiten & Notulen", href: "/notulen", section: "Bestuur",
    icon: "📋", defaultActief: true, manifestBeheerbaar: true,
  },
  procedures: {
    key: "procedures", label: "Processen", href: "/procedures", section: "Bestuur",
    icon: "📂", defaultActief: true, manifestBeheerbaar: true,
  },
  risicomatrix: {
    key: "risicomatrix", label: "Risicomatrix", href: "/risicomatrix", section: "Bestuur",
    icon: "🛡️", defaultActief: true, manifestBeheerbaar: true,
  },
  beheer: {
    key: "beheer", label: "Catalogus & organen", href: "/beheer", section: "Beheer",
    icon: "⚙️", rolVereist: "beheerder", defaultActief: true, manifestBeheerbaar: false,
  },
  governance: {
    key: "governance", label: "Governance Log", href: "/governance", section: "Beheer",
    icon: "🔍", rolVereist: "beheerder", defaultActief: true, manifestBeheerbaar: false,
  },
  // AQL-4 scherm 9 — read-only assurance-view (kwaliteitsborging AI). Zichtbaar
  // voor ÁLLE fondsrollen (geen rolVereist), read-only. Kern-audit-infrastructuur
  // (manifestBeheerbaar=false): een fonds sluit zich niet per ongeluk uit van de
  // assurance/audit-inzage. NB langste-pad-match maakt /governance/assurance deze
  // module (niet 'governance').
  assurance: {
    key: "assurance", label: "Kwaliteitsborging AI", href: "/governance/assurance", section: "Beheer",
    icon: "🛡️", defaultActief: true, manifestBeheerbaar: false,
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
 * keys vallen terug op registry.defaultActief. Niet-manifestbeheerbare kern-
 * modules zijn altijd beschikbaar, ongeacht een (foutieve) manifest-rij.
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
      beschikbaar.add(key); // kern-infrastructuur altijd beschikbaar
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
    if (pad === def.href || pad.startsWith(def.href + "/")) {
      if (!match || def.href.length > match.href.length) match = def;
    }
  }
  return match?.key ?? null;
}
