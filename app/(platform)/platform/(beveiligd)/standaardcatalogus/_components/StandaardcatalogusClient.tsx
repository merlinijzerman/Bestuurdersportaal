"use client";

// ============================================================================
//  Standaardcatalogus — beheer-UI (Increment P2/B14, FO §9).
// ----------------------------------------------------------------------------
//  Pure presentatie + formulierstate; ALLE mutaties lopen via de server-actions
//  (acties.ts) achter withPlatform. Per catalogus (gremia/commissies, expertises,
//  focusgebieden) een tab met: lijst, toevoegen, hernoemen/omschrijving en
//  (de)activeren. Wijzigen/(de)activeren dragen een VERPLICHTE reden (change
//  control, FO §9.2) die mee de audit in gaat.
// ============================================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  catalogusTemplateAanmaken,
  catalogusTemplateBijwerken,
  catalogusTemplateActief,
  type CatalogusTabel,
  type CatalogusResultaat,
} from "../acties";

export interface CatalogusItem {
  id: string;
  naam: string;
  type?: string | null;
  categorie?: string | null;
  omschrijving: string | null;
  actief: boolean;
  sort_order: number | null;
}

interface Props {
  gremia: CatalogusItem[];
  expertises: CatalogusItem[];
  focusgebieden: CatalogusItem[];
  magBeheren: boolean;
}

const GREMIA_TYPES = [
  "besluitvormend",
  "adviserend",
  "toezichthoudend",
  "uitvoerend",
] as const;

const TYPE_LABEL: Record<string, string> = {
  besluitvormend: "Besluitvormend",
  adviserend: "Adviserend (commissie)",
  toezichthoudend: "Toezichthoudend",
  uitvoerend: "Uitvoerend",
};

const GREMIA_CATEGORIEEN = [
  "fondsorgaan",
  "bestuurscommissie",
  "extern_ketenpartner",
] as const;

const CATEGORIE_LABEL: Record<string, string> = {
  fondsorgaan: "Fondsorgaan",
  bestuurscommissie: "Bestuurscommissie",
  extern_ketenpartner: "Externe ketenpartner",
};

const TABS: { sleutel: CatalogusTabel; label: string }[] = [
  { sleutel: "gremia", label: "Gremia & commissies" },
  { sleutel: "expertises", label: "Expertises" },
  { sleutel: "kritische_focusgebieden", label: "Kritische focusgebieden" },
];

type Melding = { soort: "ok" | "fout"; tekst: string } | null;

