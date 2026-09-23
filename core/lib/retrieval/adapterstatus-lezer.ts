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
//  ── WAAROM HET FONDSBREDE PAD EEN RPC IS ───────────────────────────────────
//  De RLS-policy op `governance_log` luidt
//  `gebruiker_id = auth.uid() or public.mag_audit(fonds_id)`. Een gewone
//  tabelquery levert een beheerder dus alleen zijn EIGEN beurten — en
//  presenteerde die als de stand van het fonds. Dat is de stille degradatie die
//  deze tranche moest uitsluiten, nu in beheervorm.
//
//  `fn_adapterstand_fonds()` lost dat op ZONDER het auditbeleid te verruimen.
//  Zij volgt besluit 0119 letterlijk: zonder `governance_audit_read` krijgt de
//  kijker alleen zijn eigen beurten en wordt er niets gelogd; mét die capability
//  het hele fonds, en dan schrijft zij een regel in `governance_audit_inzage`.
//  De rol `beheerder` geeft hier dus GEEN fondsbrede inzage — dat is precies het
//  alternatief dat 0119 heeft verworpen.
//
//  DE REIKWIJDTE KOMT VAN DE SERVER. `fondsbreed` staat in het antwoord van de
//  functie; deze laag leidt hem niet af. Zou zij dat wel doen, dan gokt zij over
//  reikwijdte, en een gok over reikwijdte is hoe een eigen stand als fondsstand
//  op het scherm komt.
//
//  TERUGVAL ALLEEN BIJ EEN ONTBREKENDE FUNCTIE, EN ALLEEN OP DE EIGEN BEURTEN.
//  De conventie is Supabase-eerst, maar een code-deploy kan vóór de migratie
//  liggen; dan is een gelabelde, beperkte stand beter dan een lege pagina. Die
//  terugval filtert EXPLICIET op `gebruiker_id`, want RLS alleen is daar niet
//  genoeg: voor een houder van `governance_audit_read` laat de policy ook de
//  beurten van collega's door, en dit pad schrijft geen inzageregel. Zonder dat
//  filter zou de terugval ongelogde inzage in andermans metadata opleveren en
//  die ook nog als "alleen uw eigen beurten" labelen.
//
//  Elke ANDERE fout — een weigering, een defecte functie, een schrijffout op de
//  inzageregel — levert 503. Een brede terugval zou een geweigerde of kapotte
//  inzage laten lijken op een normale, beperkte stand, en dat is dezelfde
//  stille degradatie in een nieuwe vermomming.
// ============================================================================
import { aggregeerAdapterMeta, type AdapterBeheerstand } from "./adaptermeta-beheer";

/** Het aantal logregels dat de stand ten hoogste leest. */
export const ADAPTERSTATUS_LIMIET = 500;

/** De naam van het fondsbrede aggregatiepad; één plek, zodat hij niet uiteenloopt. */
export const ADAPTERSTAND_RPC = "fn_adapterstand_fonds" as const;

/**
 * Waarover gaat deze stand werkelijk?
 *
 * `fonds` — alle vastgelegde beurten van het fonds. Alleen met de capability
 * `governance_audit_read`, en er staat dan een regel in
 * `governance_audit_inzage`.
 * `eigen_beurten` — uitsluitend de beurten van de kijker zelf: hij heeft die
 * capability niet, of het fondsbrede pad bestaat nog niet op deze omgeving. De
 * stand is dan geen fondsstand, en de weergave MOET dat zeggen.
 */
export type Adapterstandreikwijdte = "fonds" | "eigen_beurten";

/**
 * De foutcodes die betekenen: de functie bestaat hier (nog) niet.
 *
 * `42883` is Postgres' `undefined_function`; `PGRST202` is PostgREST' eigen
 * melding dat de RPC niet in de schema-cache staat. Uitsluitend deze twee
 * rechtvaardigen een terugval — al het andere is een fout en hoort als fout te
 * eindigen.
 */
const ONTBREKENDE_FUNCTIE: readonly string[] = ["42883", "PGRST202"];

function functieOntbreekt(fout: unknown): boolean {
  if (typeof fout !== "object" || fout === null) return false;
  const code = (fout as { code?: unknown }).code;
  return typeof code === "string" && ONTBREKENDE_FUNCTIE.includes(code);
}

/** Het antwoord van `fn_adapterstand_fonds()`. */
interface Adapterstandantwoord {
  fondsbreed: boolean;
  rijen: unknown[];
}

function alsAntwoord(data: unknown): Adapterstandantwoord | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const d = data as { fondsbreed?: unknown; rijen?: unknown };
  if (typeof d.fondsbreed !== "boolean" || !Array.isArray(d.rijen)) return null;
  return { fondsbreed: d.fondsbreed, rijen: d.rijen };
}

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

  // ── 1. Het pad dat het auditbeleid van 0119 volgt ────────────────────────
  // De functie kent geen fondsparameter: zij leidt het fonds af uit
  // `auth.uid()` en beslist zelf, op de capability, of het fondsbreed mag. Er
  // valt hier dus niets mee te geven wat de tenantgrens of de reikwijdte
  // verplaatst.
  const viaRpc = await deps.bron.rpc(ADAPTERSTAND_RPC, { p_limiet: ADAPTERSTATUS_LIMIET });
  if (!viaRpc.error) {
    const antwoord = alsAntwoord(viaRpc.data);
    // Fail-closed: een antwoord in een vorm die we niet herkennen, is geen
    // reden om stilletjes op een ander pad over te stappen.
    if (!antwoord) return { status: 503, fout: "De adapterstand kon niet worden gelezen." };
    return {
      status: 200,
      stand: {
        ...aggregeerAdapterMeta(antwoord.rijen),
        reikwijdte: antwoord.fondsbreed ? "fonds" : "eigen_beurten",
      },
    };
  }
  // Een weigering, een defecte functie of een mislukte inzageregel is een FOUT.
  // Alleen "de functie bestaat hier nog niet" rechtvaardigt het oude pad.
  if (!functieOntbreekt(viaRpc.error)) {
    return { status: 503, fout: "De adapterstand kon niet worden gelezen." };
  }

  // ── 2. Terugval: EXPLICIET tot de eigen beurten beperkt ──────────────────
  // Hier stond eerder alleen het fondsfilter, met de redenering dat
  // `eigen_beurten` "de eerlijke ondergrens" was omdat deze laag niet kan
  // vaststellen of de kijker de auditgrant heeft. Dat was fout. De RLS-policy
  // is `gebruiker_id = auth.uid() or public.mag_audit(fonds_id)`: voor een
  // HOUDER van `governance_audit_read` laat zij de beurten van collega's
  // gewoon door. Dit pad schrijft geen inzageregel, dus zo'n lezing was inzage
  // in andermans metadata zonder spoor — precies wat 0119 verbiedt — én zij
  // werd aan de gebruiker gepresenteerd als "alleen uw eigen beurten".
  //
  // Het filter hieronder maakt dat label WAAR BIJ CONSTRUCTIE in plaats van
  // bij aanname. Daarmee is er ook geen inzageregel nodig: je eigen spoor
  // inzien is geen inzage in dat van een ander. Wie fondsbreed wil kijken,
  // krijgt dat uitsluitend via de RPC — en die logt.
  const { data, error } = await deps.bron
    .from("governance_log")
    .select("retrieval_meta")
    .eq("fonds_id", deps.fondsId)
    .eq("gebruiker_id", deps.gebruikerId)
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
