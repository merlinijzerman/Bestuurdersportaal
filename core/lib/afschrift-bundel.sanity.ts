// ============================================================
//  Sanity-tests voor de afschrift-bundel (T6, C1) — end-to-end zip.
//
//  Borgt de kern-acceptatie: manifest-bestandsaantal == aantal bestanden in de
//  zip (AC 2/5), elke sha256 in het manifest klopt met de bytes (AC 2), bewijs
//  zonder bestand → uitgesloten_items 'geen_bestand' (AC 4), vervangen_door →
//  waarschuwing (AC 6), een te grote bijlage → geleverd mét vermelding, geen
//  fout (AC 8). En dat de vaste bundelstructuur aanwezig is.
//
//  Geen testframework; standalone. Uitvoeren: npx tsx core/lib/afschrift-bundel.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import JSZip from "jszip";
import type {
  DecisionDossierView, DecisionObject, ProcedureSummary, ReadinessOverview,
  ReadinessResult, ReadinessTarget, GovernanceEvent, StemverslagSummary,
} from "./decision-view";
import type { AfschriftBron, ProcedureLogEntry } from "./afschrift-types";
import { bouwBundel, MAX_BIJLAGE_BYTES, type BijlageInvoer } from "./afschrift-bundel";
import { sha256Hex } from "./afschrift-manifest";

