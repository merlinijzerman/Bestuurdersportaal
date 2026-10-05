"use server";

// ============================================================================
//  Server-actions — generieke documentcuratie (Increment P1/B14, FO §8).
// ----------------------------------------------------------------------------
//  Vier handelingen, ALLE achter withPlatform (capability
//  platform.generic.library.manage + twee-fasen-audit):
//    • curatieAanmaken  — upload + §8.1-metadata + uploadsecurity-pipeline.
//    • curatieBijwerken — metadata wijzigen ZONDER re-upload (auto-doorwerking
//                         naar de chunks via de bestaande denorm-trigger, #4).
//                         Sinds #499 atomisch via de RPC
//                         fn_platform_generiek_document_bijwerken (wijziging +
//                         chunk-denorm + metadata-log in één transactie, eigen
//                         statement_timeout); idem deprecate/withdraw/herpubliceren.
//    • curatieIntrekken — laten vervallen (status alleen_historisch + bronstatus
//                         historisch + geldig_tot), append-only geaudit.
//    • curatieVervangen — nieuwe versie koppelen; oude → historisch (self-FK's).
//
//  Elke handeling schrijft NAAST het platform_event_log (door withPlatform) ook
//  het bestaande document_metadata_log-spoor (DB-trigger berekent de hash).
//  Businessvalidatie (bestand/metadata/duplicaat) wordt als ok:false TERUGGEGEVEN
//  (niet geworpen): de handeling is dan een geaudite, bewuste weigering — het
//  result-effect legt de reden vast. Alleen poort-/auditfouten (PlatformError)
//  onderbreken de flow.
// ============================================================================

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withPlatform, PlatformError } from "@/platform/lib/platform-wrapper";
import type { PlatformIdentiteit } from "@/platform/lib/platform-auth";
import { valideerUpload } from "@/core/lib/bestand-validatie";
import { bepaalBestandstype } from "@/core/lib/document-extractie";
import {
  valideerGeneriekeCuratie,
  type JuridischeCuratieGenormaliseerd,
} from "@/core/lib/generiek-curatie-juridisch";
import {
  bouwCuratieDiff,
  leesCuratieInvoer,
  type CuratieLogRij,
} from "@/platform/lib/generiek-curatie-diff";
import {
  generiekGeldigheidsstatus,
  generiekTransitieRedenplicht,
} from "@/core/lib/generiek-status";
import {
  STORAGE_BUCKET,
  QUARANTAINE_BUCKET,
  GENERIEK_PAD_PREFIX,
  QUARANTAINE_PAD_PATROON,
} from "@/platform/lib/generiek-pipeline";
import {
  auditFoutcode,
  classificeerMutatieFout,
  mutatieFoutMelding,
} from "@/platform/lib/generiek-mutatie-fout";
import { herindexeerDocument } from "@/core/lib/reindex";
import { PREFIX_PROMPT_VERSIE } from "@/core/lib/chunk-ingest";
import { BRONBLOKKEN_INDEXERING_VERSIE } from "@/core/lib/chunk-bouw";
import { ruimChunksOp } from "@/core/lib/chunk-vervangen";
import {
  bepaalHerindexStand,
  herindexFoutcode,
  type HerindexDocRij,
  type HerindexJobRij,
} from "@/core/lib/herindex-selectie";
import { beheerSleutel, preflightSysteem, rondAf, vingerafdruk } from "@/core/lib/ai-preflight";
import { productieGateway } from "@/core/lib/ai-gateway/gateway-productie";

const LIJST_PAD = "/platform/generieke-bibliotheek";
const CAP = "platform.generic.library.manage" as const;

export type CuratieResultaat =
  | { ok: true; documentId: string; bericht: string }
  | { ok: false; foutcode: string; melding: string; veldfouten?: Record<string, string> };

// Retrieval-relevante velden, FormData-lezing en de diff staan sinds #504 in
// platform/lib/generiek-curatie-diff.ts (pure kern, los testbaar).

// Increment T10 (besluit 0053) — standaard reviewhorizon bij publicatie zonder
// expliciete datum. Configureerbare governance-default (te valideren): 12 maanden.
const STANDAARD_REVIEW_MAANDEN = 12;
function standaardVolgendeReview(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + STANDAARD_REVIEW_MAANDEN);
  return d.toISOString().slice(0, 10);
}

function platformMelding(foutcode: string): string {
  switch (foutcode) {
    case "no_session_or_inactive":
      return "Geen geldige platform-sessie. Log opnieuw in.";
    case "mfa_required":
      return "Sterke authenticatie (MFA) vereist voor deze handeling.";
    case "capability_denied":
      return "Je mist de rechten om de generieke bibliotheek te beheren.";
    case "audit_unavailable":
      return "Auditlog tijdelijk niet beschikbaar — handeling geblokkeerd (fail-closed).";
    default:
      return "Handeling geweigerd.";
  }
}

// ── Append-only metadata-spoor (DB-trigger zet de hash) ─────────────────────
type LogRij = CuratieLogRij;

async function logMetadata(
  svc: SupabaseClient,
  documentId: string,
  titelSnapshot: string,
  identiteit: PlatformIdentiteit,
  reden: string | null,
  rijen: LogRij[]
): Promise<void> {
  if (rijen.length === 0) return;
  const { error } = await svc.from("document_metadata_log").insert(
    rijen.map((r) => ({
      document_id: documentId,
      document_titel_snapshot: titelSnapshot,
      fonds_id: null, // generiek = fonds-overstijgend
      gewijzigd_door: identiteit.id, // 3b: platform-identiteit = auth.users-id
      gewijzigd_door_naam: identiteit.naam,
      veld_naam: r.veld_naam,
      oude_waarde: r.oude_waarde,
      nieuwe_waarde: r.nieuwe_waarde,
      wijzig_reden: reden,
      wijzig_type: r.wijzig_type,
      rag_impact: r.rag_impact,
    }))
  );
  if (error) console.error("[P1] metadata-log mislukt:", error.message);
}

// ── #499: atomische curatiewijziging via de RPC ─────────────────────────────
// Documenten-UPDATE, de chunk-denorm (trigger) én de document_metadata_log-
// regels lopen in ÉÉN transactie in de database. De RPC draagt een eigen
// statement_timeout (120 s) die PostgREST vóór het statement zet; de 8 s van de
// authenticator-sessie gold anders ook voor documenten met ~1.000 chunks, waar
// elke chunk-update een nieuw HNSW-element kost. Mislukt er iets, dan rolt alles
// terug: geen gedeeltelijke chunkmetadata en geen auditregel zonder wijziging.
type MutatieUitkomst =
  | { ok: true }
  | { ok: false; resultaat: CuratieResultaat; effect: Record<string, unknown> };

