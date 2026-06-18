"use client";

import { useCallback, useEffect, useState } from "react";

type Organ = {
  id: string;
  fonds_id: string | null;
  naam: string;
  omschrijving: string | null;
  actief: boolean;
  sort_order: number;
  type?: string | null;
  is_template?: boolean;
};

type Procesmodel = {
  id: string;
  naam: string;
  generiek_procestype: string;
  domein: string | null;
  frequentie: string | null;
  actief: boolean;
};

const FREQUENTIE_LABEL: Record<string, string> = {
  jaarlijks: "Jaarlijks",
  kwartaal: "Per kwartaal",
  maandelijks: "Maandelijks",
  ad_hoc: "Ad hoc",
  projectmatig: "Projectmatig",
  doorlopend: "Doorlopend",
};

async function jsonFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Er ging iets mis");
  return data;
}

export default function BeheerClient() {
  const [tab, setTab] = useState<"catalogus" | "organen">("catalogus");
  const [procesmodellen, setProcesmodellen] = useState<Procesmodel[]>([]);
  const [gremia, setGremia] = useState<Organ[]>([]);
  const [expertises, setExpertises] = useState<Organ[]>([]);
  const [focus, setFocus] = useState<Organ[]>([]);
  const [laden, setLaden] = useState(true);
  const [fout, setFout] = useState<string | null>(null);

  const [importeren, setImporteren] = useState(false);
  const [importMelding, setImportMelding] = useState<string | null>(null);

  const laadAlles = useCallback(async () => {
    setLaden(true);
    setFout(null);
    try {
      const [pm, g, e, f] = await Promise.all([
        jsonFetch("/api/procesmodellen"),
        jsonFetch("/api/gremia"),
        jsonFetch("/api/expertises"),
        jsonFetch("/api/focusgebieden"),
      ]);
      setProcesmodellen(pm.procesmodellen ?? []);
      setGremia(g.items ?? []);
      setExpertises(e.items ?? []);
      setFocus(f.items ?? []);
    } catch (err) {
      setFout(err instanceof Error ? err.message : "Laden mislukt");
    } finally {
      setLaden(false);
    }
  }, []);

  useEffect(() => {
    laadAlles();
  }, [laadAlles]);

  async function importeerStandaard() {
    if (
      !confirm(
        "De standaardcatalogus (gremia, expertises, focusgebieden en procesmodellen) wordt naar dit fonds gekopieerd. Reeds geïmporteerde items worden overgeslagen. Doorgaan?"
      )
    )
      return;
    setImporteren(true);
    setImportMelding(null);
    try {
      const { resultaat } = await jsonFetch("/api/catalogus/import", {
        method: "POST",
      });
      const r = resultaat;
      setImportMelding(
        `Import voltooid — procesmodellen: ${r.procesmodellen.aangemaakt} aangemaakt / ${r.procesmodellen.overgeslagen} overgeslagen; ` +
          `gremia: ${r.gremia.aangemaakt}/${r.gremia.overgeslagen}; expertises: ${r.expertises.aangemaakt}/${r.expertises.overgeslagen}; ` +
          `focusgebieden: ${r.focusgebieden.aangemaakt}/${r.focusgebieden.overgeslagen}; koppelingen: ${r.koppelingen.aangemaakt} aangemaakt.`
      );
      await laadAlles();
    } catch (err) {
      setImportMelding(err instanceof Error ? err.message : "Import mislukt");
    } finally {
      setImporteren(false);
    }
  }

  return (
    <div>
      {/* Import */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 mb-6 flex items-center justify-between gap-4">
        <div>
          <div className="font-semibold text-[#0F2744]">Standaardcatalogus importeren</div>
          <div className="text-sm text-gray-500">
            Kopieert de globale templates naar dit fonds als bewerkbaar startpunt.
            Idempotent — bestaande items blijven ongemoeid.
          </div>
        </div>
        <button
          onClick={importeerStandaard}
          disabled={importeren}
          className="shrink-0 rounded-lg bg-[#0F2744] px-4 py-2 text-sm font-semibold text-white hover:bg-[#163556] disabled:opacity-50"
        >
          {importeren ? "Bezig…" : "Importeren"}
        </button>
      </div>
      {importMelding && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 mb-6">
          {importMelding}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {(["catalogus", "organen"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t
                ? "border-[#C9A84C] text-[#0F2744]"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "catalogus" ? "Procescatalogus" : "Organen"}
          </button>
        ))}
      </div>

      {fout && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 mb-4">
          {fout}
        </div>
      )}
      {laden ? (
        <div className="text-gray-400 text-sm">Laden…</div>
      ) : tab === "catalogus" ? (
        <CatalogusTab
          procesmodellen={procesmodellen}
          gremia={gremia.filter((o) => o.fonds_id && o.actief)}
          expertises={expertises.filter((o) => o.fonds_id && o.actief)}
          focus={focus.filter((o) => o.fonds_id && o.actief)}
          onWijzig={laadAlles}
        />
      ) : (
        <OrganenTab
          gremia={gremia}
          expertises={expertises}
          focus={focus}
          onWijzig={laadAlles}
        />
      )}
    </div>
  );
}

