// Dossier-tijdlijn (Increment B). Toont de zes generieke fases
// (oriëntatie→analyse→advies→besluitvorming→implementatie→evaluatie) en
// plaatst per fase de bijbehorende processtappen + de daaraan gekoppelde
// bewijsstukken. Documenten die op dossierniveau aan de procesinstantie
// zijn gekoppeld (documenten.procesinstantie_id) — maar niet aan een stap —
// verschijnen in een aparte "dossierbreed" strook.
//
// De fase per stap wordt deterministisch afgeleid uit de ordinale positie
// (zie lib/dossier.tijdlijnfaseVanStap); een per-stap fase-veld komt in een
// latere increment uit de procescatalogus.

import {
  TIJDLIJNFASES,
  TIJDLIJNFASE_LABEL,
  tijdlijnfaseVanStap,
  type Tijdlijnfase,
} from "@/lib/dossier";

interface TijdlijnStap {
  id: string;
  volgorde: number;
  naam: string;
  status: "open" | "actief" | "afgerond";
}

interface TijdlijnBewijs {
  id: string;
  stap_id: string;
  titel: string;
}

interface DossierDocument {
  id: string;
  titel: string;
}

interface Props {
  stappen: TijdlijnStap[];
  bewijs: TijdlijnBewijs[];
  dossierDocumenten: DossierDocument[];
}

const STAP_STATUS_DOT: Record<TijdlijnStap["status"], string> = {
  afgerond: "bg-emerald-500",
  actief: "bg-[#C9A84C]",
  open: "bg-gray-300",
};

export default function DossierTijdlijn({
  stappen,
  bewijs,
  dossierDocumenten,
}: Props) {
  const totaal = stappen.length;
  const bewijsPerStap = new Map<string, TijdlijnBewijs[]>();
  for (const b of bewijs) {
    const lijst = bewijsPerStap.get(b.stap_id) ?? [];
    lijst.push(b);
    bewijsPerStap.set(b.stap_id, lijst);
  }

  // Stappen per fase groeperen.
  const stappenPerFase = new Map<Tijdlijnfase, TijdlijnStap[]>();
  for (const s of stappen) {
    const fase = tijdlijnfaseVanStap(s.volgorde, totaal);
    const lijst = stappenPerFase.get(fase) ?? [];
    lijst.push(s);
    stappenPerFase.set(fase, lijst);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-[#0F2744] font-bold text-sm">Tijdlijn</h2>
        <span className="text-[11px] text-gray-400 uppercase tracking-wide">
          Dossierfases
        </span>
      </div>

      <div className="space-y-4">
        {TIJDLIJNFASES.map((fase) => {
          const faseStappen = stappenPerFase.get(fase) ?? [];
          const heeftInhoud = faseStappen.length > 0;
          return (
            <div key={fase} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div
                  className={`w-3 h-3 rounded-full ${
                    heeftInhoud ? "bg-[#0F2744]" : "bg-gray-200"
                  }`}
                />
                <div className="flex-1 w-px bg-gray-200 mt-1" />
              </div>
              <div className="flex-1 pb-2">
                <div
                  className={`text-xs font-semibold uppercase tracking-wide ${
                    heeftInhoud ? "text-[#0F2744]" : "text-gray-400"
                  }`}
                >
                  {TIJDLIJNFASE_LABEL[fase]}
                </div>
                {faseStappen.map((s) => {
                  const docs = bewijsPerStap.get(s.id) ?? [];
                  return (
                    <div key={s.id} className="mt-1.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            STAP_STATUS_DOT[s.status]
                          }`}
                        />
                        <span className="text-sm text-gray-800">{s.naam}</span>
                      </div>
                      {docs.length > 0 && (
                        <ul className="ml-4 mt-1 space-y-0.5">
                          {docs.map((d) => (
                            <li
                              key={d.id}
                              className="text-xs text-gray-500 truncate"
                              title={d.titel}
                            >
                              📄 {d.titel}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
                {!heeftInhoud && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Nog geen stappen in deze fase.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {dossierDocumenten.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
            Dossierbreed gekoppeld ({dossierDocumenten.length})
          </div>
          <ul className="space-y-0.5">
            {dossierDocumenten.map((d) => (
              <li
                key={d.id}
                className="text-xs text-gray-600 truncate"
                title={d.titel}
              >
                📄 {d.titel}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
