import { createServerSupabase } from "@/lib/supabase-server";
import Link from "next/link";
import NieuweVergaderingForm from "./_components/NieuweVergaderingForm";

interface Vergadering {
  id: string;
  titel: string;
  datum: string;
  locatie: string | null;
  status: "gepland" | "in_voorbereiding" | "afgerond";
  aangemaakt: string;
}

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  gepland: { bg: "bg-blue-50", text: "text-blue-700", label: "Gepland" },
  in_voorbereiding: { bg: "bg-amber-50", text: "text-amber-800", label: "In voorbereiding" },
  afgerond: { bg: "bg-gray-100", text: "text-gray-600", label: "Afgerond" },
};

function formatDatum(d: string) {
  return new Date(d).toLocaleString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function VergaderingenPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profiel } = await supabase
    .from("profielen")
    .select("fonds_id")
    .eq("id", user.id)
    .single();

  const { data: vergaderingen } = await supabase
    .from("vergaderingen")
    .select("*")
    .eq("fonds_id", profiel?.fonds_id || "")
    .order("datum", { ascending: false });

  const lijst = (vergaderingen || []) as Vergadering[];
  const nu = new Date();
  const komend = lijst
    .filter((v) => new Date(v.datum) >= nu)
    .sort((a, b) => new Date(a.datum).getTime() - new Date(b.datum).getTime());
  const afgelopen = lijst.filter((v) => new Date(v.datum) < nu);

  return (
    <div className="p-7 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[#0F2744] text-xl font-bold">Vergaderingen</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Plan, agendeer en bereid bestuursvergaderingen voor.
          </p>
        </div>
        <NieuweVergaderingForm />
      </div>

      <section>
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
          Komend ({komend.length})
        </div>
        {komend.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-300 rounded-xl p-8 text-center text-sm text-gray-500">
            Nog geen geplande vergaderingen. Maak hierboven een nieuwe vergadering aan.
          </div>
        ) : (
          <div className="space-y-2">
            {komend.map((v) => (
              <VergaderingKaart key={v.id} v={v} />
            ))}
          </div>
        )}
      </section>

      {afgelopen.length > 0 && (
        <section>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
            Afgelopen ({afgelopen.length})
          </div>
          <div className="space-y-2">
            {afgelopen.slice(0, 10).map((v) => (
              <VergaderingKaart key={v.id} v={v} variant="afgelopen" />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function VergaderingKaart({
  v,
  variant,
}: {
  v: Vergadering;
  variant?: "afgelopen";
}) {
  const badge = STATUS_BADGE[v.status] || STATUS_BADGE.in_voorbereiding;
  return (
    <Link
      href={`/vergaderingen/${v.id}`}
      className={`block bg-white border border-gray-200 rounded-xl p-4 hover:border-[#C9A84C] transition-colors ${
        variant === "afgelopen" ? "opacity-75" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-semibold text-[#0F2744] text-sm">{v.titel}</div>
          <div className="text-xs text-gray-500 mt-1">
            {formatDatum(v.datum)}
            {v.locatie ? ` · ${v.locatie}` : ""}
          </div>
        </div>
        <span
          className={`text-xs font-medium px-2.5 py-1 rounded-md ${badge.bg} ${badge.text}`}
        >
          {badge.label}
        </span>
      </div>
    </Link>
  );
}
