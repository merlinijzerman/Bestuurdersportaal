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
//  Geen service-role, geen ruimer leesrecht, geen live Microsoft-call.
// ============================================================================
import { aggregeerAdapterMeta, type AdapterBeheerstand } from "./adaptermeta-beheer";

/** Het aantal logregels dat de stand ten hoogste leest. */
export const ADAPTERSTATUS_LIMIET = 500;

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
}

export interface AdapterstatusDeps {
  gebruikerId: string;
  /** Null = een profiel zonder fonds; dat hoort niets te kunnen lezen. */
  fondsId: string | null;
  /** De capabilitypoort. Wordt ALTIJD vóór de query aangeroepen. */
  magBeheren: (gebruikerId: string) => Promise<boolean>;
  bron: MetaBron;
}

export type AdapterstatusUitkomst =
  | { status: 200; stand: AdapterBeheerstand }
  | { status: 403; fout: string }
  | { status: 503; fout: string };

/**
 * Leest de duurzame adapterdiagnostiek van ÉÉN fonds en aggregeert haar.
 *
 * Het expliciete `.eq("fonds_id", …)` staat NAAST de RLS-policy, niet in plaats
 * daarvan: een leespad dat alleen op RLS leunt is één policywijziging verwijderd
 * van een lek, en die wijziging gebeurt in een ander bestand dan dit.
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
      stand: {
        regels: [],
        dekking: {
          metarijen_gelezen: 0,
          metarijen_zonder_adapters: 0,
          metarijen_overgeslagen: 0,
          adapterrijen_overgeslagen: 0,
        },
        volledig: true,
      },
    };
  }

  const { data, error } = await deps.bron
    .from("governance_log")
    .select("retrieval_meta")
    .eq("fonds_id", deps.fondsId)
    .not("retrieval_meta", "is", null)
    .order("aangemaakt_op", { ascending: false })
    .limit(ADAPTERSTATUS_LIMIET);

  if (error) return { status: 503, fout: "De adapterstand kon niet worden gelezen." };

  return { status: 200, stand: aggregeerAdapterMeta((data ?? []).map((r) => r.retrieval_meta)) };
}
