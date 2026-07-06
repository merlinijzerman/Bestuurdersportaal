import Link from "next/link";
import NieuweProcedureForm from "../_components/NieuweProcedureForm";
import { TEMPLATES } from "@/lib/proces-templates";

export default function NieuweProcedurePage() {
  return (
    <div className="p-4 sm:p-6 lg:p-7 max-w-3xl">
      <Link
        href="/procedures"
        className="text-sm text-muted hover:text-ink inline-flex items-center gap-1"
      >
        ← Terug naar procedures
      </Link>
      <h1 className="font-serif text-ink text-xl font-bold mt-2">
        Start een nieuwe procedure
      </h1>
      <p className="text-muted text-sm mt-0.5">
        Kies een procestemplate. De stappen, checklist-items en bewijsvereisten
        worden automatisch op basis van de template ingericht.
      </p>
      <div className="mt-6">
        <NieuweProcedureForm templates={TEMPLATES} />
      </div>
    </div>
  );
}
