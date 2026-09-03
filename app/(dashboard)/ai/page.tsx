// ============================================================================
//  /ai — server-wrapper (AI-startpunt P1, besluit 0085).
// ----------------------------------------------------------------------------
//  De chat-UI zelf is de client-component AssistentClient (mechanisch verhuisd
//  vanuit dit bestand). Deze server-component leidt de sessie server-side af
//  (haalFondsSessie via getPortaalContext — nooit fonds uit de URL), haalt de
//  gedeelde portaalcontext op en geeft die als startpuntdata door.
//
//  GATE: /ai kent GEEN eigen capability en had vóór P1 geen server-modulegate
//  (de (dashboard)-layout dwingt auth + host→fonds al af; het manifest stuurt
//  enkel nav-zichtbaarheid). We repliceren die situatie exact met een
//  sessie-only afleiding — géén nieuwe capability, géén manifest-gate (dat zou
//  het gedrag en de moduleregistry wijzigen; besluit 0085 §Alternatieven).
// ============================================================================

import { getPortaalContext } from "@/core/lib/portaalcontext";
import AssistentClient from "./_components/AssistentClient";

export default async function AiPage() {
  // Geen input → getPortaalContext leidt de sessie af via haalFondsSessie()
  // (redirect naar /login bij geen sessie/fonds). Dit is de effectieve gate.
  const startpuntContext = await getPortaalContext();
  return <AssistentClient startpuntContext={startpuntContext} />;
}
