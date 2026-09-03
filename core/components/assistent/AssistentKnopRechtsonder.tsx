"use client";
// ============================================================================
//  Assistent — de generieke ingang, rechtsonder (T1, besluit 0204).
// ----------------------------------------------------------------------------
//  Dit is de ENIGE generieke ingang. Besluit van 3-9-2026: géén assistentknop
//  in de topbalk — die zou naast de module-eigen knoppen een tweede,
//  concurrerende ingang zijn. Het effect is meetbaar: gebruikt niemand deze
//  knop, dan is de topbalk alsnog een optie; andersom is een knop terugnemen
//  lastiger.
//
//  Hij is een toggle en geen "open"-knop, omdat hij anders bij een open paneel
//  een knop is die niets doet. `aria-expanded` zegt daarmee de waarheid.
// ============================================================================

import { useAssistentPaneel } from "./AssistentPaneelProvider";

export default function AssistentKnopRechtsonder() {
  const { stand, aiBeschikbaar, openGeneriek, sluit } = useAssistentPaneel();
  if (!aiBeschikbaar) return null;

  const open = stand !== "dicht";
  // In volledig scherm dekt het paneel de contentkolom af; een zwevende knop
  // erbovenop zou over het gesprek heen liggen.
  if (stand === "volledig") return null;

  return (
    <button
      type="button"
      onClick={() => (open ? sluit() : openGeneriek())}
      aria-expanded={open}
      aria-controls="assistent-paneel"
      aria-label={open ? "Assistent sluiten" : "Assistent openen"}
      className="fixed bottom-4 right-4 z-30 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-card transition-colors hover:bg-accent-ink"
    >
      <span aria-hidden>{open ? "✕" : "✦"}</span>
      <span className="max-sm:hidden">{open ? "Sluiten" : "Assistent"}</span>
    </button>
  );
}
