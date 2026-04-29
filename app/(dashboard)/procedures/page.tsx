import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase-server";
import { templateLabel, PROCEDURE_STATUS_LABEL } from "@/lib/proces-templates";

interface ProcedureRij {
  id: string;
  template_code: string;
  titel: string;
  beschrijving: string | null;
  status: "in_uitvoering" | "wacht_op_besluit" | "afgerond";
  gestart_op: string;
  deadline: string | null;
}

interface StapTeller {
  procedure_id: string;
  totaal: number;
  afgerond: number;
  actief_naam: string | null;
  actief_volgorde: number | null;
}

const STATUS_PILL: Record<string, { bg: string; text: string }> = {
  in_uitvoering: { bg: "bg-blue-50", text: "text-blue-700" },
  wacht_op_besluit: { bg: "bg-amber-50", text: "text-amber-800" },
  afgerond: { bg: "bg-gray-100", text: "text-gray-600" },
};

function formatDatum(d: string) {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function ProceduresPage() {
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

  const { data: procedures } = await supabase
    .from("procedures")
    .select("id, template_code, titel, beschrijving, status, gestart_op, deadline")
    .eq("fonds_id", profiel?.fonds_id || "")
    .order("gestart_op", { ascending: false });

  const lijst = (procedures || []) as ProcedureRij[];

  // Voortgang per procedure ophalen (totaal + afgerond + naam actieve stap)
  const stappenPerProc = new Map<string, StapTeller>();
  if (lijst.length > 0) {
    const ids = lijst.map((p) => p.id);
    const { data: stappen } = await supabase
      .from("procedure_stappen")
      .select("procedure_id, status, naam, volgorde")
      .in("procedure_id", ids)
      .order("volgorde", { ascending: true });

    for (const p of lijst) {
      const eigen = (stappen || []).filter(
        (s: { procedure_id: string }) => s.procedure_id === p.id
      );
      const afgerond = eigen.filter(
        (s: { status: string }) => s.status === "afgerond"
      ).length;
      const actief = eigen.find((s: { status: string }) => s.status === "actief");
      stappenPerProc.set(p.id, {
        procedure_id: p.id,
        totaal: eigen.length,
        afgerond,
        actief_naam: actief?.naam ?? null,
        actief_volgorde: actief?.volgorde ?? null,
      });
    }
  }

  // Co-eigenaren ophalen
  const eigenarenPerProc = new Map<string, string[]>();
  if (lijst.length > 0) {
    const { data: eigenaren } = await supabase
      .from("procedure_eigenaars")
      .select("procedure_id, gebruiker_naam")
      .in(
        "procedure_id",
        lijst.map((p) => p.id)
      );
    for (const e of (eigenaren || []) as {
      procedure_id: string;
      gebruiker_naam: string;
    }[]) {
      const lijstE = eigenarenPerProc.get(e.procedure_id) ?? [];
      lijstE.push(e.gebruiker_naam);
      eigenarenPerProc.set(e.procedure_id, lijstE);
    }
  }

  const lopend = lijst.filter((p) => p.status !== "afgerond");
  const afgerond = lijst.filter((p) => p.status === "afgerond");

  return (
    <div className="p-7 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[#0F2744] text-xl font-bold">Procedures</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Lopende processen, beleidswijzigingen en besluittrajecten van het fonds.
          </p>
        </div>
        <Link
          href="/procedures/nieuw"
          className="bg-[#0F2744] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#1a3858]"
        >
          + Nieuwe procedure
        </Link>
      </div>

      <section>
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
          Lopend ({lopend.length})
        </div>
        {lopend.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-300 rounded-xl p-8 text-center text-sm text-gray-500">
            Nog geen lopende procedures. Start hierboven een nieuwe.
          </div>
        ) : (
          <div className="space-y-2">
            {lopend.map((p) => (
              <ProcedureKaart
                key={p.id}
                p={p}
                teller={stappenPerProc.get(p.id)}
                eigenaren={eigenarenPerProc.get(p.id) ?? []}
              />
            ))}
          </div>
        )}
      </section>

      {afgerond.length > 0 && (
        <section>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
            Afgerond ({afgerond.length})
          </div>
          <div className="space-y-2">
            {afgerond.slice(0, 10).map((p) => (
              <ProcedureKaart
                key={p.id}
                p={p}
                teller={stappenPerProc.get(p.id)}
                eigenaren={eigenarenPerProc.get(p.id) ?? []}
                variant="afgerond"
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ProcedureKaart({
  p,
  teller,
  eigenaren,
  variant,
}: {
  p: ProcedureRij;
  teller?: StapTeller;
  eigenaren: string[];
  variant?: "afgerond";
}) {
  const pillKleur = STATUS_PILL[p.status] || STATUS_PILL.in_uitvoering;
  const voortgang =
    teller && teller.totaal > 0 ? (teller.afgerond / teller.totaal) * 100 : 0;
  return (
    <Link
      href={`/procedures/${p.id}`}
      className={`block bg-white border border-gray-200 rounded-xl p-4 hover:border-[#C9A84C] transition-colors ${
        variant === "afgerond" ? "opacity-80" : ""
      }`}
    >
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[10px] font-medium uppercase tracking-wide text-purple-700 bg-purple-50 px-2 py-0.5 rounded">
              {templateLabel(p.template_code)}
            </span>
            <span
              className={`text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded ${pillKleur.bg} ${pillKleur.text}`}
            >
              {PROCEDURE_STATUS_LABEL[p.status] || p.status}
            </span>
          </div>
          <div className="font-semibold text-[#0F2744] text-sm">{p.titel}</div>
          {p.beschrijving && (
            <p className="text-xs text-gray-600 mt-0.5 line-clamp-1">
              {p.beschrijving}
            </p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 flex-wrap">
            {teller && teller.totaal > 0 && (
              <span>
                Stap {teller.afgerond + (teller.actief_volgorde ? 1 : 0)} van{" "}
                {teller.totaal}
                {teller.actief_naam ? ` — ${teller.actief_naam}` : ""}
              </span>
            )}
            {p.deadline && (
              <>
                <span>·</span>
                <span>Deadline {formatDatum(p.deadline)}</span>
              </>
            )}
            <span>·</span>
            <span>Gestart {formatDatum(p.gestart_op)}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          {eigenaren.length > 0 && (
            <div className="flex -space-x-2">
              {eigenaren.slice(0, 3).map((n, idx) => (
                <div
                  key={`${p.id}-eigenaar-${idx}`}
                  title={n}
                  className="w-7 h-7 rounded-full bg-purple-200 text-purple-900 text-[10px] flex items-center justify-center font-medium border-2 border-white"
                >
                  {initialen(n)}
                </div>
              ))}
              {eigenaren.length > 3 && (
                <div className="w-7 h-7 rounded-full bg-gray-100 text-gray-700 text-[10px] flex items-center justify-center font-medium border-2 border-white">
                  +{eigenaren.length - 3}
                </div>
              )}
            </div>
          )}
          {teller && teller.totaal > 0 && (
            <div className="w-32 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#C9A84C]"
                style={{ width: `${voortgang}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

function initialen(naam: string): string {
  return naam
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
