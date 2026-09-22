// ============================================================================
//  #434 T4-F — het LEESPAD van de beheerstand, los van de HTTP-laag.
// ----------------------------------------------------------------------------
//  Waarom dit niet in de route staat: een autorisatietest die de route zelf niet
//  kan uitvoeren, valt terug op het lezen van de broncode met een reguliere
//  expressie. Dat bewijst dat er een regel STAAT, niet dat er iets GEBEURT — en
//  het is groen zodra de juiste tekst ergens in het bestand voorkomt, ook in een
//  commentaarregel. Hier staat het leespad als gewone functie met injecteerbare
//  afhankelijkheden, zodat een test werkelijk een onbevoegde gebruiker en een
//  tweede fonds langs deze code haalt.
//
//  DE VOLGORDE IS EEN EIS, GEEN STIJL. Eerst de capability, dán pas lezen. Een
//  weigering ná de query heeft de rijen al opgehaald; dat is de vorm waarin een
//  leesrecht in de praktijk lekt — via een foutmelding, een timing of een latere
//  refactor die de weigering verplaatst.
//
//  ── WAAROM ER TWEE PADEN ZIJN ──────────────────────────────────────────────
//  De RLS-policy op `governance_log` luidt
//  `gebruiker_id = auth.uid() or public.mag_audit(fonds_id)`, en `mag_audit()`
//  vereist de afzonderlijke grant `governance_audit_read`. De beheercapability
//  `fonds.config.manage` verleent die grant NIET. Een gewone tabelquery levert
//  een beheerder dus alleen zijn EIGEN beurten op — en presenteerde die als de
//  stand van het fonds. Dat is precies de stille degradatie die deze tranche
//  moest uitsluiten, nu in beheervorm.
//
//  Het leesrecht verruimen was geen optie: `governance_audit_read` opent vraag,
//  antwoord en bronnen van collega's. Daarom `fn_adapterstand_fonds()` — een
//  definer-functie die fondsbreed leest en uitsluitend de gesloten
//  adaptertellers teruggeeft.
//
//  Het tabelpad blijft bestaan als TERUGVAL voor de omgeving waar die migratie
//  nog niet draait (de conventie hier is Supabase-eerst, maar een code-deploy
//  kan er niettemin vóór liggen). Die terugval is GELABELD en niet stil:
//  `reikwijdte` is een verplicht veld, dus een weergave kan hem niet vergeten te
//  lezen zonder dat de typecheck erover valt.
// ============================================================================
import { aggregeerAdapterMeta, type AdapterBeheerstand } from "./adaptermeta-beheer";

/** Het aantal logregels dat de stand ten hoogste leest. */
export const ADAPTERSTATUS_LIMIET = 500;

/** De naam van het fondsbrede aggregatiepad; één plek, zodat hij niet uiteenloopt. */
export const ADAPTERSTAND_RPC = "fn_adapterstand_fonds" as const;

/**
 * Waarover gaat deze stand werkelijk?
 *
 * `fonds` — alle vastgelegde beurten van het fonds, via het definer-pad.
 * `eigen_beurten` — uitsluitend de beurten van de kijker zelf, omdat het
 * fondsbrede pad niet beschikbaar was. De stand is dan geen fondsstand, en de
 * weergave MOET dat zeggen.
 */
export type Adapterstandreikwijdte = "fonds" | "eigen_beurten";

export interface Adapterstand extends AdapterBeheerstand {
  reikwijdte: Adapterstandreikwijdte;
}

/**
 * De smalle vorm van de queryketen die dit leespad gebruikt. De echte
 * Supabase-client voldoet eraan; een test kan hem eerlijk namaken.
 *
 * Bewust GEEN `any`: een namaakclient moet elke schakel implementeren die de
 * echte code aanroept, en een filter dat de code niet zet, past de namaak dus
 * ook niet toe. Daardoor is een weggevallen fondsfilter zichtbaar in het
 * RESULTAAT en niet alleen in de broncode.
 */
