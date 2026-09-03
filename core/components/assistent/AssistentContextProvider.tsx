"use client";
// ============================================================================
//  Assistent L1 — de CONTEXTPROVIDER (P1a C4, besluit 0201).
// ----------------------------------------------------------------------------
//  Houdt vast waar de bestuurder naar kijkt en levert dat aan de gesprekslaag
//  (L2) en de presentatielaag (L3). Meer doet hij niet: geen database, geen
//  aanroep, geen payload.
//
//  DAT IS DE HELE POINTE. Modules leveren alléén context aan. Ze bouwen geen
//  eigen verzoek en kennen de velden niet die naar /api/chat gaan. Zo kan het
//  niet meer gebeuren wat bij de agendapuntchat gebeurde: een tweede,
//  verschraalde aanroep die stilzwijgend een ander antwoord geeft op dezelfde
//  vraag (ontwerpdoc "Eén generieke assistent" §2). Kan een module iets niet,
//  dan is dat een keuze in déze laag — zichtbaar in de contextchip.
//
//  In P1a staat de provider in `/ai`. In P1b verhuist hij naar `DashboardShell`,
//  zodat een paneel naast een module dezelfde context deelt zonder navigatie.
//  Die verhuizing raakt alleen de MOUNTPLEK; de waarde die hij levert en de
//  signatuur van `useAssistent` blijven zoals ze hier staan.
//
//  Geen supabase-client: het opzoeken van een deeplink hoort bij de
//  initialisatievolgorde van de gesprekslaag (profiel → hersteld gesprek → URL)
//  en gebeurt daar, met `assistent-url-ingang.ts` als enige ingang.
// ============================================================================

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  bepaalContextSoort,
  type AssistentContextWaarde,
} from "@/core/lib/assistent-context";
import type { Herkomst } from "@/core/lib/assistent-payload";
import type {
  AgendapuntContext,
  DocumentScope,
  ModuleScope,
} from "@/core/lib/assistent-types";

const AssistentContext = createContext<AssistentContextWaarde | null>(null);

export function AssistentContextProvider({
  children,
}: {
  children: ReactNode;
}) {
  // Drie velden náást elkaar, geen union: een agendapunt draagt zijn stukken als
  // documentscope en een module-scope sluit een documentscope niet uit. Zie de
  // toelichting in core/lib/assistent-context.ts.
  const [documentScope, zetDocumentScope] = useState<DocumentScope | null>(null);
  const [agendapuntContext, zetAgendapuntContext] =
    useState<AgendapuntContext | null>(null);
  const [moduleScope, zetModuleScope] = useState<ModuleScope | null>(null);
  // De risico's van het fonds voor de "verdiep dit risico"-chips (RLS-lijst,
  // alleen id + titel; de inhoud komt server-side per beurt).
  const [risicoLijst, zetRisicoLijst] = useState<{ id: string; titel: string }[]>([]);
  // De module-ingang (`?intent=`/`?herkomst=`): een bevestigde bron-intentie die
  // voor dit gesprek geldt. "Nieuw gesprek" wist hem.
  const [herkomst, zetHerkomst] = useState<Herkomst | null>(null);

  const waarde = useMemo<AssistentContextWaarde>(
    () => ({
      documentScope,
      zetDocumentScope,
      agendapuntContext,
      zetAgendapuntContext,
      moduleScope,
      zetModuleScope,
      risicoLijst,
      zetRisicoLijst,
      herkomst,
      zetHerkomst,
      // Afgeleid, niet opgeslagen.
      soort: bepaalContextSoort({ documentScope, agendapuntContext, moduleScope }),
    }),
    [
      documentScope,
      agendapuntContext,
      moduleScope,
      risicoLijst,
      herkomst,
      // De setters zijn stabiel, maar de React Compiler leidt ze wél als
      // afhankelijkheid af; ze weglaten laat hem de memoisatie overslaan.
      zetDocumentScope,
      zetAgendapuntContext,
      zetModuleScope,
      zetRisicoLijst,
      zetHerkomst,
    ]
  );

  return (
    <AssistentContext.Provider value={waarde}>{children}</AssistentContext.Provider>
  );
}

/**
 * De context van de assistent.
 *
 * Werpt bewust als er geen provider boven staat. Een stille terugval op "geen
 * context" zou precies de fout opleveren die deze laag moet uitsluiten: een
 * assistent die fondsbreed antwoordt terwijl de bestuurder naar één stuk kijkt,
 * zonder dat iets in de interface dat verklaart.
 */
export function useAssistentContext(): AssistentContextWaarde {
  const waarde = useContext(AssistentContext);
  if (!waarde) {
    throw new Error(
      "useAssistentContext() vereist een <AssistentContextProvider> erboven."
    );
  }
  return waarde;
}
