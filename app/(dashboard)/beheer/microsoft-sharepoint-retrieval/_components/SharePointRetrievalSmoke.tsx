"use client";

import { useState } from "react";
import type {
  SharePointRetrievalSmokeEvent,
  SharePointRetrievalSmokeRoute,
  SharePointRetrievalSmokeScenario,
  SharePointRetrievalVeiligeMeting,
} from "@/core/lib/microsoft-sharepoint-retrieval-smoke-core";

type Taak = { scenario: SharePointRetrievalSmokeScenario; route: SharePointRetrievalSmokeRoute; ronde: 1 | 2 | 3 };
const ROUTES: SharePointRetrievalSmokeRoute[] = ["drive_search_extract", "microsoft_search"];
const ROUTE_LABEL: Record<SharePointRetrievalSmokeRoute, string> = {
  drive_search_extract: "DriveItem search + extractie",
  microsoft_search: "Microsoft Search",
};

async function voerUit(taak: Taak, onEvent: (event: SharePointRetrievalSmokeEvent) => void): Promise<void> {
  const response = await fetch("/api/microsoft/sharepoint/retrieval-smoke", {
    method: "POST",
    headers: { "content-type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(taak),
  });
  if (!response.ok || !response.body) throw new Error("De Preview-smoke kon niet worden gestart.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const delen = buffer.split("\n\n");
    buffer = delen.pop() ?? "";
    for (const deel of delen) {
      const data = deel.split("\n").find((regel) => regel.startsWith("data: "))?.slice(6);
      if (!data) continue;
      onEvent(JSON.parse(data) as SharePointRetrievalSmokeEvent);
    }
  }
}

export default function SharePointRetrievalSmoke() {
  const [bezig, setBezig] = useState(false);
  const [status, setStatus] = useState("Gereed om te testen.");
  const [metingen, setMetingen] = useState<SharePointRetrievalVeiligeMeting[]>([]);
  const [fout, setFout] = useState<string | null>(null);

  const run = async (taken: Taak[]) => {
    setBezig(true);
    setFout(null);
    try {
      for (const taak of taken) {
        await voerUit(taak, (event) => {
          if (event.type === "gestart") setStatus(`${event.scenario} · ${ROUTE_LABEL[event.route]} · ronde ${event.ronde}`);
          if (event.type === "wacht_op_intrekking") setStatus(`Trek nu toegang tot ‘04 Beperkt bestuur’ in. De laatste controle volgt over ${event.wachtSeconden} seconden.`);
          if (event.type === "wachtend") setStatus(`Wachten op rechtenpropagatie: nog ${event.resterendSeconden} seconden.`);
          if (event.type === "voltooid") {
            setMetingen((huidig) => [...huidig, event.meting]);
            setStatus(`${event.meting.vraagcode} afgerond: ${event.meting.resultaat}.`);
          }
          if (event.type === "mislukt") throw new Error(`Meting gestopt (${event.foutcategorie}).`);
        });
      }
    } catch (e) {
      setFout(e instanceof Error ? e.message : "De meting is niet gelukt.");
    } finally {
      setBezig(false);
    }
  };

  const basisTaken: Taak[] = ([1, 2, 3] as const).flatMap((ronde) =>
    (["S02", "S03", "S04"] as const).flatMap((scenario) => ROUTES.map((route) => ({ scenario, route, ronde }))),
  );

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="font-bold text-ink">Permission-probe</h2>
        <p className="mt-1 text-sm text-muted">Test één vaste, inhoudsloze DriveItem-zoekactie. Er worden geen documenten geopend of gedownload.</p>
        <button type="button" disabled={bezig} onClick={() => void run([{ scenario: "S00", route: "drive_search_extract", ronde: 1 }])} className="mt-4 rounded-lg border border-app-line-strong px-4 py-2 text-sm font-semibold disabled:opacity-50">
          Permission-probe uitvoeren
        </button>
      </section>

      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="font-bold text-ink">Basisvergelijking</h2>
        <p className="mt-1 text-sm text-muted">Voert S02–S04 via beide routes uit, drie rondes per route. Alleen aantallen, tijden, categorieën en korte versiehashes verschijnen hieronder.</p>
        <button type="button" disabled={bezig} onClick={() => void run(basisTaken)} className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          Basisvergelijking starten (18 metingen)
        </button>
      </section>

      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="font-bold text-ink">Intrekking en replay</h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>Start S08. Trek bij de wachtmelding in SharePoint de toegang tot <em>04 Beperkt bestuur</em> in.</li>
          <li>Laat de toegang ingetrokken en voer S09 uit; de oude inhoud mag niet terugkomen.</li>
          <li>Herstel de toegang en voer de positieve herstelcontrole uit.</li>
        </ol>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={bezig} onClick={() => void run([{ scenario: "S08", route: "drive_search_extract", ronde: 1 }])} className="rounded-lg border border-app-line-strong px-3 py-2 text-sm font-semibold disabled:opacity-50">S08 starten</button>
          <button type="button" disabled={bezig} onClick={() => void run([{ scenario: "S09", route: "drive_search_extract", ronde: 1 }])} className="rounded-lg border border-app-line-strong px-3 py-2 text-sm font-semibold disabled:opacity-50">S09 replay</button>
          <button type="button" disabled={bezig} onClick={() => void run([{ scenario: "S08R", route: "drive_search_extract", ronde: 1 }])} className="rounded-lg border border-app-line-strong px-3 py-2 text-sm font-semibold disabled:opacity-50">Herstel controleren</button>
        </div>
      </section>

      <div aria-live="polite" className="rounded-lg border border-line bg-app-bg px-3 py-2 text-sm text-ink">{status}</div>
      {fout && <div role="alert" className="rounded-lg border border-err/30 bg-err-tint px-3 py-2 text-sm text-err-ink">{fout}</div>}

      {metingen.length > 0 && (
        <section className="rounded-xl border border-line bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-bold text-ink">Veilige meetuitvoer</h2>
            <button type="button" onClick={() => void navigator.clipboard.writeText(JSON.stringify(metingen, null, 2))} className="rounded-lg border border-app-line-strong px-3 py-1.5 text-xs font-semibold">JSON kopiëren</button>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-line text-muted"><th className="py-2">Scenario</th><th>Route</th><th>Ronde</th><th>Resultaat</th><th>Fixtures</th><th>Latency</th><th>Calls</th><th>Bytes</th></tr></thead>
              <tbody>{metingen.map((m, index) => <tr key={`${m.vraagcode}-${m.route}-${m.ronde}-${index}`} className="border-b border-line"><td className="py-2">{m.vraagcode}</td><td>{ROUTE_LABEL[m.route]}</td><td>{m.ronde}</td><td>{m.resultaat}{m.foutcategorie ? ` · ${m.foutcategorie}` : ""}{m.foutcode ? ` · ${m.foutcode}` : ""}</td><td>{m.gevondenFixtures.join(", ") || "—"}</td><td>{m.latencyMs} ms</td><td>{m.microsoftCalls}</td><td>{m.responseBytes + m.contentBytes}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