async function voerGeneriekeMutatieUit(
  svc: SupabaseClient,
  args: {
    documentId: string;
    update: Record<string, unknown>;
    logRijen: LogRij[];
    identiteit: PlatformIdentiteit;
    reden: string | null;
    /** Korte naam van de handeling voor de gebruikersmelding ("Bijwerken" …). */
    handeling: string;
    /** Bestaande foutcode van de handeling (bv. "update_mislukt"). */
    foutcode: string;
  }
): Promise<MutatieUitkomst> {
  const { error } = await svc.rpc("fn_platform_generiek_document_bijwerken", {
    p_document_id: args.documentId,
    p_wijzigingen: args.update,
    p_logregels: args.logRijen,
    p_gewijzigd_door: args.identiteit.id, // 3b: platform-identiteit = auth.users-id
    p_gewijzigd_door_naam: args.identiteit.naam,
    p_wijzig_reden: args.reden,
  });
  if (!error) return { ok: true };

  const oorzaak = classificeerMutatieFout(error);
  if (oorzaak === "onbekend" || oorzaak === "niet_beschikbaar") {
    console.error(`[P1] curatiewijziging mislukt (${args.foutcode}):`, auditFoutcode(error) ?? "zonder code");
  }
  return {
    ok: false,
    resultaat: {
      ok: false,
      foutcode: oorzaak === "niet_gevonden" ? "niet_gevonden" : args.foutcode,
      melding: mutatieFoutMelding(oorzaak, args.handeling),
    },
    effect: { afgewezen: args.foutcode, oorzaak, sqlstate: auditFoutcode(error) },
  };
}

// ── Gedeelde create-kern (gebruikt door aanmaken én vervangen) ──────────────
type MaakResultaat =
  | { ok: true; documentId: string; chunks: number; paginas: number | null }
  | { ok: false; foutcode: string; melding: string; veldfouten?: Record<string, string> };

async function maakGeneriekDocument(
  svc: SupabaseClient,
  identiteit: PlatformIdentiteit,
  correlatieId: string,
  fd: FormData,
  versieVan?: string | null
): Promise<MaakResultaat> {
  // Het bestand is al direct-naar-Storage in de quarantainezone geland (signed
  // upload URL, buiten de server-action-payload om). We krijgen alleen het pad +
  // de oorspronkelijke naam/mime; de bytes halen we hier op en valideren we
  // fail-closed. De quarantaine-kopie wordt aan het eind altijd opgeruimd.
  const pad = (fd.get("quarantaine_pad") as string | null)?.trim() || "";
  const bestandsnaam = (fd.get("bestandsnaam") as string | null) ?? "";
  const mimeType = (fd.get("mime_type") as string | null) ?? "";
  // H-13 (review 2026-07-30): een `startsWith`-prefixcheck laat `..`-segmenten
  // door (`generiek/../../documenten/<fondspad>`). storage-js bouwt de URL als
  // string en `fetch` normaliseert dot-segmenten vóór verzending, waardoor de
  // SERVICE-ROLE-client een object buiten de quarantainebucket zou kunnen
  // downloaden — en dat object daarna als GENERIEK document zou worden
  // gepubliceerd, dus leesbaar voor élke tenant. De afsluitende `remove([pad])`
  // zou bovendien een vreemd object kunnen verwijderen.
  //
  // Het pad wordt server-side gegenereerd door curatieUploadUrl als
  // `generiek/<uuid>.<ext>`; alleen exact dat patroon is nog toegestaan.
  if (!pad || !QUARANTAINE_PAD_PATROON.test(pad)) {
    return { ok: false, foutcode: "bestand_ontbreekt", melding: "Geen geüpload bestand gevonden. Upload het bestand opnieuw." };
  }

  const { data: blob, error: dlErr } = await svc.storage.from(QUARANTAINE_BUCKET).download(pad);
  if (dlErr || !blob) {
    return { ok: false, foutcode: "download_mislukt", melding: "Het geüploade bestand kon niet worden opgehaald. Upload het opnieuw." };
  }
  const resultaat = await maakUitBuffer(svc, identiteit, correlatieId, fd, versieVan, {
    buffer: Buffer.from(await blob.arrayBuffer()), naam: bestandsnaam, mimeType, quarantainePad: pad,
  });
  // Alleen afgewezen invoer opruimen. Een geaccepteerd object moet blijven tot
  // de asynchrone scanner het schoon heeft verklaard en gepromoveerd.
  if (!resultaat.ok) await svc.storage.from(QUARANTAINE_BUCKET).remove([pad]);
  return resultaat;
}

async function maakUitBuffer(
  svc: SupabaseClient,
  identiteit: PlatformIdentiteit,
  correlatieId: string,
  fd: FormData,
  versieVan: string | null | undefined,
  bron: { buffer: Buffer; naam: string; mimeType: string; quarantainePad: string }
): Promise<MaakResultaat> {
  const buffer = bron.buffer;

  // 1) Uploadsecurity (fail-closed: magic-bytes + OOXML-subtype + grootte).
  const val = await valideerUpload({ naam: bron.naam, mimeType: bron.mimeType, buffer });
  if (!val.ok) {
    return { ok: false, foutcode: val.foutcode, melding: val.melding };
  }

  // 2) Metadata + bronhygiene.
  const curatie = valideerGeneriekeCuratie(leesCuratieInvoer(fd));
  if (!curatie.ok) {
    return {
      ok: false,
      foutcode: "validatie",
      melding: "Controleer de gemarkeerde velden.",
      veldfouten: curatie.fouten,
    };
  }
  const meta: JuridischeCuratieGenormaliseerd = curatie.waarde;

  // T10: publicatie zet standaard een volgende reviewdatum als er geen is
  // opgegeven, zodat verse published-content niet zónder reviewhandhaving landt.
  if (
    meta.status === "van_kracht" &&
    (meta.bronstatus ?? "actief") === "actief" &&
    !meta.volgende_review
  ) {
    meta.volgende_review = standaardVolgendeReview();
  }

  // 3) Deduplicatie op inhoud-hash binnen de generieke bibliotheek (#8.2).
  const { data: dup } = await svc
    .from("documenten")
    .select("id")
    .eq("bibliotheek", "generiek")
    .eq("bestand_hash", val.hash)
    .limit(1)
    .maybeSingle();
  if (dup) {
    return {
      ok: false,
      foutcode: "duplicaat",
      melding: "Dit bestand staat al in de generieke bibliotheek (identieke inhoud).",
    };
  }

  // 4) documenten-rij (verwerkingsstatus 'gevalideerd'); dan de pipeline.
  const { data: doc, error: insErr } = await svc
    .from("documenten")
    .insert({
      ...meta,
      bestandstype: val.bestandstype,
      bestandsnaam: val.veiligeNaam,
      bestand_hash: val.hash,
      mime_gedetecteerd: val.mimeGedetecteerd,
      scan_resultaat: null,
      quarantaine_pad: bron.quarantainePad,
      opslag_pad: null,
      verwerkingsstatus: "gevalideerd",
      opgeslagen_door: identiteit.id,
      geindexeerd: false,
    })
    .select("id")
    .single();

  if (insErr || !doc) {
    // Race op de partial-unique hash-index → alsnog duplicaat.
    if (insErr?.code === "23505") {
      return { ok: false, foutcode: "duplicaat", melding: "Dit bestand staat al in de bibliotheek." };
    }
    console.error("[P1] documenten-insert mislukt:", insErr?.message);
    return { ok: false, foutcode: "insert_mislukt", melding: "Document kon niet worden aangemaakt." };
  }

  // validatie-job (de scan→indexering-jobs schrijft de pipeline).
  await svc.from("document_processing_jobs").insert({
    document_id: doc.id,
    versie_id: versieVan ?? null,
    stap: "validatie",
    status: "geslaagd",
    start: new Date().toISOString(),
    eind: new Date().toISOString(),
    correlatie_id: correlatieId,
  });

  await svc.from("document_processing_jobs").insert({
    document_id: doc.id,
    versie_id: versieVan ?? null,
    stap: "scan",
    status: "wachtend",
    correlatie_id: correlatieId,
  });

  await logMetadata(svc, doc.id, meta.titel, identiteit, null, [
    {
      veld_naam: "document",
      oude_waarde: null,
      nieuwe_waarde: meta.titel,
      wijzig_type: "metadata",
      rag_impact: true,
    },
  ]);

  return { ok: true, documentId: doc.id, chunks: 0, paginas: null };
}