let n = 0;
async function testAsync(naam: string, fn: () => Promise<void>) {
  await fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

function leegReadiness(): ReadinessOverview {
  const r = (t: ReadinessTarget): ReadinessResult => ({
    decision_id: "dec-1", target: t, voldoet: true, blokkerend: false, kan_overrulen: [], ontbrekend: [],
  });
  return {
    onderbouwing_compleet: r("onderbouwing_compleet"), reviewrijp: r("reviewrijp"),
    bespreekrijp: r("bespreekrijp"), besluitrijp: r("besluitrijp"),
    verantwoordingsrijp: r("verantwoordingsrijp"), evaluatierijp: r("evaluatierijp"),
  };
}
function decision(): DecisionObject {
  return {
    id: "dec-1", procedure_id: "proc-1", fonds_id: "fonds-1", besluit_code: "B-2026-001",
    titel: "Verhoging hedge-ratio", besluitvraag: "Verhogen naar 70%?", aanleiding: null, scope: "Rentehedge",
    governance_orgaan: null, vertrouwelijkheid: "vertrouwelijk", complexiteit: "complicated",
    risiconiveau: "middel", mandaatgevoelig: false, toezichtgevoelig: false, beleidsafwijking: false,
    ai_risicoklasse: "laag", status: "besloten", is_primary_decision: true, eigenaar_id: null,
    eigenaar_naam: null, template_versie: null, gewenste_besluitdatum: null,
    aangemaakt_op: "2026-03-03T09:00:00.000Z", laatst_gewijzigd: "2026-04-19T09:00:00.000Z",
  };
}
function procedure(): ProcedureSummary {
  return {
    id: "proc-1", fonds_id: "fonds-1", template_code: "beleggingsbeleid", titel: "Wijziging beleggingsbeleid 2026",
    beschrijving: null, status: "besloten", gestart_op: "2026-03-03T09:00:00.000Z", gestart_door: null,
    deadline: null, afgerond_op: "2026-04-19T09:00:00.000Z", decision_id: "dec-1",
  };
}
function gev(over: Partial<GovernanceEvent>): GovernanceEvent {
  return {
    id: "e1", decision_id: "dec-1", event_type: "assumption_toegevoegd", actor_id: null, actor_naam: "Anna",
    object_type: "assumption", object_id: "a1", oude_waarde: null, nieuwe_waarde: { tekst: "x" }, reden: null,
    hash: "deadbeef", tijdstip: "2026-03-10T09:00:00.000Z", ...over,
  };
}
function stemverslag(): StemverslagSummary {
  return {
    id: "s1", vraag: "Akkoord?", status: "gesloten", alternatieven: [{ code: "voor", label: "Voor" }],
    uitslag: { voor: 5 }, ingetrokken_reden: null, geopend_op: "2026-04-19T09:00:00.000Z", gesloten_op: "2026-04-19T10:00:00.000Z",
  };
}
function view(): DecisionDossierView {
  return {
    decision: decision(), procedure: procedure(), currentStep: null, steps: [], readiness: leegReadiness(),
    evidence: [], stemverslagen: [stemverslag()], bewijs: [], besluiten: [],
    assumptions: [], risks: [], scenarios: [], aiOutputs: [], dissent: [], conditions: [], actions: [],
    evaluations: [], events: [gev({})], snapshots: [], auto_upgraded: false,
  };
}
function logEntry(): ProcedureLogEntry {
  return { id: "l1", procedure_id: "proc-1", event_type: "stap_voltooid", actor_naam: "Merlin",
    payload: { stap: "Onderbouwing" }, tijdstip: "2026-03-20T09:00:00.000Z" };
}
function bron(): AfschriftBron {
  return {
    context: {
      afschriftId: "afs-1", procescode: "B-2026-001", versie: "besluitmoment", aanleiding: "jaarrekeningcontrole 2026",
      aangemaaktOp: "2026-08-09T12:00:00.000Z", aangemaaktDoorNaam: "M. IJzerman", gebouwdOnderRol: "voorzitter",
      generatorVersie: "t6-1.0",
    },
    decisions: [view()],
    procedureLog: [logEntry()],
  };
}

function invoer(bijlagen: BijlageInvoer[]) {
  return {
    bron: bron(),
    auditdossiers: [{ besluitCode: "B-2026-001", html: "<!DOCTYPE html><html><body>Auditdossier</body></html>" }],
    snapshotHashes: [{ besluit_code: "B-2026-001", trigger_status: "besloten", hash: "f".repeat(64) }],
    bijlagen,
    besluitvragen: [{ besluitCode: "B-2026-001", titel: "Verhoging hedge-ratio", besluitvraag: "Verhogen naar 70%?", scope: "Rentehedge" }],
  };
}

function pdfBytes(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.4 mock inhoud");
}

console.log("afschrift-bundel sanity-tests:");

async function main() {
  await testAsync("manifest-bestandsaantal == aantal bestanden in de zip; sha256 klopt (AC 2/5)", async () => {
    const res = await bouwBundel(invoer([
      { bewijsId: "b1", titel: "ALM-analyse", documenttype: "alm", extensie: "pdf", bytes: pdfBytes() },
    ]));
    const zip = await JSZip.loadAsync(res.zipBytes);
    const bestanden = Object.keys(zip.files).filter((f) => !zip.files[f].dir);
    const manifest = JSON.parse(await zip.file("MANIFEST.json")!.async("string"));
    // bestandsaantal telt alle fysieke bestanden (incl. MANIFEST.json); de
    // `bestanden`-lijst bevat alles behalve het manifest zelf (M1).
    assert.equal(manifest.integriteit.bestandsaantal, bestanden.length);
    assert.equal(manifest.integriteit.bestanden.length, bestanden.length - 1);
    // sha256 per bestand klopt met de bytes in de zip
    for (const b of manifest.integriteit.bestanden) {
      const bytes = await zip.file(b.pad)!.async("uint8array");
      assert.equal(sha256Hex(bytes), b.sha256, `hash mismatch voor ${b.pad}`);
    }
  });

  await testAsync("vaste bundelstructuur aanwezig", async () => {
    const res = await bouwBundel(invoer([{ bewijsId: "b1", titel: "ALM", documenttype: null, extensie: "pdf", bytes: pdfBytes() }]));
    const zip = await JSZip.loadAsync(res.zipBytes);
    for (const p of ["00_LEESWIJZER.docx", "00_LEESWIJZER.html", "01_Auditdossier.html",
      "02_Tijdlijn.html", "02_Tijdlijn.csv", "03_Auditlog.csv", "03_Auditlog.json", "MANIFEST.json", "INHOUDSOPGAVE.md"]) {
      assert.ok(zip.file(p), `zip mist ${p}`);
    }
    assert.ok(Object.keys(zip.files).some((f) => f.startsWith("04_Bijlagen/B01_")), "bijlage ontbreekt");
    assert.equal(res.bevatStemgedrag, true, "stemverslag aanwezig ⇒ bevatStemgedrag true");
  });

  await testAsync("bewijs zonder bestand → uitgesloten_items 'geen_bestand' (AC 4)", async () => {
    const res = await bouwBundel(invoer([
      { bewijsId: "b1", titel: "Met bestand", documenttype: null, extensie: "pdf", bytes: pdfBytes() },
      { bewijsId: "b2", titel: "Mondelinge toelichting", documenttype: null, extensie: "pdf", bytes: null,
        uitsluiting: { reden: "geen_bestand" } },
    ]));
    assert.ok(res.uitgeslotenItems.some((u) => u.reden === "geen_bestand" && u.titel === "Mondelinge toelichting"));
    const zip = await JSZip.loadAsync(res.zipBytes);
    const manifest = JSON.parse(await zip.file("MANIFEST.json")!.async("string"));
    assert.ok(manifest.uitgesloten_items.some((u: { reden: string }) => u.reden === "geen_bestand"));
  });

  await testAsync("vervangen_door_document_id → waarschuwing (AC 6)", async () => {
    const res = await bouwBundel(invoer([
      { bewijsId: "b1", titel: "Notulen", documenttype: null, extensie: "pdf", bytes: pdfBytes(),
        vervangenDoorDocumentId: "doc-99" },
    ]));
    assert.equal(res.waarschuwingen.length, 1);
    assert.ok(res.waarschuwingen[0].melding.includes("andere versie"));
  });

  await testAsync("te grote bijlage → geleverd mét vermelding, geen fout (AC 8)", async () => {
    const groot = new Uint8Array(MAX_BIJLAGE_BYTES + 1);
    const res = await bouwBundel(invoer([
      { bewijsId: "b1", titel: "Groot rapport", documenttype: null, extensie: "pdf", bytes: groot },
    ]));
    assert.ok(res.uitgeslotenItems.some((u) => u.reden === "te_groot"));
    const zip = await JSZip.loadAsync(res.zipBytes);
    assert.ok(zip.file("MANIFEST.json"), "bundel is alsnog geleverd");
    assert.ok(!Object.keys(zip.files).some((f) => f.startsWith("04_Bijlagen/")), "geen bijlage opgenomen");
  });

  await testAsync("determinisme: identieke invoer → identieke sha256 (dedup, code-review H1)", async () => {
    const mk = () => invoer([{ bewijsId: "b1", titel: "ALM", documenttype: "alm", extensie: "pdf", bytes: pdfBytes() }]);
    const a = await bouwBundel(mk());
    const b = await bouwBundel(mk());
    assert.equal(a.sha256, b.sha256, "de zip-bytes moeten reproduceerbaar zijn (gepinde datums)");
    assert.equal(a.inhoudHash, b.inhoudHash);
  });

  await testAsync("tijdlijn in de zip bevat beide sporen (AC 3a)", async () => {
    const res = await bouwBundel(invoer([]));
    const zip = await JSZip.loadAsync(res.zipBytes);
    const csv = await zip.file("02_Tijdlijn.csv")!.async("string");
    assert.ok(csv.includes('"proces"') && csv.includes('"besluit"'));
    assert.ok(csv.includes("stap_voltooid") && csv.includes("assumption_toegevoegd"));
  });

  console.log(`\nafschrift-bundel: ${n} tests groen.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
