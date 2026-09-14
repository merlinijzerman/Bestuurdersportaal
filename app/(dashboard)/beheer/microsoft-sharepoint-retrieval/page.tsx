import { notFound, redirect } from "next/navigation";
import { requireCapability } from "@/core/lib/capabilities";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { vereisModuleToegang } from "@/core/lib/module-gate-page";
import { sharePointRetrievalSmokeToegestaan } from "@/core/lib/microsoft-sharepoint-retrieval-smoke-gate";
import SharePointRetrievalSmoke from "./_components/SharePointRetrievalSmoke";

export const dynamic = "force-dynamic";

export default async function SharePointRetrievalSmokePagina() {
  const sessie = await vereisModuleToegang("beheer", "catalog.manage");
  if (!(await requireCapability(sessie.userId, "login.beleid.manage"))) redirect("/beheer");
  const supabase = await createServerSupabase();
  if (!(await sharePointRetrievalSmokeToegestaan(supabase, sessie.fondsId))) notFound();

  return (
    <div className="p-8 max-w-6xl mx-auto w-full">
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-bold text-ink">SharePoint-retrieval — Preview-smoke</h1>
        <p className="text-muted text-sm mt-1">
          Vergelijk de twee live Microsoft-routes met uitsluitend de synthetische PGB-fixtures. De test bewaart geen documentinhoud.
        </p>
      </div>
      <SharePointRetrievalSmoke />
    </div>
  );
}