// ── 0. UPLOAD-SLOT (signed upload URL naar de quarantainezone) ──────────────
// De browser uploadt het bestand DIRECT naar 'documenten-quarantaine' (buiten de
// server-action-payload om), zodat grote bestanden niet op de Next.js-/Vercel-
// bodylimiet stuklopen. De zone is deny-by-default; de signed token autoriseert
// de upload (geen RLS-policy nodig). Capability-gated + geaudit; het pad wordt
// SERVER-SIDE gegenereerd (geen client-padinjectie). De bindende fail-closed-
// validatie (magic-bytes) volgt alsnog server-side ná upload, bij het cureren.
export type UploadSlotResultaat =
  | { ok: true; bucket: string; pad: string; token: string }
  | { ok: false; foutcode: string; melding: string };

export async function curatieUploadUrl(input: {
  bestandsnaam: string;
  mimeType: string;
}): Promise<UploadSlotResultaat> {
  try {
    return await withPlatform<UploadSlotResultaat>(
      {
        capability: CAP,
        handeling: "platform.generic.document.upload_slot",
        doelObject: "documenten-quarantaine:generiek",
      },
      async (svc) => {
        // Vroegcontrole op type (snelle UX-afwijzing); bindt niet — magic-bytes
        // bepaalt server-side na upload. Levert ook de vertrouwde extensie.
        const bestandstype = bepaalBestandstype({
          name: input.bestandsnaam,
          type: input.mimeType,
        } as File);
        if (!bestandstype) {
          return {
            resultaat: { ok: false, foutcode: "type_niet_ondersteund", melding: "Alleen PDF, DOCX, PPTX en XLSX zijn toegestaan." },
            effect: { afgewezen: "type_niet_ondersteund" },
          };
        }

        const pad = `${GENERIEK_PAD_PREFIX}/${randomUUID()}.${bestandstype}`;
        const { data, error } = await svc.storage
          .from(QUARANTAINE_BUCKET)
          .createSignedUploadUrl(pad);
        if (error || !data) {
          return {
            resultaat: { ok: false, foutcode: "slot_mislukt", melding: "Kon geen upload-sessie starten. Probeer het opnieuw." },
            effect: { afgewezen: "slot_mislukt" },
          };
        }

        return {
          resultaat: { ok: true, bucket: QUARANTAINE_BUCKET, pad: data.path, token: data.token },
          effect: { quarantaine_pad: data.path, bestandstype },
        };
      }
    );
  } catch (e) {
    if (e instanceof PlatformError) {
      return { ok: false, foutcode: e.foutcode, melding: platformMelding(e.foutcode) };
    }
    console.error("[P1] onverwachte fout bij upload-slot:", e);
    return { ok: false, foutcode: "serverfout", melding: "Er ging iets mis. Probeer het opnieuw." };
  }
}

// ── 1. AANMAKEN ─────────────────────────────────────────────────────────────
export async function curatieAanmaken(fd: FormData): Promise<CuratieResultaat> {
  try {
    return await withPlatform<CuratieResultaat>(
      { capability: CAP, handeling: "platform.generic.document.create", doelObject: "documenten:generiek" },
      async (svc, { identiteit, correlatieId }) => {
        const r = await maakGeneriekDocument(svc, identiteit, correlatieId, fd);
        if (!r.ok) {
          return {
            resultaat: { ok: false, foutcode: r.foutcode, melding: r.melding, veldfouten: r.veldfouten },
            effect: { afgewezen: r.foutcode },
          };
        }
        revalidatePath(LIJST_PAD);
        return {
          resultaat: {
            ok: true,
            documentId: r.documentId,
            bericht: "Generiek document ontvangen en in beveiligingscontrole.",
          },
          effect: { document_id: r.documentId, chunks: 0, paginas: null, verwerkingsstatus: "gevalideerd" },
        };
      }
    );
  } catch (e) {
    return naarFout(e, "aanmaken");
  }
}