export interface MetaQuery {
  select: (kolommen: string) => MetaQuery;
  eq: (kolom: string, waarde: string) => MetaQuery;
  not: (kolom: string, operator: string, waarde: null) => MetaQuery;
  order: (kolom: string, opties: { ascending: boolean }) => MetaQuery;
  limit: (aantal: number) => PromiseLike<{
    data: { retrieval_meta: unknown }[] | null;
    error: unknown;
  }>;
}

export interface MetaBron {
  from: (tabel: string) => MetaQuery;
  rpc: (
    naam: string,
    parameters: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: unknown }>;
}

export interface AdapterstatusDeps {
  gebruikerId: string;
  /** Null = een profiel zonder fonds; dat hoort niets te kunnen lezen. */
  fondsId: string | null;
  /** De capabilitypoort. Wordt ALTIJD vóór enige lezing aangeroepen. */
  magBeheren: (gebruikerId: string) => Promise<boolean>;
  bron: MetaBron;
}

export type AdapterstatusUitkomst =
  | { status: 200; stand: Adapterstand }
  | { status: 403; fout: string }
  | { status: 503; fout: string };

const LEGE_DEKKING = {
  metarijen_gelezen: 0,
  metarijen_zonder_adapters: 0,
  metarijen_overgeslagen: 0,
  adapterrijen_overgeslagen: 0,
} as const;

/**
 * Leest de duurzame adapterdiagnostiek en aggregeert haar.
 *
 * Eerst het fondsbrede definer-pad; pas als dat niet beschikbaar is het
 * RLS-beperkte tabelpad, en dan met `reikwijdte: "eigen_beurten"`. Het
 * expliciete `.eq("fonds_id", …)` op dat tweede pad staat NAAST de RLS, niet in
 * plaats daarvan: een leespad dat alleen op RLS leunt is één policywijziging
 * verwijderd van een lek, en die wijziging gebeurt in een ander bestand dan dit.
 */
export async function leesAdapterstand(
  deps: AdapterstatusDeps
): Promise<AdapterstatusUitkomst> {
  if (!(await deps.magBeheren(deps.gebruikerId))) {
    return { status: 403, fout: "Onvoldoende rechten." };
  }
  // Fail-closed: zonder fonds is er geen tenant om binnen te blijven, dus ook
  // geen query. Een lege stand is hier het eerlijke antwoord — geen 403, want
  // de gebruiker mág beheren; er is alleen niets om te tonen.
  if (!deps.fondsId) {
    return {
      status: 200,
      stand: { regels: [], dekking: { ...LEGE_DEKKING }, volledig: true, reikwijdte: "fonds" },
    };
  }

  // ── 1. Het fondsbrede pad ────────────────────────────────────────────────
  // De functie kent geen fondsparameter: zij leidt fonds én rol af uit
  // `auth.uid()`. Er valt hier dus niets mee te geven wat de tenantgrens
  // verplaatst.
  const viaRpc = await deps.bron.rpc(ADAPTERSTAND_RPC, { p_limiet: ADAPTERSTATUS_LIMIET });
  if (!viaRpc.error && Array.isArray(viaRpc.data)) {
    return {
      status: 200,
      stand: { ...aggregeerAdapterMeta(viaRpc.data), reikwijdte: "fonds" },
    };
  }

  // ── 2. Terugval: RLS-beperkt, en als zodanig GELABELD ────────────────────
  const { data, error } = await deps.bron
    .from("governance_log")
    .select("retrieval_meta")
    .eq("fonds_id", deps.fondsId)
    .not("retrieval_meta", "is", null)
    // De kolom heet `aangemaakt`. `aangemaakt_op` bestaat wél op andere
    // tabellen, en dat is precies waarom een typefout hier zo makkelijk is: de
    // naam ziet er juist uit en PostgREST faalt pas op de server.
    .order("aangemaakt", { ascending: false })
    .limit(ADAPTERSTATUS_LIMIET);

  if (error) return { status: 503, fout: "De adapterstand kon niet worden gelezen." };

  return {
    status: 200,
    stand: {
      ...aggregeerAdapterMeta((data ?? []).map((r) => r.retrieval_meta)),
      reikwijdte: "eigen_beurten",
    },
  };
}
