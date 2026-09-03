import type { ReactNode } from "react";
import { AssistentContextProvider } from "@/core/components/assistent/AssistentContextProvider";
import {
  AssistentPaneelProvider,
  useAssistentPaneelStaat,
  type AssistentPaneelWaarde,
} from "@/core/components/assistent/AssistentPaneelProvider";

/**
 * De twee providers die `DashboardShell` sinds T1 om het oppervlak zet.
 *
 * Vóór T1 mountte `AssistentClient` zijn eigen contextprovider en was een test
 * met één component genoeg. Die premisse klopt niet meer: het oppervlak is nu
 * de inhoud van het paneel en verwacht beide providers erboven. Dit harnas
 * levert ze — met dezelfde hook als de schil, zodat een test niet per ongeluk
 * een tweede, afwijkende paneelstaat namaakt.
 */
export function AssistentHarnas({
  aiBeschikbaar = true,
  onWaarde,
  children,
}: {
  aiBeschikbaar?: boolean;
  /** Geeft de test toegang tot de paneelstaat (stand, openMet, …). */
  onWaarde?: (waarde: AssistentPaneelWaarde) => void;
  children: ReactNode;
}) {
  const waarde = useAssistentPaneelStaat({ aiBeschikbaar });
  onWaarde?.(waarde);
  return (
    <AssistentContextProvider>
      <AssistentPaneelProvider waarde={waarde}>{children}</AssistentPaneelProvider>
    </AssistentContextProvider>
  );
}