// ── 2. BIJWERKEN (geen re-upload) ───────────────────────────────────────────
export async function curatieBijwerken(documentId: string, fd: FormData): Promise<CuratieResultaat> {
  try {
    const reden = (fd.get("reden") as string)?.trim() || "";
    return await withPlatform<CuratieResultaat>(
      {
        capability: CAP,
        handeling: "platform.generic.document.update",
        doelObject: `documenten:${documentId}`,
        reden: reden || null,
      },
      async (svc, { identiteit, correlatieId }) => {
        void correlatieId;
        const { data: huidig } = await svc
          .from("documenten")
          .select(
            "id, titel, bron, bronorganisatie, extern_url, normgewicht, documentdatum, geldig_vanaf, geldig_tot, status, bronstatus, toepassingsgebied, regelingstype, doelgroep, thema, statusinterpretatie, eigenaar, volgende_review, versie, bibliotheek, documenttype, wetsgeschiedenis_subtype, dossiernummer, wettelijk_regime"
          )
          .eq("id", documentId)
          .maybeSingle();

        if (!huidig || huidig.bibliotheek !== "generiek") {
          return {
            resultaat: { ok: false, foutcode: "niet_gevonden", melding: "Generiek document niet gevonden." },
            effect: { afgewezen: "niet_gevonden" },
          };
        }

        const curatie = valideerGeneriekeCuratie(leesCuratieInvoer(fd));
        if (!curatie.ok) {
          return {
            resultaat: { ok: false, foutcode: "validatie", melding: "Controleer de gemarkeerde velden.", veldfouten: curatie.fouten },
            effect: { afgewezen: "validatie" },
          };
        }
        const meta = curatie.waarde;

        // T10: als de bewerking een CANONIEKE overgang inhoudt (bv. via status/
        // bronstatus published→deprecated of →withdrawn), geldt dezelfde reden-plicht
        // als bij de expliciete deprecate/withdraw/herpubliceer-acties — fail-closed,
        // zodat de audit-reden niet omzeild kan worden via de vrije edit. De DB-poort
        // borgt de LEGALITEIT van de overgang; de reden-plicht borgen we hier server-side.
        const oudCanon = generiekGeldigheidsstatus({ status: huidig.status, bronstatus: huidig.bronstatus });
        const nieuwCanon = generiekGeldigheidsstatus({ status: meta.status, bronstatus: meta.bronstatus });
        if (oudCanon !== nieuwCanon && generiekTransitieRedenplicht(oudCanon, nieuwCanon) && !reden) {
          return {
            resultaat: {
              ok: false,
              foutcode: "reden_vereist",
              melding: `Statusovergang ${oudCanon} → ${nieuwCanon} vereist een reden (verplicht voor het auditspoor).`,
              veldfouten: { reden: "Geef een reden op voor deze statusovergang." },
            },
            effect: { afgewezen: "reden_vereist", van: oudCanon, naar: nieuwCanon },
          };
        }

        // Diff t.o.v. de huidige waarden (alleen de bewerkbare §8.1-velden).
        const { update, logRijen } = bouwCuratieDiff(huidig as Record<string, unknown>, meta);

        if (Object.keys(update).length === 0) {
          return {
            resultaat: { ok: true, documentId, bericht: "Geen wijzigingen." },
            effect: { document_id: documentId, gewijzigde_velden: 0 },
          };
        }

        // #499: wijziging + chunk-denorm + metadata-log atomisch in één RPC.
        const mutatie = await voerGeneriekeMutatieUit(svc, {
          documentId,
          update,
          logRijen,
          identiteit,
          reden: reden || null,
          handeling: "Bijwerken",
          foutcode: "update_mislukt",
        });
        if (!mutatie.ok) return { resultaat: mutatie.resultaat, effect: mutatie.effect };
        revalidatePath(LIJST_PAD);

        return {
          resultaat: { ok: true, documentId, bericht: `${logRijen.length} veld(en) bijgewerkt.` },
          effect: { document_id: documentId, gewijzigde_velden: logRijen.length, rag_impact: logRijen.some((r) => r.rag_impact) },
        };
      }
    );
  } catch (e) {
    return naarFout(e, "bijwerken");
  }
}

// ── 3. DEPRECATE — markeer als verouderd (blijft raadpleegbaar als historie) ──
// Increment T10: dit is een DEPRECATE (canoniek published → deprecated), NIET een
// withdraw. Zet status='alleen_historisch' + bronstatus='historisch' (→ afgeleide
// status 'deprecated'). De bron valt weg als ACTUELE bron (RPC published-gate),
// maar blijft als historie leesbaar. Reden verplicht (transitie-redenplicht).
export async function curatieDepreceren(documentId: string, reden: string): Promise<CuratieResultaat> {
  const redenTrim = reden?.trim() || "";
  try {
    return await withPlatform<CuratieResultaat>(
      {
        capability: CAP,
        handeling: "platform.generic.document.deprecate",
        doelObject: `documenten:${documentId}`,
        reden: redenTrim || null,
      },
      async (svc, { identiteit }) => {
        if (!redenTrim) {
          return {
            resultaat: { ok: false, foutcode: "reden_vereist", melding: "Geef een reden op (verplicht voor het auditspoor)." },
            effect: { afgewezen: "reden_vereist" },
          };
        }
        const { data: huidig } = await svc
          .from("documenten")
          .select("id, titel, status, bronstatus, geldig_tot, bibliotheek")
          .eq("id", documentId)
          .maybeSingle();

        if (!huidig || huidig.bibliotheek !== "generiek") {
          return {
            resultaat: { ok: false, foutcode: "niet_gevonden", melding: "Generiek document niet gevonden." },
            effect: { afgewezen: "niet_gevonden" },
          };
        }
        const canon = generiekGeldigheidsstatus({ status: huidig.status, bronstatus: huidig.bronstatus });
        if (canon === "deprecated") {
          return {
            resultaat: { ok: true, documentId, bericht: "Document was al gemarkeerd als verouderd." },
            effect: { document_id: documentId, reeds: true },
          };
        }

        const vandaag = new Date().toISOString().slice(0, 10);
        const nieuwGeldigTot = huidig.geldig_tot ?? vandaag;
        const mutatie = await voerGeneriekeMutatieUit(svc, {
          documentId,
          update: { status: "historisch", bronstatus: "historisch", geldig_tot: nieuwGeldigTot },
          logRijen: [
            { veld_naam: "status", oude_waarde: huidig.status, nieuwe_waarde: "historisch", wijzig_type: "status", rag_impact: true },
            { veld_naam: "bronstatus", oude_waarde: huidig.bronstatus, nieuwe_waarde: "historisch", wijzig_type: "bronstatus", rag_impact: true },
            { veld_naam: "geldig_tot", oude_waarde: huidig.geldig_tot, nieuwe_waarde: nieuwGeldigTot, wijzig_type: "metadata", rag_impact: true },
          ],
          identiteit,
          reden: redenTrim,
          handeling: "Markeren als verouderd",
          foutcode: "deprecate_mislukt",
        });
        if (!mutatie.ok) return { resultaat: mutatie.resultaat, effect: mutatie.effect };
        revalidatePath(LIJST_PAD);

        return {
          resultaat: { ok: true, documentId, bericht: "Document gemarkeerd als verouderd (deprecated)." },
          effect: { document_id: documentId, canoniek: "deprecated" },
        };
      }
    );
  } catch (e) {
    return naarFout(e, "deprecate");
  }
}

