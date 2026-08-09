// ============================================================================
// T6 — Afschrift-manifest (C3): MANIFEST.json — volledigheid + integriteit.
// ----------------------------------------------------------------------------
// Het manifest is NIET optioneel (guardrail "geen schijnzekerheid"). Het bewijst
//   • VOLLEDIGHEID — `bestandsaantal` == het aantal bestanden in de zip (incl.
//     dit MANIFEST.json zelf, dat wél meetelt maar niet in de `bestanden`-lijst
//     staat omdat het zichzelf niet kan hashen), plus de EXPLICIETE
//     uitsluitingslijst met reden per weggelaten stuk. Zonder die lijst lijkt
//     een onvolledige zip compleet.
//   • INTEGRITEIT  — sha256 + bytes per bestand, en de snapshot-hashes uit
//     decision_audit_snapshots waar van toepassing.
//
// Hashketen (eerlijk benoemen, R4): het BESLUIT-spoor (governance_events) draagt
// per gebeurtenis een ONGESLEUTELDE sha256 (DB-trigger) — in principe extern
// verifieerbaar uit de canonieke eventvorm. Het PROCES-spoor (procedure_log)
// heeft GEEN hashkolom. De integriteitsgarantie is dus niet voor beide sporen
// even sterk; dat staat ook in INHOUDSOPGAVE.md en §6 van de leeswijzer.
//
// Puur en zonder DB (input = geassembleerde structuren). sha256Hex draait op
// node:crypto (Node-runtime, aanwezig in de worker/route).
// ============================================================================

import { createHash } from "node:crypto";
import type { AfschriftContext } from "./afschrift-types";

export const MANIFEST_FORMAAT = "afschrift-manifest/1";

export type UitsluitReden =
  | "geen_bestand" // bewijs zonder document_id
  | "geen_toegang" // niet leesbaar onder de RLS-client van de maker
  | "te_groot" // boven de per-bestandslimiet
  | "ingetrokken" // documenten.actief = false (ADR-3: nooit meenemen)
  | "cap_overschreden"; // boven de bundelcaps (ontwerpbeslissing 7)

export interface ManifestBestand {
  pad: string;
  bytes: number;
  sha256: string;
}

export interface UitgeslotenItem {
  pad: string | null;
  type: string; // bv. 'bijlage', 'bewijs'
  titel: string;
  reden: UitsluitReden;
  detail?: string;
}

export interface ManifestWaarschuwing {
  pad: string;
  melding: string;
}

export interface SnapshotHash {
  besluit_code: string;
  trigger_status: string;
  hash: string;
}

export interface ManifestInput {
  context: AfschriftContext;
  bestanden: ManifestBestand[];
  snapshotHashes: SnapshotHash[];
  uitgeslotenItems: UitgeslotenItem[];
  waarschuwingen: ManifestWaarschuwing[];
  hoogsteVertrouwelijkheid: string;
  aantalBesluiten: number;
  bevatStemgedrag: boolean;
  /** sha256 over de per-bestand-hashes (Merkle-achtig). Niet-circulair
      embedbaar, i.t.t. de hash van de zip zélf. */
  inhoudHash: string;
}

export interface Manifest {
  formaat: string;
  generator: { versie: string; gegenereerd_op: string };
  afschrift: {
    id: string;
    procescode: string;
    versie: string;
    aanleiding: string | null;
    aantal_besluiten: number;
    hoogste_vertrouwelijkheid: string;
    bevat_stemgedrag: boolean;
  };
  export_context: {
    gebruiker: string | null;
    rol: string | null;
    gezichtshoek: string;
  };
  integriteit: {
    bestandsaantal: number;
    bestanden: ManifestBestand[];
    inhoud_hash: string;
    snapshot_hashes: SnapshotHash[];
    opmerking_hashketen: string;
  };
  uitgesloten_items: UitgeslotenItem[];
  waarschuwingen: ManifestWaarschuwing[];
}

/** sha256 als hex-string over bytes of een UTF-8-string. */
export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256")
    .update(typeof data === "string" ? Buffer.from(data, "utf8") : data)
    .digest("hex");
}

function datumKort(iso: string): string {
  // Deterministisch, zonder locale: YYYY-MM-DD uit de ISO-string.
  return iso.slice(0, 10);
}

const HASHKETEN_OPMERKING =
  "Het besluit-spoor (governance_events) draagt per gebeurtenis een ongesleutelde sha256-hash, " +
  "berekend over de canonieke eventvorm en daarmee in principe zelfstandig verifieerbaar. " +
  "Het proces-spoor (procedure_log) heeft geen hashkolom; voor die regels ontbreekt een per-event-integriteitswaarde. " +
  "De integriteitsgarantie is dus niet voor beide sporen even sterk.";

/**
 * Bouwt het manifest. `bestanden` is de definitieve inhoud van de zip (het pad
 * en de sha256 zijn door de bundelbouw al berekend). De gezichtshoek-zin legt
 * de vaste RLS-lens vast (ontwerpbeslissing 3): "dossier zoals <rol> het op
 * <datum> kon inzien".
 */
export function bouwManifest(input: ManifestInput): { manifest: Manifest; json: string } {
  const { context } = input;
  const rol = context.gebouwdOnderRol ?? "de aanvrager";
  const gezichtshoek =
    `Deze bundel bevat het dossier zoals ${rol} het op ${datumKort(context.aangemaaktOp)} kon inzien ` +
    `(gebouwd onder de RLS-rechten van de aanvrager).`;

  const manifest: Manifest = {
    formaat: MANIFEST_FORMAAT,
    generator: { versie: context.generatorVersie, gegenereerd_op: context.aangemaaktOp },
    afschrift: {
      id: context.afschriftId,
      procescode: context.procescode,
      versie: context.versie,
      aanleiding: context.aanleiding,
      aantal_besluiten: input.aantalBesluiten,
      hoogste_vertrouwelijkheid: input.hoogsteVertrouwelijkheid,
      bevat_stemgedrag: input.bevatStemgedrag,
    },
    export_context: {
      gebruiker: context.aangemaaktDoorNaam,
      rol: context.gebouwdOnderRol,
      gezichtshoek,
    },
    integriteit: {
      // Fysiek aantal bestanden in de zip = de gehashte bestanden + dit
      // MANIFEST.json zelf (dat zichzelf niet kan hashen en daarom niet in de
      // `bestanden`-lijst staat). Zo geldt: bestandsaantal == aantal bestanden
      // in de zip == procedure_afschriften.bestandsaantal (audit-review M1).
      bestandsaantal: input.bestanden.length + 1,
      bestanden: input.bestanden,
      inhoud_hash: input.inhoudHash,
      snapshot_hashes: input.snapshotHashes,
      opmerking_hashketen: HASHKETEN_OPMERKING,
    },
    uitgesloten_items: input.uitgeslotenItems,
    waarschuwingen: input.waarschuwingen,
  };

  return { manifest, json: JSON.stringify(manifest, null, 2) };
}