// ── Procescatalogus ────────────────────────────────────────────────────────
function CatalogusTab({
  procesmodellen,
  gremia,
  expertises,
  focus,
  onWijzig,
}: {
  procesmodellen: Procesmodel[];
  gremia: Organ[];
  expertises: Organ[];
  focus: Organ[];
  onWijzig: () => Promise<void>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [nieuwNaam, setNieuwNaam] = useState("");
  const [nieuwType, setNieuwType] = useState("");

  async function maakAan() {
    if (!nieuwNaam.trim() || !nieuwType.trim()) return;
    await jsonFetch("/api/procesmodellen", {
      method: "POST",
      body: JSON.stringify({ naam: nieuwNaam.trim(), generiek_procestype: nieuwType.trim() }),
    });
    setNieuwNaam("");
    setNieuwType("");
    await onWijzig();
  }

  async function toggleActief(pm: Procesmodel) {
    await jsonFetch(`/api/procesmodellen/${pm.id}`, {
      method: "PATCH",
      body: JSON.stringify({ actief: !pm.actief }),
    });
    await onWijzig();
  }

  return (
    <div>
      <div className="rounded-xl border border-gray-200 bg-white p-4 mb-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">Naam</label>
          <input
            value={nieuwNaam}
            onChange={(e) => setNieuwNaam(e.target.value)}
            placeholder="bv. Uitbestedingsreview vermogensbeheer"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Generiek procestype
          </label>
          <input
            value={nieuwType}
            onChange={(e) => setNieuwType(e.target.value)}
            placeholder="bv. uitbestedingsreview"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={maakAan}
          className="rounded-lg bg-[#0F2744] px-4 py-2 text-sm font-semibold text-white hover:bg-[#163556]"
        >
          Toevoegen
        </button>
      </div>

      {procesmodellen.length === 0 ? (
        <div className="text-gray-400 text-sm">
          Nog geen procesmodellen. Importeer de standaardcatalogus of voeg er een toe.
        </div>
      ) : (
        <div className="space-y-2">
          {procesmodellen.map((pm) => (
            <div key={pm.id} className="rounded-xl border border-gray-200 bg-white">
              <div className="flex items-center gap-3 p-4">
                <div className="flex-1">
                  <div className="font-semibold text-[#0F2744]">
                    {pm.naam}{" "}
                    {!pm.actief && (
                      <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                        inactief
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {pm.generiek_procestype}
                    {pm.frequentie ? ` · ${FREQUENTIE_LABEL[pm.frequentie] ?? pm.frequentie}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => setOpen(open === pm.id ? null : pm.id)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Koppelingen
                </button>
                <button
                  onClick={() => toggleActief(pm)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  {pm.actief ? "Deactiveren" : "Activeren"}
                </button>
              </div>
              {open === pm.id && (
                <KoppelPanel
                  procesmodelId={pm.id}
                  gremia={gremia}
                  expertises={expertises}
                  focus={focus}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KoppelPanel({
  procesmodelId,
  gremia,
  expertises,
  focus,
}: {
  procesmodelId: string;
  gremia: Organ[];
  expertises: Organ[];
  focus: Organ[];
}) {
  const [koppelingen, setKoppelingen] = useState<{
    gremia: string[];
    expertises: string[];
    focusgebieden: string[];
  }>({ gremia: [], expertises: [], focusgebieden: [] });
  const [laden, setLaden] = useState(true);

  const laad = useCallback(async () => {
    setLaden(true);
    const data = await jsonFetch(`/api/procesmodellen/${procesmodelId}`);
    setKoppelingen({
      gremia: data.koppelingen.gremia.map((k: { gremium_id: string }) => k.gremium_id),
      expertises: data.koppelingen.expertises.map((k: { expertise_id: string }) => k.expertise_id),
      focusgebieden: data.koppelingen.focusgebieden.map(
        (k: { focusgebied_id: string }) => k.focusgebied_id
      ),
    });
    setLaden(false);
  }, [procesmodelId]);

  useEffect(() => {
    laad();
  }, [laad]);

  async function toggle(
    type: "gremium" | "expertise" | "focusgebied",
    doelId: string,
    gekoppeld: boolean
  ) {
    await jsonFetch(`/api/procesmodellen/${procesmodelId}/koppelingen`, {
      method: gekoppeld ? "DELETE" : "POST",
      body: JSON.stringify({ type, doel_id: doelId }),
    });
    await laad();
  }

  if (laden) return <div className="border-t border-gray-100 p-4 text-sm text-gray-400">Laden…</div>;

  const blok = (
    titel: string,
    items: Organ[],
    gekoppeldeIds: string[],
    type: "gremium" | "expertise" | "focusgebied"
  ) => (
    <div>
      <div className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">{titel}</div>
      {items.length === 0 ? (
        <div className="text-xs text-gray-400">Geen actieve items — importeer of voeg ze toe bij Organen.</div>
      ) : (
        <div className="space-y-1">
          {items.map((o) => {
            const gekoppeld = gekoppeldeIds.includes(o.id);
            return (
              <label key={o.id} className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={gekoppeld}
                  onChange={() => toggle(type, o.id, gekoppeld)}
                />
                {o.naam}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-5 border-t border-gray-100 p-4 md:grid-cols-3">
      {blok("Gremia", gremia, koppelingen.gremia, "gremium")}
      {blok("Expertises", expertises, koppelingen.expertises, "expertise")}
      {blok("Focusgebieden", focus, koppelingen.focusgebieden, "focusgebied")}
    </div>
  );
}

// ── Organen ──────────────────────────────────────────────────────────────
function OrganenTab({
  gremia,
  expertises,
  focus,
  onWijzig,
}: {
  gremia: Organ[];
  expertises: Organ[];
  focus: Organ[];
  onWijzig: () => Promise<void>;
}) {
  return (
    <div className="space-y-8">
      <OrgaanSectie titel="Gremia" endpoint="gremia" items={gremia} metType onWijzig={onWijzig} />
      <OrgaanSectie titel="Expertises" endpoint="expertises" items={expertises} onWijzig={onWijzig} />
      <OrgaanSectie
        titel="Kritische focusgebieden"
        endpoint="focusgebieden"
        items={focus}
        onWijzig={onWijzig}
      />
    </div>
  );
}

const GREMIA_TYPES = ["besluitvormend", "adviserend", "toezichthoudend", "uitvoerend"];

function OrgaanSectie({
  titel,
  endpoint,
  items,
  metType,
  onWijzig,
}: {
  titel: string;
  endpoint: string;
  items: Organ[];
  metType?: boolean;
  onWijzig: () => Promise<void>;
}) {
  const [naam, setNaam] = useState("");
  const [type, setType] = useState(metType ? "adviserend" : "");

  async function maakAan() {
    if (!naam.trim()) return;
    await jsonFetch(`/api/${endpoint}`, {
      method: "POST",
      body: JSON.stringify({ naam: naam.trim(), ...(metType ? { type } : {}) }),
    });
    setNaam("");
    await onWijzig();
  }

  async function toggleActief(o: Organ) {
    await jsonFetch(`/api/${endpoint}/${o.id}`, {
      method: "PATCH",
      body: JSON.stringify({ actief: !o.actief }),
    });
    await onWijzig();
  }

  const fondsItems = items.filter((o) => o.fonds_id);
  const templates = items.filter((o) => !o.fonds_id);

  return (
    <div>
      <h2 className="text-lg font-semibold text-[#0F2744] mb-3">{titel}</h2>
      <div className="rounded-xl border border-gray-200 bg-white p-4 mb-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">Naam</label>
          <input
            value={naam}
            onChange={(e) => setNaam(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        {metType && (
          <div className="min-w-[160px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm capitalize"
            >
              {GREMIA_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        )}
        <button
          onClick={maakAan}
          className="rounded-lg bg-[#0F2744] px-4 py-2 text-sm font-semibold text-white hover:bg-[#163556]"
        >
          Toevoegen
        </button>
      </div>

      {fondsItems.length === 0 ? (
        <div className="text-gray-400 text-sm mb-2">
          Nog geen fonds-specifieke items. Importeer de standaardset of voeg er een toe.
        </div>
      ) : (
        <div className="space-y-1.5 mb-2">
          {fondsItems.map((o) => (
            <div
              key={o.id}
              className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5"
            >
              <div className="flex-1">
                <span className="text-sm text-[#0F2744]">{o.naam}</span>
                {metType && o.type && (
                  <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs capitalize text-gray-500">
                    {o.type}
                  </span>
                )}
                {!o.actief && (
                  <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                    inactief
                  </span>
                )}
              </div>
              <button
                onClick={() => toggleActief(o)}
                className="rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
              >
                {o.actief ? "Deactiveren" : "Activeren"}
              </button>
            </div>
          ))}
        </div>
      )}

      {templates.length > 0 && (
        <details className="text-sm text-gray-500">
          <summary className="cursor-pointer">Globale templates ({templates.length})</summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {templates.map((t) => (
              <span key={t.id} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                {t.naam}
              </span>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