// ── 3a. WITHDRAW — intrekken als bron (uitgesloten, niet meer bruikbaar) ──────
// Increment T10: canoniek published/deprecated → withdrawn. Zet bronstatus=
// 'uitgesloten' (→ afgeleide status 'withdrawn' ongeacht documentstatus). De bron
// is daarmee definitief uitgesloten als bron (herstel = nieuw document / expliciete
// herpublicatie is niet toegestaan vanuit withdrawn). Reden verplicht.
export async function curatieWithdrawn(documentId: string, reden: string): Promise<CuratieResultaat> {
  const redenTrim = reden?.trim() || "";
  try {
    return await withPlatform<CuratieResultaat>(
      {
        capability: CAP,
        handeling: "platform.generic.document.withdraw",
        doelObject: `documenten:${documentId}`,
        reden: redenTrim || null,
      },
      async (svc, { identiteit }) => {
        if (!redenTrim) {
          return {
            resultaat: { ok: false, foutcode: "reden_vereist", melding: "Geef een reden op (verplicht voor het auditspoor)." },
            effect: { afgewezen: "reden_vereist" },
          };
        }
        const { data: huidig } = await svc
          .from("documenten")
          .select("id, titel, status, bronstatus, geldig_tot, bibliotheek")
          .eq("id", documentId)
          .maybeSingle();

        if (!huidig || huidig.bibliotheek !== "generiek") {
          return {
            resultaat: { ok: false, foutcode: "niet_gevonden", melding: "Generiek document niet gevonden." },
            effect: { afgewezen: "niet_gevonden" },
          };
        }
        const canon = generiekGeldigheidsstatus({ status: huidig.status, bronstatus: huidig.bronstatus });
        if (canon === "withdrawn") {
          return {
            resultaat: { ok: true, documentId, bericht: "Document was al ingetrokken (uitgesloten)." },
            effect: { document_id: documentId, reeds: true },
          };
        }

        const vandaag = new Date().toISOString().slice(0, 10);
        const nieuwGeldigTot = huidig.geldig_tot ?? vandaag;
        const mutatie = await voerGeneriekeMutatieUit(svc, {
          documentId,
          update: { bronstatus: "uitgesloten", geldig_tot: nieuwGeldigTot },
          logRijen: [
            { veld_naam: "bronstatus", oude_waarde: huidig.bronstatus, nieuwe_waarde: "uitgesloten", wijzig_type: "bronstatus", rag_impact: true },
            { veld_naam: "geldig_tot", oude_waarde: huidig.geldig_tot, nieuwe_waarde: nieuwGeldigTot, wijzig_type: "metadata", rag_impact: true },
          ],
          identiteit,
          reden: redenTrim,
          handeling: "Intrekken",
          foutcode: "withdraw_mislukt",
        });
        if (!mutatie.ok) return { resultaat: mutatie.resultaat, effect: mutatie.effect };
        revalidatePath(LIJST_PAD);

        return {
          resultaat: { ok: true, documentId, bericht: "Document ingetrokken (uitgesloten als bron)." },
          effect: { document_id: documentId, canoniek: "withdrawn" },
        };
      }
    );
  } catch (e) {
    return naarFout(e, "withdraw");
  }
}

// ── 3b. HERPUBLICEREN — verouderde content weer actueel maken na review ───────
// Increment T10: canoniek deprecated → published. Zet status='van_kracht' +
// bronstatus='actief' en een NIEUWE volgende_review (opgegeven of standaard).
// Alleen toegestaan vanuit 'deprecated' (niet vanuit 'withdrawn'; die is terminaal).
// Reden verplicht.
export async function curatieHerpubliceren(
  documentId: string,
  reden: string,
  volgendeReview?: string
): Promise<CuratieResultaat> {
  const redenTrim = reden?.trim() || "";
  const reviewInvoer = volgendeReview?.trim() || "";
  try {
    return await withPlatform<CuratieResultaat>(
      {
        capability: CAP,
        handeling: "platform.generic.document.republish",
        doelObject: `documenten:${documentId}`,
        reden: redenTrim || null,
      },
      async (svc, { identiteit }) => {
        if (!redenTrim) {
          return {
            resultaat: { ok: false, foutcode: "reden_vereist", melding: "Geef een reden op (verplicht voor het auditspoor)." },
            effect: { afgewezen: "reden_vereist" },
          };
        }
        if (reviewInvoer && !/^\d{4}-\d{2}-\d{2}$/.test(reviewInvoer)) {
          return {
            resultaat: { ok: false, foutcode: "validatie", melding: "Volgende review moet het formaat JJJJ-MM-DD hebben." },
            effect: { afgewezen: "validatie" },
          };
        }
        const { data: huidig } = await svc
          .from("documenten")
          .select("id, titel, status, bronstatus, volgende_review, bibliotheek")
          .eq("id", documentId)
          .maybeSingle();

        if (!huidig || huidig.bibliotheek !== "generiek") {
          return {
            resultaat: { ok: false, foutcode: "niet_gevonden", melding: "Generiek document niet gevonden." },
            effect: { afgewezen: "niet_gevonden" },
          };
        }
        const canon = generiekGeldigheidsstatus({ status: huidig.status, bronstatus: huidig.bronstatus });
        if (canon !== "deprecated") {
          return {
            resultaat: { ok: false, foutcode: "niet_deprecated", melding: "Alleen verouderde (deprecated) content kan opnieuw worden gepubliceerd." },
            effect: { afgewezen: `canoniek_${canon}` },
          };
        }

        const nieuweReview = reviewInvoer || standaardVolgendeReview();
        const mutatie = await voerGeneriekeMutatieUit(svc, {
          documentId,
          update: { status: "van_kracht", bronstatus: "actief", volgende_review: nieuweReview },
          logRijen: [
            { veld_naam: "status", oude_waarde: huidig.status, nieuwe_waarde: "van_kracht", wijzig_type: "status", rag_impact: true },
            { veld_naam: "bronstatus", oude_waarde: huidig.bronstatus, nieuwe_waarde: "actief", wijzig_type: "bronstatus", rag_impact: true },
            { veld_naam: "volgende_review", oude_waarde: huidig.volgende_review, nieuwe_waarde: nieuweReview, wijzig_type: "metadata", rag_impact: true },
          ],
          identiteit,
          reden: redenTrim,
          handeling: "Herpubliceren",
          foutcode: "herpubliceren_mislukt",
        });
        if (!mutatie.ok) return { resultaat: mutatie.resultaat, effect: mutatie.effect };
        revalidatePath(LIJST_PAD);

        return {
          resultaat: { ok: true, documentId, bericht: `Document opnieuw gepubliceerd; volgende review ${nieuweReview}.` },
          effect: { document_id: documentId, canoniek: "published", volgende_review: nieuweReview },
        };
      }
    );
  } catch (e) {
    return naarFout(e, "herpubliceren");
  }
}

