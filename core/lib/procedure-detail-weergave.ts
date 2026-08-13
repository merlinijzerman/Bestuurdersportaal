// ============================================================
//  Processen-detail — rechter-weergavekeuze + sectie-samenvattingen (WO-3).
//
//  Pure, deterministische helpers voor de UI-herinrichting van de
//  Processen-detailpagina:
//   • `kiesWeergave` bepaalt of rechts de stap- of de fase-weergave staat,
//     uit de query-params (`?stap` / `?fase`) met een vaste precedentie.
//   • de `*Samenvatting`-functies bouwen de ingeklapte-sectiekoppen
//     ("Checklist · 0/8 voldaan · 8× bewijs vereist" e.d.).
//
//  Losgetrokken uit de componenten zodat de logica sanity-getest kan worden
//  (geen React, geen Supabase).
// ============================================================

/** Welke weergave staat rechts? Stap- óf fase-weergave (nooit beide). */
export type Weergave =
  | { modus: "stap"; stapId: string }
  | { modus: "fase"; faseCode: string }
  | { modus: "leeg" };

export interface WeergaveInput {
  /** ?stap=<id> uit de URL (indien aanwezig). */
  stapParam?: string | null;
  /** ?fase=<code> uit de URL (indien aanwezig). */
  faseParam?: string | null;
  /** Ids van bestaande stappen (guard tegen een dode/vreemde ?stap). */
  geldigeStapIds: string[];
  /** Codes van bestaande fasen (guard tegen een dode/vreemde ?fase). */
  geldigeFaseCodes: string[];
  /** Default-stap wanneer geen (geldige) param is gegeven (bv. de actieve stap). */
  defaultStapId: string | null;
}

// Precedentie (matcht de mockup: klik-stap toont het stapscherm, klik-fase de
// fasebeschrijving; ze sluiten elkaar uit via wederzijds vervangende query's):
//   1. een geldige ?stap wint altijd (expliciete stapkeuze);
//   2. anders een geldige ?fase (expliciete fasekeuze);
//   3. anders de default-stap (bv. de actieve stap) — het rustige startbeeld;
//   4. niets bruikbaars → leeg (procedure zonder stappen).
export function kiesWeergave(input: WeergaveInput): Weergave {
  const stap = input.stapParam?.trim();
  if (stap && input.geldigeStapIds.includes(stap)) {
    return { modus: "stap", stapId: stap };
  }
  const fase = input.faseParam?.trim();
  if (fase && input.geldigeFaseCodes.includes(fase)) {
    return { modus: "fase", faseCode: fase };
  }
  if (input.defaultStapId && input.geldigeStapIds.includes(input.defaultStapId)) {
    return { modus: "stap", stapId: input.defaultStapId };
  }
  return { modus: "leeg" };
}

/** Checklist-kop: "0/8 voldaan · 8× bewijs vereist" (alleen actieve items). */
export function checklistSamenvatting(
  items: { voldaan: boolean; bewijs_vereist: boolean; actief?: boolean | null }[]
): string {
  const actief = items.filter((c) => c.actief !== false);
  const totaal = actief.length;
  const voldaan = actief.filter((c) => c.voldaan).length;
  const bewijs = actief.filter((c) => c.bewijs_vereist).length;
  const kern = `${voldaan}/${totaal} voldaan`;
  return bewijs > 0 ? `${kern} · ${bewijs}× bewijs vereist` : kern;
}

/** Bewijsstukken-kop: "3 gevraagd · nog op te voeren" / "· alle opgevoerd". */
export function bewijsstukkenSamenvatting(
  evidence: { vervuld: boolean }[]
): string {
  const totaal = evidence.length;
  if (totaal === 0) return "geen vereisten";
  const open = evidence.filter((e) => !e.vervuld).length;
  if (open === 0) return `${totaal} gevraagd · alle opgevoerd`;
  return `${totaal} gevraagd · nog ${open} op te voeren`;
}

/** Vergaderingen-kop: "geen" / "1 gekoppeld" / "3 gekoppeld". */
export function vergaderingenSamenvatting(aantalGekoppeld: number): string {
  if (aantalGekoppeld <= 0) return "geen";
  return `${aantalGekoppeld} gekoppeld`;
}
