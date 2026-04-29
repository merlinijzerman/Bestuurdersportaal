import Link from "next/link";
import NieuweProcedureForm from "../_components/NieuweProcedureForm";
import { TEMPLATES } from "@/lib/proces-templates";

export default function NieuweProcedurePage() {
  return (
    <div className="p-7 max-w-3xl">
      <Link
        href="/procedures"
        className="text-sm text-gray-500 hover:text-[#0F2744] inline-flex items-center gap-1"
      >
        ← Terug naar procedures
      </Link>
      <h1 className="text-[#0F2744] text-xl font-bold mt-2">
        Start een nieuwe procedure
      </h1>
      <p className="text-gray-500 text-sm mt-0.5">
        Kies een procestemplate. De stappen, checklist-items en bewijsvereisten
        worden automatisch op basis van de template ingericht.
      </p>
      <div className="mt-6">
        <NieuweProcedureForm templates={TEMPLATES} />
      </div>
    </div>
  );
}