// ── 3b. HARD VERWIJDEREN (volledige verwijdering, alleen generiek) ──────────
// Anders dan curatieIntrekken (status alleen_historisch, append-only) verwijdert
// dit de rij + chunks + het opgeslagen origineel ONOMKEERBAAR. Bewust beperkt tot
// de generieke bibliotheek (platform back-office, één curator); tenant-documenten
// en Decision Objects blijven principieel niet hard-verwijderbaar (CLAUDE.md,
// besluit 0001). Reden: een mislukt/duplicaat generiek document blokkeert anders
// permanent een nieuwe upload van dezelfde inhoud (inhoud-hash-dedup, #8.2). De
// verwijdering zelf wordt via withPlatform append-only geaudit in
// platform_event_log (de document_metadata_log-rij verdwijnt mee met de FK).
export async function curatieVerwijderen(documentId: string, reden?: string): Promise<CuratieResultaat> {
  try {
    return await withPlatform<CuratieResultaat>(
      {
        capability: CAP,
        handeling: "platform.generic.document.delete",
        doelObject: `documenten:${documentId}`,
        reden: reden?.trim() || null,
      },
      async (svc) => {
        const { data: huidig } = await svc
          .from("documenten")
          .select("id, titel, opslag_pad, bibliotheek")
          .eq("id", documentId)
          .maybeSingle();

        if (!huidig || huidig.bibliotheek !== "generiek") {
          return {
            resultaat: { ok: false, foutcode: "niet_gevonden", melding: "Generiek document niet gevonden." },
            effect: { afgewezen: "niet_gevonden" },
          };
        }

        // 1) Chunks expliciet weg (geen bevestigde ON DELETE CASCADE op
        //    document_chunks in de gedateerde migraties — niet op cascade vertrouwen).
        const { error: chunkErr } = await svc.from("document_chunks").delete().eq("document_id", documentId);
        if (chunkErr) {
          return {
            resultaat: { ok: false, foutcode: "verwijderen_mislukt", melding: "Kon de zoekfragmenten niet verwijderen." },
            effect: { afgewezen: "chunks_verwijderen_mislukt", fout: chunkErr.message },
          };
        }

        // 2) Origineel uit Storage (best-effort; een opruimfout mag de rij-delete
        //    niet blokkeren — verweesde storage-objecten zijn minder erg dan een
        //    onverwijderbare rij die de dedup blijft blokkeren).
        let storageOpgeruimd = false;
        if (huidig.opslag_pad) {
          const { error: rmErr } = await svc.storage.from(STORAGE_BUCKET).remove([huidig.opslag_pad]);
          if (rmErr) console.error("[P1] origineel-verwijderen mislukt:", rmErr.message);
          else storageOpgeruimd = true;
        }

        // 3) De documentrij. document_processing_jobs hangt op ON DELETE CASCADE;
        //    self-FK's (vervangt/vervangen_door) en externe verwijzingen staan op
        //    ON DELETE SET NULL — dus geen FK-blokkade.
        const { error: rowErr } = await svc.from("documenten").delete().eq("id", documentId);
        if (rowErr) {
          return {
            resultaat: { ok: false, foutcode: "verwijderen_mislukt", melding: "Verwijderen geweigerd door de database." },
            effect: { afgewezen: "rij_verwijderen_mislukt", fout: rowErr.message },
          };
        }

        revalidatePath(LIJST_PAD);
        return {
          resultaat: { ok: true, documentId, bericht: "Document definitief verwijderd." },
          effect: {
            document_id: documentId,
            titel_snapshot: huidig.titel,
            had_origineel: !!huidig.opslag_pad,
            storage_opgeruimd: storageOpgeruimd,
          },
        };
      }
    );
  } catch (e) {
    return naarFout(e, "verwijderen");
  }
}

// ── 4. VERVANGEN (nieuwe versie) ────────────────────────────────────────────
export async function curatieVervangen(oudId: string, fd: FormData): Promise<CuratieResultaat> {
  try {
    return await withPlatform<CuratieResultaat>(
      {
        capability: CAP,
        handeling: "platform.generic.document.replace",
        doelObject: `documenten:${oudId}`,
      },
      async (svc, { identiteit, correlatieId }) => {
        const { data: oud } = await svc
          .from("documenten")
          .select("id, titel, status, bronstatus, bibliotheek, vervangen_door_document_id")
          .eq("id", oudId)
          .maybeSingle();

        if (!oud || oud.bibliotheek !== "generiek") {
          return {
            resultaat: { ok: false, foutcode: "niet_gevonden", melding: "Te vervangen generiek document niet gevonden." },
            effect: { afgewezen: "niet_gevonden" },
          };
        }
        if (oud.vervangen_door_document_id) {
          return {
            resultaat: { ok: false, foutcode: "al_vervangen", melding: "Dit document is al vervangen door een nieuwere versie." },
            effect: { afgewezen: "al_vervangen" },
          };
        }

        // Nieuwe versie volledig aanmaken (upload + pipeline). versie_id = oudId.
        const nieuw = await maakGeneriekDocument(svc, identiteit, correlatieId, fd, oudId);
        if (!nieuw.ok) {
          return {
            resultaat: { ok: false, foutcode: nieuw.foutcode, melding: nieuw.melding, veldfouten: nieuw.veldfouten },
            effect: { afgewezen: nieuw.foutcode },
          };
        }

        // Koppel beide kanten van de self-FK + oude versie → historisch.
        const vandaag = new Date().toISOString().slice(0, 10);
        await svc
          .from("documenten")
          .update({
            vervangen_door_document_id: nieuw.documentId,
            status: "historisch",
            bronstatus: "historisch",
            geldig_tot: vandaag,
          })
          .eq("id", oudId);
        await svc
          .from("documenten")
          .update({ vervangt_document_id: oudId })
          .eq("id", nieuw.documentId);

        await logMetadata(svc, oudId, oud.titel, identiteit, "Vervangen door nieuwe versie", [
          { veld_naam: "vervangen_door_document_id", oude_waarde: null, nieuwe_waarde: nieuw.documentId, wijzig_type: "koppeling", rag_impact: false },
          { veld_naam: "status", oude_waarde: oud.status, nieuwe_waarde: "historisch", wijzig_type: "status", rag_impact: true },
          { veld_naam: "bronstatus", oude_waarde: oud.bronstatus, nieuwe_waarde: "historisch", wijzig_type: "bronstatus", rag_impact: true },
        ]);
        revalidatePath(LIJST_PAD);

        return {
          resultaat: { ok: true, documentId: nieuw.documentId, bericht: "Nieuwe versie gepubliceerd; oude versie gearchiveerd." },
          effect: { oud_document_id: oudId, nieuw_document_id: nieuw.documentId, chunks: nieuw.chunks },
        };
      }
    );
  } catch (e) {
    return naarFout(e, "vervangen");
  }
}

