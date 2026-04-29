import Link from "next/link";
import NieuwRisicoForm from "../_components/NieuwRisicoForm";

export default function NieuwRisicoPage() {
  return (
    <div className="p-7 max-w-3xl">
      <Link
        href="/risicomatrix"
        className="text-sm text-gray-500 hover:text-[#0F2744] inline-flex items-center gap-1"
      >
        ← Terug naar matrix
      </Link>
      <h1 className="text-[#0F2744] text-xl font-bold mt-2">
        Nieuw risico vastleggen
      </h1>
      <p className="text-gray-500 text-sm mt-0.5">
        Geef een titel, kies een categorie, en bepaal kans en impact. Het
        risiconiveau wordt automatisch afgeleid &mdash; je kunt het
        handmatig overschrijven indien nodig.
      </p>
      <div className="mt-6">
        <NieuwRisicoForm />
      </div>
    </div>
  );
}
