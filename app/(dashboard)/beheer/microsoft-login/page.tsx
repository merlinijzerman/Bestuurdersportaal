import { redirect } from "next/navigation";
import { requireCapability } from "@/core/lib/capabilities";
import { vereisModuleToegang } from "@/core/lib/module-gate-page";
import LoginBeleidBeheer from "./_components/LoginBeleidBeheer";

// ============================================================================
//  /beheer/microsoft-login — beheer van het organisatiebrede Microsoft-login-
//  beleid (fase 1C, #344 PR-B; besluit 0212). Server-side gegate op de module
//  `beheer` én de smalle capability `login.beleid.manage` (alleen beheerder);
//  de API-routes toetsen dat opnieuw en de database is de echte grens.
// ============================================================================
export const dynamic = "force-dynamic";

export default async function MicrosoftLoginBeheerPagina() {
  const sessie = await vereisModuleToegang("beheer", "catalog.manage");
  if (!(await requireCapability(sessie.userId, "login.beleid.manage"))) redirect("/beheer");

  return (
    <div className="p-8 max-w-6xl mx-auto w-full">
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-bold text-ink">Microsoft-login</h1>
        <p className="text-muted text-sm mt-1">
          Beleid, dekking, noodtoegang en herstel van Microsoft-koppelingen voor dit fonds. Elke wijziging wordt
          append-only vastgelegd; de database dwingt de voorwaarden af.
        </p>
      </div>
      <LoginBeleidBeheer />
    </div>
  );
}