// ── 5. INZAGE (kortlevende signed-URL voor het origineel) ───────────────────
// Het generieke origineel staat in de private bucket 'documenten' op het pad
// generiek/<id>.<type>. Tenants kunnen dit niet via RLS lezen; de platform-
// curator krijgt via de service-role een kortlevende signed-URL. Read-actie,
// maar wél geaudit (attempt+result) via withPlatform.
export type InzageResultaat =
  | { ok: true; url: string; bestandsnaam: string | null }
  | { ok: false; foutcode: string; melding: string };

const INZAGE_GELDIGHEID_SEC = 120;

export async function curatieInzageUrl(documentId: string): Promise<InzageResultaat> {
  try {
    return await withPlatform<InzageResultaat>(
      {
        capability: CAP,
        handeling: "platform.generic.document.view",
        doelObject: `documenten:${documentId}`,
      },
      async (svc) => {
        const { data: doc } = await svc
          .from("documenten")
          .select("id, opslag_pad, bestandsnaam, bibliotheek")
          .eq("id", documentId)
          .maybeSingle();

        if (!doc || doc.bibliotheek !== "generiek") {
          return {
            resultaat: { ok: false, foutcode: "niet_gevonden", melding: "Generiek document niet gevonden." },
            effect: { afgewezen: "niet_gevonden" },
          };
        }
        if (!doc.opslag_pad) {
          return {
            resultaat: { ok: false, foutcode: "geen_origineel", melding: "Voor dit document is geen origineel opgeslagen." },
            effect: { afgewezen: "geen_origineel" },
          };
        }

        const { data: signed, error: signErr } = await svc.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(doc.opslag_pad, INZAGE_GELDIGHEID_SEC);
        if (signErr || !signed) {
          return {
            resultaat: { ok: false, foutcode: "url_mislukt", melding: "Kon geen inzage-link maken." },
            effect: { afgewezen: "url_mislukt" },
          };
        }

        return {
          resultaat: { ok: true, url: signed.signedUrl, bestandsnaam: doc.bestandsnaam ?? null },
          effect: { document_id: documentId, geldigheid_sec: INZAGE_GELDIGHEID_SEC },
        };
      }
    );
  } catch (e) {
    if (e instanceof PlatformError) {
      return { ok: false, foutcode: e.foutcode, melding: platformMelding(e.foutcode) };
    }
    console.error("[P1] onverwachte fout bij inzage:", e);
    return { ok: false, foutcode: "serverfout", melding: "Er ging iets mis. Probeer het opnieuw." };
  }
}

// ── 8. HER-INDEXEREN GENERIEKE BIBLIOTHEEK (#548, service-role) ─────────────
// Eenmalige herindexering van BESTAANDE generieke PDF/DOCX-documenten naar de
// gedeelde bronblokken-indexering (BRONBLOKKEN_INDEXERING_VERSIE). Tenants zijn
// op generieke chunks read-only (RLS), dus dit loopt via de platform-back-office
// met de service-role-client. ÉÉN document per aanroep; de UI roept herhaaldelijk
// aan tot `klaar`. Bestaande fondsdocumenten worden hier nooit aangeraakt: de
// selectie leest uitsluitend documenten met bibliotheek = 'generiek'.
//
// Per document: herindexeerDocument (chunks atomisch vervangen, verrijken, bij
// een fout opruimen + status 'mislukt'). De uitkomst komt als job-regel in
// document_processing_jobs (stap 'indexering', foutcode herindex:<versie>:…),
// zodat een mislukt of overgeslagen document — ook zonder resterende chunks —
// terug te vinden en gericht te hervatten is. Een mislukt document blokkeert
// de batch niet; het blijft in `mislukt` staan tot een gerichte herhaling.
export type HerindexGeneriekResultaat =
  | {
      ok: true;
      document_id: string | null;
      titel: string | null;
      status: "verwerkt" | "overgeslagen" | "mislukt" | "klaar";
      reden: string | null;
      aantal_chunks: number;
      resterend: number;
      mislukt: { document_id: string; titel: string | null; reden: string | null }[];
      overgeslagen: number;
      klaar: boolean;
    }
  | { ok: false; foutcode: string; melding: string };

export interface HerindexGeneriekOpties {
  /** Pilot of hervatten: precies dit generieke document (ook als het mislukt was). */
  documentId?: string;
}

