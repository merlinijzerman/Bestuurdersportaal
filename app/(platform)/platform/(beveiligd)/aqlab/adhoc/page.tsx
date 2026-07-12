// ============================================================================
//  Scherm 6b — Ad-hoc consistentietest. INGANG VERVALLEN (AQL-6.1): de ad-hoc-
//  test is geconsolideerd in het samenstel-formulier (scherm 3, run-type ad_hoc,
//  synchroon + persist_mode none). Deze route redirect naar het Lab zodat er geen
//  tweede, bookmarkbare ad-hoc-ingang overblijft. De client-component
//  (adhoc-form.tsx) + server-action blijven staan (niet verwijderd).
// ============================================================================

import { redirect } from "next/navigation";

export default function AdHocPagina() {
  redirect("/platform/aqlab");
}
