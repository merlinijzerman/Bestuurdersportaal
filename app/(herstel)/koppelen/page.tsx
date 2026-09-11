// ============================================================================
//  /koppelen — vaste ingang van de beperkte koppel-/herstelsessie (fase 1C, #344
//  PR-B; ontwerp §6.2). De uitnodigingslink is `/koppelen#<token>`.
// ----------------------------------------------------------------------------
//  De server ziet het token NOOIT via deze pagina: het staat in het fragment, dat
//  de browser niet meestuurt. De pagina rendert alleen uitleg en de knop; het
//  clientcomponent leest het fragment, wist het direct uit de adresbalk en stuurt
//  het uitsluitend in de body van een POST naar /auth/microsoft-login/uitnodiging.
//  Geen sessie nodig, geen fondsdata, geen analytics (eigen root-layout).
// ============================================================================
import KoppelActivering from "./_components/KoppelActivering";

export const dynamic = "force-dynamic";

export default function KoppelenPagina() {
  return <KoppelActivering />;
}