const HERINDEX_TYPES = ["pdf", "docx"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function leesHerindexStand(svc: SupabaseClient) {
  const { data: docs, error: docErr } = await svc
    .from("documenten")
    .select("id, titel, geindexeerd")
    .eq("bibliotheek", "generiek")
    .eq("actief", true)
    .in("bestandstype", HERINDEX_TYPES)
    .order("titel", { ascending: true })
    .order("id", { ascending: true })
    .limit(5000);
  if (docErr) throw new Error(`herindex-selectie documenten: ${docErr.message}`);
  // Eén rij per document: chunk 0 op de doelversie.
  const { data: klaarRijen, error: klaarErr } = await svc
    .from("document_chunks")
    .select("document_id")
    .eq("bibliotheek", "generiek")
    .eq("chunk_index", 0)
    .eq("indexering_versie", BRONBLOKKEN_INDEXERING_VERSIE)
    .limit(5000);
  if (klaarErr) throw new Error(`herindex-selectie chunks: ${klaarErr.message}`);
  const { data: jobs, error: jobErr } = await svc
    .from("document_processing_jobs")
    .select("document_id, status, foutcode, aangemaakt")
    .eq("stap", "indexering")
    .like("foutcode", `${herindexFoutcode(BRONBLOKKEN_INDEXERING_VERSIE, "")}%`)
    .order("aangemaakt", { ascending: false })
    .limit(10000);
  if (jobErr) throw new Error(`herindex-selectie jobs: ${jobErr.message}`);
  return bepaalHerindexStand(
    (docs ?? []) as HerindexDocRij[],
    new Set(((klaarRijen ?? []) as { document_id: string }[]).map((r) => r.document_id)),
    (jobs ?? []) as HerindexJobRij[],
    BRONBLOKKEN_INDEXERING_VERSIE
  );
}

export async function curatieHerindexeren(
  opties: HerindexGeneriekOpties = {}
): Promise<HerindexGeneriekResultaat> {
  if (opties.documentId !== undefined && !UUID_RE.test(opties.documentId)) {
    return { ok: false, foutcode: "ongeldig", melding: "Ongeldig document." };
  }
  try {
    return await withPlatform<HerindexGeneriekResultaat>(
      {
        capability: CAP,
        handeling: "platform.generic.library.reindex",
        doelObject: opties.documentId ? `documenten:${opties.documentId}` : "documenten:generiek",
      },
      async (svc, { identiteit }) => {
        const stand = await leesHerindexStand(svc);
        const samenvatting = () => ({
          resterend: stand.teDoen.length,
          mislukt: stand.mislukt.map((d) => ({ document_id: d.id, titel: d.titel, reden: d.reden })),
          overgeslagen: stand.overgeslagen.length,
        });

        const doelId = opties.documentId ?? stand.teDoen[0]?.id ?? null;
        if (!doelId) {
          return {
            resultaat: {
              ok: true,
              document_id: null,
              titel: null,
              status: "klaar",
              reden: null,
              aantal_chunks: 0,
              ...samenvatting(),
              klaar: true,
            },
            effect: { klaar: true, resterend: 0, mislukt: stand.mislukt.length },
          };
        }

        const { data: doc } = await svc
          .from("documenten")
          .select(
            "id, titel, opslag_pad, bestandstype, bibliotheek, fonds_id, documenttype, wetsgeschiedenis_subtype"
          )
          .eq("id", doelId)
          .maybeSingle();

        // Harde grens: alleen generieke documenten. Een fondsdocument-id wordt
        // geweigerd, ook als het expliciet wordt meegegeven.
        if (!doc || doc.bibliotheek !== "generiek" || doc.fonds_id !== null) {
          return {
            resultaat: { ok: false, foutcode: "niet_gevonden", melding: "Generiek document niet gevonden." },
            effect: { afgewezen: "niet_gevonden" },
          };
        }

        const correlatieId = randomUUID();
        const gestart = new Date().toISOString();
        const pf = await preflightSysteem(svc, {
          actietype: "generiek_curatie",
          fondsId: null,
          provider: null,
          model: null,
          idempotentie: beheerSleutel("generiek_curatie"),
          vingerafdruk: vingerafdruk({ documentId: doc.id, handeling: "herindexeren" }),
        });
        if (pf.uitkomst !== "nieuw" || !pf.actieId) {
          return {
            resultaat: {
              ok: false,
              foutcode: "ai_begrenzing",
              melding: "AI-herindexering is op dit moment niet beschikbaar.",
            },
            effect: { afgewezen: "ai_begrenzing" },
          };
        }
        let res: Awaited<ReturnType<typeof herindexeerDocument>>;
        try {
          res = await herindexeerDocument(svc, doc, {
            gateway: {
              gateway: productieGateway(),
              ctx: {
                supabase: svc,
                fondsId: null,
                actor: { soort: "systeem", proces: "generieke-herindexering" },
                actieId: pf.actieId,
                correlatieId,
                label: "generieke-herindexering",
              },
            },
            reserveerOcr: async (paginas, poging) => {
              const ocrPf = await preflightSysteem(svc, {
                actietype: "ocr_generiek",
                fondsId: null,
                provider: "mistral",
                model: "mistral-ocr-latest",
                ocrPaginas: paginas,
                idempotentie: `${beheerSleutel("ocr_generiek")}:${poging}`,
                vingerafdruk: vingerafdruk({ documentId: doc.id, paginas, poging }),
              });
              return ocrPf.uitkomst === "nieuw";
            },
          });
        } catch (e) {
          // Onverwachte fout (bv. gateway-configuratie): dezelfde opruiming als
          // bij een fout ná de vervanging, zodat er nooit een half verrijkte
          // chunkset als volledig blijft staan.
          console.error("[P1] herindexering onverwacht afgebroken:", e);
          res = {
            status: "mislukt",
            aantalChunks: 0,
            prefixModel: null,
            embeddingsGelukt: false,
            reden: "onverwachte_fout",
          };
          const { count } = await svc
            .from("document_chunks")
            .select("id", { count: "exact", head: true })
            .eq("document_id", doc.id)
            .is("embedding", null);
          if ((count ?? 0) > 0) await ruimChunksOp(svc, doc.id);
        }
        await rondAf(
          svc,
          pf.actieId,
          res.status === "mislukt" ? "mislukt" : "voltooid",
          `document:${doc.id}`
        );

        // Uitkomst vastleggen (terugvindbaar, ook zonder resterende chunks).
        const { error: jobErr } = await svc.from("document_processing_jobs").insert({
          document_id: doc.id,
          stap: "indexering",
          status:
            res.status === "verwerkt" ? "geslaagd" : res.status === "overgeslagen" ? "overgeslagen" : "mislukt",
          foutcode: herindexFoutcode(BRONBLOKKEN_INDEXERING_VERSIE, res.reden ?? "ok"),
          start: gestart,
          eind: new Date().toISOString(),
          correlatie_id: correlatieId,
          fonds_id: null,
        });
        if (jobErr) console.error("[P1] herindex-job niet geschreven:", jobErr.message);

        // Per-run provenance: generiek → fonds_id NULL, gestart_door = platform-id.
        const { error: runErr } = await svc.from("reindex_runs").insert({
          fonds_id: null,
          bibliotheek: "generiek",
          prefix_model: res.prefixModel,
          prompt_versie: PREFIX_PROMPT_VERSIE,
          indexering_versie: BRONBLOKKEN_INDEXERING_VERSIE,
          aantal_documenten: res.status === "verwerkt" ? 1 : 0,
          aantal_chunks: res.aantalChunks,
          gestart_door: identiteit.id,
        });
        if (runErr) console.error("[P1] reindex_runs (generiek) niet geschreven:", runErr.message);

        const na = await leesHerindexStand(svc);
        revalidatePath(LIJST_PAD);

        return {
          resultaat: {
            ok: true,
            document_id: doc.id,
            titel: doc.titel,
            status: res.status,
            reden: res.reden ?? null,
            aantal_chunks: res.aantalChunks,
            resterend: na.teDoen.length,
            mislukt: na.mislukt.map((d) => ({ document_id: d.id, titel: d.titel, reden: d.reden })),
            overgeslagen: na.overgeslagen.length,
            klaar: na.teDoen.length === 0,
          },
          effect: {
            document_id: doc.id,
            status: res.status,
            reden: res.reden ?? null,
            aantal_chunks: res.aantalChunks,
            resterend: na.teDoen.length,
            mislukt: na.mislukt.length,
            correlatie_id: correlatieId,
          },
        };
      }
    );
  } catch (e) {
    if (e instanceof PlatformError) {
      return { ok: false, foutcode: e.foutcode, melding: platformMelding(e.foutcode) };
    }
    console.error("[P1] onverwachte fout bij her-indexeren:", e);
    return { ok: false, foutcode: "serverfout", melding: "Er ging iets mis. Probeer het opnieuw." };
  }
}

function naarFout(e: unknown, waar: string): CuratieResultaat {
  if (e instanceof PlatformError) {
    return { ok: false, foutcode: e.foutcode, melding: platformMelding(e.foutcode) };
  }
  console.error(`[P1] onverwachte fout bij ${waar}:`, e);
  return { ok: false, foutcode: "serverfout", melding: "Er ging iets mis. Probeer het opnieuw." };
}