export default function StandaardcatalogusClient({
  gremia,
  expertises,
  focusgebieden,
  magBeheren,
}: Props) {
  const [tab, setTab] = useState<CatalogusTabel>("gremia");

  const items: Record<CatalogusTabel, CatalogusItem[]> = {
    gremia,
    expertises,
    kritische_focusgebieden: focusgebieden,
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1 border-b border-[#0F2744]/10">
        {TABS.map((t) => {
          const aantal = items[t.sleutel].length;
          const actief = t.sleutel === tab;
          return (
            <button
              key={t.sleutel}
              type="button"
              onClick={() => setTab(t.sleutel)}
              className={
                "rounded-t-lg px-4 py-2 text-sm font-medium transition-colors " +
                (actief
                  ? "bg-white text-[#0F2744] shadow-sm"
                  : "text-[#0F2744]/60 hover:text-[#0F2744]")
              }
            >
              {t.label}
              <span className="ml-2 text-xs text-[#0F2744]/40">{aantal}</span>
            </button>
          );
        })}
      </div>

      <CatalogusTab
        key={tab}
        tabel={tab}
        items={items[tab]}
        magBeheren={magBeheren}
      />
    </div>
  );
}

// ── Eén catalogus-tab ─────────────────────────────────────────────────────────
function CatalogusTab({
  tabel,
  items,
  magBeheren,
}: {
  tabel: CatalogusTabel;
  items: CatalogusItem[];
  magBeheren: boolean;
}) {
  const router = useRouter();
  const [bezig, start] = useTransition();
  const [melding, setMelding] = useState<Melding>(null);
  const [bewerkId, setBewerkId] = useState<string | null>(null);
  const isGremia = tabel === "gremia";

  function verwerk(
    actie: () => Promise<CatalogusResultaat>,
    naSucces?: () => void
  ) {
    setMelding(null);
    start(async () => {
      const r = await actie();
      if (r.ok) {
        setMelding({ soort: "ok", tekst: r.bericht });
        naSucces?.();
        router.refresh();
      } else {
        setMelding({ soort: "fout", tekst: r.melding });
      }
    });
  }

  return (
    <div className="space-y-5">
      {melding && (
        <div
          className={
            "rounded-lg px-4 py-2 text-sm " +
            (melding.soort === "ok"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-red-50 text-red-800")
          }
        >
          {melding.tekst}
        </div>
      )}

      {magBeheren && (
        <ToevoegFormulier
          tabel={tabel}
          isGremia={isGremia}
          bezig={bezig}
          onSubmit={(input, reset) =>
            verwerk(() => catalogusTemplateAanmaken({ tabel, ...input }), reset)
          }
        />
      )}

      <div className="overflow-hidden rounded-xl border border-[#0F2744]/10 bg-white">
        {items.length === 0 ? (
          <p className="px-5 py-6 text-sm text-[#0F2744]/60">
            Nog geen standaarditems in deze catalogus.
          </p>
        ) : (
          <ul className="divide-y divide-[#0F2744]/5">
            {items.map((item) => (
              <li key={item.id} className="px-5 py-3">
                {bewerkId === item.id ? (
                  <BewerkFormulier
                    item={item}
                    isGremia={isGremia}
                    bezig={bezig}
                    onAnnuleer={() => setBewerkId(null)}
                    onOpslaan={(input) =>
                      verwerk(
                        () =>
                          catalogusTemplateBijwerken({
                            tabel,
                            id: item.id,
                            ...input,
                          }),
                        () => setBewerkId(null)
                      )
                    }
                  />
                ) : (
                  <RegelWeergave
                    item={item}
                    isGremia={isGremia}
                    magBeheren={magBeheren}
                    bezig={bezig}
                    onBewerk={() => {
                      setMelding(null);
                      setBewerkId(item.id);
                    }}
                    onToggle={(reden) =>
                      verwerk(() =>
                        catalogusTemplateActief({
                          tabel,
                          id: item.id,
                          actief: !item.actief,
                          reden,
                        })
                      )
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Leesregel + acties ────────────────────────────────────────────────────────
function RegelWeergave({
  item,
  isGremia,
  magBeheren,
  bezig,
  onBewerk,
  onToggle,
}: {
  item: CatalogusItem;
  isGremia: boolean;
  magBeheren: boolean;
  bezig: boolean;
  onBewerk: () => void;
  onToggle: (reden: string) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={
              "font-medium " +
              (item.actief ? "text-[#0F2744]" : "text-[#0F2744]/40 line-through")
            }
          >
            {item.naam}
          </span>
          {isGremia && item.categorie && (
            <span className="rounded-full bg-[#C9A84C]/15 px-2 py-0.5 text-xs text-[#0F2744]">
              {CATEGORIE_LABEL[item.categorie] ?? item.categorie}
            </span>
          )}
          {isGremia && item.type && (
            <span className="rounded-full bg-[#F0F3F8] px-2 py-0.5 text-xs text-[#0F2744]/70">
              {TYPE_LABEL[item.type] ?? item.type}
            </span>
          )}
          {!item.actief && (
            <span className="rounded-full bg-[#0F2744]/5 px-2 py-0.5 text-xs text-[#0F2744]/50">
              inactief
            </span>
          )}
        </div>
        {item.omschrijving && (
          <p className="mt-0.5 text-sm text-[#0F2744]/60">{item.omschrijving}</p>
        )}
      </div>

      {magBeheren && (
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={bezig}
            onClick={onBewerk}
            className="rounded-lg px-3 py-1.5 text-sm text-[#0F2744] hover:bg-[#F0F3F8] disabled:opacity-50"
          >
            Bewerken
          </button>
          <TogglerKnop item={item} bezig={bezig} onToggle={onToggle} />
        </div>
      )}
    </div>
  );
}

// (De)activeren vraagt om een verplichte reden (change control).
function TogglerKnop({
  item,
  bezig,
  onToggle,
}: {
  item: CatalogusItem;
  bezig: boolean;
  onToggle: (reden: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reden, setReden] = useState("");
  const naarInactief = item.actief;

  if (!open) {
    return (
      <button
        type="button"
        disabled={bezig}
        onClick={() => setOpen(true)}
        className={
          "rounded-lg px-3 py-1.5 text-sm disabled:opacity-50 " +
          (naarInactief
            ? "text-red-700 hover:bg-red-50"
            : "text-emerald-700 hover:bg-emerald-50")
        }
      >
        {naarInactief ? "Deactiveren" : "Activeren"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        value={reden}
        onChange={(e) => setReden(e.target.value)}
        placeholder="Reden (verplicht)"
        className="w-44 rounded-lg border border-[#0F2744]/15 px-2 py-1.5 text-sm"
      />
      <button
        type="button"
        disabled={bezig || reden.trim().length === 0}
        onClick={() => {
          onToggle(reden.trim());
          setOpen(false);
          setReden("");
        }}
        className="rounded-lg bg-[#0F2744] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
      >
        Bevestig
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setReden("");
        }}
        className="rounded-lg px-2 py-1.5 text-sm text-[#0F2744]/60 hover:bg-[#F0F3F8]"
      >
        Annuleer
      </button>
    </div>
  );
}

// ── Toevoegen ─────────────────────────────────────────────────────────────────
function ToevoegFormulier({
  tabel,
  isGremia,
  bezig,
  onSubmit,
}: {
  tabel: CatalogusTabel;
  isGremia: boolean;
  bezig: boolean;
  onSubmit: (
    input: { naam: string; type?: string; categorie?: string; omschrijving?: string },
    reset: () => void
  ) => void;
}) {
  const [naam, setNaam] = useState("");
  const [type, setType] = useState<string>("adviserend");
  const [categorie, setCategorie] = useState<string>("bestuurscommissie");
  const [omschrijving, setOmschrijving] = useState("");

  function reset() {
    setNaam("");
    setType("adviserend");
    setCategorie("bestuurscommissie");
    setOmschrijving("");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!naam.trim()) return;
        onSubmit(
          {
            naam: naam.trim(),
            ...(isGremia ? { type, categorie } : {}),
            omschrijving: omschrijving.trim() || undefined,
          },
          reset
        );
      }}
      className="rounded-xl border border-[#0F2744]/10 bg-[#F0F3F8]/50 p-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[#0F2744]/60">Naam</span>
          <input
            value={naam}
            onChange={(e) => setNaam(e.target.value)}
            placeholder={
              isGremia ? "bv. Geschillencommissie" : "bv. Nieuw item"
            }
            className="w-64 rounded-lg border border-[#0F2744]/15 bg-white px-3 py-1.5 text-sm"
          />
        </label>

        {isGremia && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[#0F2744]/60">Categorie</span>
            <select
              value={categorie}
              onChange={(e) => setCategorie(e.target.value)}
              className="rounded-lg border border-[#0F2744]/15 bg-white px-3 py-1.5 text-sm"
            >
              {GREMIA_CATEGORIEEN.map((c) => (
                <option key={c} value={c}>
                  {CATEGORIE_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
        )}

        {isGremia && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[#0F2744]/60">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="rounded-lg border border-[#0F2744]/15 bg-white px-3 py-1.5 text-sm"
            >
              {GREMIA_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-[#0F2744]/60">
            Omschrijving (optioneel)
          </span>
          <input
            value={omschrijving}
            onChange={(e) => setOmschrijving(e.target.value)}
            className="w-full min-w-48 rounded-lg border border-[#0F2744]/15 bg-white px-3 py-1.5 text-sm"
          />
        </label>

        <button
          type="submit"
          disabled={bezig || !naam.trim()}
          className="rounded-lg bg-[#0F2744] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Toevoegen
        </button>
      </div>
    </form>
  );
}

// ── Bewerken (inline) ─────────────────────────────────────────────────────────
function BewerkFormulier({
  item,
  isGremia,
  bezig,
  onAnnuleer,
  onOpslaan,
}: {
  item: CatalogusItem;
  isGremia: boolean;
  bezig: boolean;
  onAnnuleer: () => void;
  onOpslaan: (input: {
    naam: string;
    type?: string;
    categorie?: string;
    omschrijving?: string;
    reden?: string;
  }) => void;
}) {
  const [naam, setNaam] = useState(item.naam);
  const [type, setType] = useState<string>(item.type ?? "adviserend");
  const [categorie, setCategorie] = useState<string>(item.categorie ?? "bestuurscommissie");
  const [omschrijving, setOmschrijving] = useState(item.omschrijving ?? "");
  const [reden, setReden] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!naam.trim() || reden.trim().length === 0) return;
        onOpslaan({
          naam: naam.trim(),
          ...(isGremia ? { type, categorie } : {}),
          omschrijving: omschrijving.trim(),
          reden: reden.trim(),
        });
      }}
      className="space-y-3 rounded-lg bg-[#F0F3F8]/50 p-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[#0F2744]/60">Naam</span>
          <input
            value={naam}
            onChange={(e) => setNaam(e.target.value)}
            className="w-64 rounded-lg border border-[#0F2744]/15 bg-white px-3 py-1.5 text-sm"
          />
        </label>

        {isGremia && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[#0F2744]/60">Categorie</span>
            <select
              value={categorie}
              onChange={(e) => setCategorie(e.target.value)}
              className="rounded-lg border border-[#0F2744]/15 bg-white px-3 py-1.5 text-sm"
            >
              {GREMIA_CATEGORIEEN.map((c) => (
                <option key={c} value={c}>
                  {CATEGORIE_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
        )}

        {isGremia && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[#0F2744]/60">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="rounded-lg border border-[#0F2744]/15 bg-white px-3 py-1.5 text-sm"
            >
              {GREMIA_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-[#0F2744]/60">
            Omschrijving
          </span>
          <input
            value={omschrijving}
            onChange={(e) => setOmschrijving(e.target.value)}
            className="w-full min-w-48 rounded-lg border border-[#0F2744]/15 bg-white px-3 py-1.5 text-sm"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-[#0F2744]/60">
            Reden van wijziging (verplicht)
          </span>
          <input
            value={reden}
            onChange={(e) => setReden(e.target.value)}
            placeholder="bv. Naam aangepast n.a.v. besluit bestuur 2026-06"
            className="w-full min-w-48 rounded-lg border border-[#0F2744]/15 bg-white px-3 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={bezig || !naam.trim() || reden.trim().length === 0}
          className="rounded-lg bg-[#0F2744] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Opslaan
        </button>
        <button
          type="button"
          onClick={onAnnuleer}
          className="rounded-lg px-3 py-1.5 text-sm text-[#0F2744]/60 hover:bg-white"
        >
          Annuleer
        </button>
      </div>
    </form>
  );
}
