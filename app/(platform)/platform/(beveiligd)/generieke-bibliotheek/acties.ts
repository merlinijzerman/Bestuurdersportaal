"use server";

// ============================================================================
//  Server-actions — generieke documentcuratie (Increment P1/B14, FO §8).
// ----------------------------------------------------------------------------
//  Vier handelingen, ALLE achter withPlatform (capability
//  platform.generic.library.manage + twee-fasen-audit):
//    • curatieAanmaken  — upload + §8.1-metadata + uploadsecurity-pipeline.
//    • curatieBijwerken — metadata wijzigen ZONDER re-upload (auto-doorwerking
//                         naar de chunks via de bestaande denorm-trigger, #4).
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
import { withPlatform, PlatformError } from "@/lib/platform-wrapper";
import type { PlatformIdentiteit } from "@/lib/platform-auth";
import { valideerUpload } from "@/lib/bestand-validatie";
import { bepaalBestandstype } from "@/lib/document-extractie";
import {
  valideerCuratie,
  type CuratieInvoer,
  type CuratieGenormaliseerd,
} from "@/lib/generiek-curatie";
import {
  verwerkGeneriekBestand,
  STORAGE_BUCKET,
  QUARANTAINE_BUCKET,
  GENERIEK_PAD_PREFIX,
} from "@/lib/generiek-pipeline";
import { herindexeerDocument } from "@/lib/reindex";
import { INDEXERING_VERSIE, PREFIX_MODEL, PREFIX_PROMPT_VERSIE } from "@/lib/chunk-ingest";

const LIJST_PAD = "/platform/generieke-bibliotheek";
const CAP = "platform.generic.library.manage" as const;

export type CuratieResultaat =
  | { ok: true; documentId: string; bericht: string }
  | { ok: false; foutcode: string; melding: string; veldfouten?: Record<string, string> };

// Retrieval-relevante velden: een wijziging hieraan werkt door in de RAG-laag
// (denorm op de chunks / G-filtering), dus rag_impact=true in het auditspoor.
const RAG_VELDEN = new Set([
  "normgewicht",
  "bronorganisatie",
  "extern_url",
  "bronstatus",
  "geldig_tot",
  "status",
]);

// ── FormData → CuratieInvoer ────────────────────────────────────────────────
function leesInvoer(fd: FormData): CuratieInvoer {
  const s = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v : null;
  };
  return {
    titel: s("titel"),
    bron: s("bron"),
    bronorganisatie: s("bronorganisatie"),
    extern_url: s("extern_url"),
    normgewicht: s("normgewicht"),
    documentdatum: s("documentdatum"),
    geldig_vanaf: s("geldig_vanaf"),
    geldig_tot: s("geldig_tot"),
    documentstatus: s("documentstatus"),
    bronstatus: s("bronstatus"),
    toepassingsgebied: s("toepassingsgebied"),
    regelingstype: s("regelingstype"),
    doelgroep: s("doelgroep"),
    thema: s("thema"),
    statusinterpretatie: s("statusinterpretatie"),
  };
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
type LogRij = {
  veld_naam: string;
  oude_waarde: string | null;
  nieuwe_waarde: string | null;
  wijzig_type: "metadata" | "status" | "bronstatus" | "koppeling";
  rag_impact: boolean;
};

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
  if (!pad || !pad.startsWith(`${GENERIEK_PAD_PREFIX}/`)) {
    return { ok: false, foutcode: "bestand_ontbreekt", melding: "Geen geüpload bestand gevonden. Upload het bestand opnieuw." };
  }

  try {
    const { data: blob, error: dlErr } = await svc.storage.from(QUARANTAINE_BUCKET).download(pad);
    if (dlErr || !blob) {
      return { ok: false, foutcode: "download_mislukt", melding: "Het geüploade bestand kon niet worden opgehaald. Upload het opnieuw." };
    }
    const buffer = Buffer.from(await blob.arrayBuffer());

    return await maakUitBuffer(svc, identiteit, correlatieId, fd, versieVan, {
      buffer,
      naam: bestandsnaam,
      mimeType,
    });
  } finally {
    // Cleanup: de quarantaine-kopie is na promotie naar 'documenten' overbodig.
    // Best-effort — een opruimfout mag het resultaat niet beïnvloeden.
    const { error: rmErr } = await svc.storage.from(QUARANTAINE_BUCKET).remove([pad]);
    if (rmErr) console.error("[P1] quarantaine-opruimen mislukt:", rmErr.message);
  }
}

async function maakUitBuffer(
  svc: SupabaseClient,
  identiteit: PlatformIdentiteit,
  correlatieId: string,
  fd: FormData,
  versieVan: string | null | undefined,
  bron: { buffer: Buffer; naam: string; mimeType: string }
): Promise<MaakResultaat> {
  const buffer = bron.buffer;

  // 1) Uploadsecurity (fail-closed: magic-bytes + OOXML-subtype + grootte).
  const val = await valideerUpload({ naam: bron.naam, mimeType: bron.mimeType, buffer });
  if (!val.ok) {
    return { ok: false, foutcode: val.foutcode, melding: val.melding };
  }

  // 2) Metadata + bronhygiene.
  const curatie = valideerCuratie(leesInvoer(fd));
  if (!curatie.ok) {
    return {
      ok: false,
      foutcode: "validatie",
      melding: "Controleer de gemarkeerde velden.",
      veldfouten: curatie.fouten,
    };
  }
  const meta: CuratieGenormaliseerd = curatie.waarde;

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
      scan_resultaat: { scan: "uitgesteld_wp3" },
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

  const pipe = await verwerkGeneriekBestand(svc, {
    documentId: doc.id,
    versieId: versieVan ?? null,
    titel: meta.titel,
    buffer,
    bestandstype: val.bestandstype,
    correlatieId,
  });

  if (!pipe.ok) {
    return {
      ok: false,
      foutcode: pipe.foutcode,
      melding:
        pipe.foutcode === "geen_tekst"
          ? "Geen tekst gevonden — is dit een gescand bestand zonder tekstlaag?"
          : "Verwerking mislukt; het document is niet beschikbaar gemaakt.",
    };
  }

  await logMetadata(svc, doc.id, meta.titel, identiteit, null, [
    {
      veld_naam: "document",
      oude_waarde: null,
      nieuwe_waarde: meta.titel,
      wijzig_type: "metadata",
      rag_impact: true,
    },
  ]);

  return { ok: true, documentId: doc.id, chunks: pipe.chunks, paginas: pipe.paginas };
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
            bericht: `Generiek document gecureerd: ${r.chunks} fragmenten beschikbaar.`,
          },
          effect: { document_id: r.documentId, chunks: r.chunks, paginas: r.paginas, verwerkingsstatus: "beschikbaar" },
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
    return await withPlatform<CuratieResultaat>(
      {
        capability: CAP,
        handeling: "platform.generic.document.update",
        doelObject: `documenten:${documentId}`,
      },
      async (svc, { identiteit, correlatieId }) => {
        void correlatieId;
        const { data: huidig } = await svc
          .from("documenten")
          .select(
            "id, titel, bron, bronorganisatie, extern_url, normgewicht, documentdatum, geldig_vanaf, geldig_tot, status, bronstatus, toepassingsgebied, regelingstype, doelgroep, thema, statusinterpretatie, bibliotheek"
          )
          .eq("id", documentId)
          .maybeSingle();

        if (!huidig || huidig.bibliotheek !== "generiek") {
          return {
            resultaat: { ok: false, foutcode: "niet_gevonden", melding: "Generiek document niet gevonden." },
            effect: { afgewezen: "niet_gevonden" },
          };
        }

        const curatie = valideerCuratie(leesInvoer(fd));
        if (!curatie.ok) {
          return {
            resultaat: { ok: false, foutcode: "validatie", melding: "Controleer de gemarkeerde velden.", veldfouten: curatie.fouten },
            effect: { afgewezen: "validatie" },
          };
        }
        const meta = curatie.waarde;

        // Diff t.o.v. de huidige waarden (alleen de bewerkbare §8.1-velden).
        const velden: (keyof CuratieGenormaliseerd & string)[] = [
          "titel", "bron", "bronorganisatie", "extern_url", "normgewicht",
          "documentdatum", "geldig_vanaf", "geldig_tot", "status", "bronstatus",
          "toepassingsgebied", "regelingstype", "doelgroep", "thema", "statusinterpretatie",
        ];
        const update: Record<string, unknown> = {};
        const logRijen: LogRij[] = [];
        for (const veld of velden) {
          const oud = (huidig as Record<string, unknown>)[veld] ?? null;
          const nieuw = (meta as unknown as Record<string, unknown>)[veld] ?? null;
          if ((oud ?? null) !== (nieuw ?? null)) {
            update[veld] = nieuw;
            logRijen.push({
              veld_naam: veld,
              oude_waarde: oud === null ? null : String(oud),
              nieuwe_waarde: nieuw === null ? null : String(nieuw),
              wijzig_type: veld === "status" ? "status" : veld === "bronstatus" ? "bronstatus" : "metadata",
              rag_impact: RAG_VELDEN.has(veld),
            });
          }
        }

        if (Object.keys(update).length === 0) {
          return {
            resultaat: { ok: true, documentId, bericht: "Geen wijzigingen." },
            effect: { document_id: documentId, gewijzigde_velden: 0 },
          };
        }

        const { error: updErr } = await svc.from("documenten").update(update).eq("id", documentId);
        if (updErr) {
          // bv. een statusovergang die de DB-trigger weigert.
          return {
            resultaat: { ok: false, foutcode: "update_mislukt", melding: "Bijwerken geweigerd door de database (mogelijk een ongeldige statusovergang)." },
            effect: { afgewezen: "update_mislukt" },
          };
        }

        const reden = (fd.get("reden") as string)?.trim() || null;
        await logMetadata(svc, documentId, meta.titel, identiteit, reden, logRijen);
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

// ── 3. INTREKKEN / LATEN VERVALLEN ──────────────────────────────────────────
export async function curatieIntrekken(documentId: string, reden: string): Promise<CuratieResultaat> {
  try {
    return await withPlatform<CuratieResultaat>(
      {
        capability: CAP,
        handeling: "platform.generic.document.withdraw",
        doelObject: `documenten:${documentId}`,
        reden: reden?.trim() || null,
      },
      async (svc, { identiteit }) => {
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
        if (huidig.status === "alleen_historisch") {
          return {
            resultaat: { ok: true, documentId, bericht: "Document was al ingetrokken." },
            effect: { document_id: documentId, reeds: true },
          };
        }

        const vandaag = new Date().toISOString().slice(0, 10);
        const nieuwGeldigTot = huidig.geldig_tot ?? vandaag;
        const { error: updErr } = await svc
          .from("documenten")
          .update({ status: "alleen_historisch", bronstatus: "historisch", geldig_tot: nieuwGeldigTot })
          .eq("id", documentId);
        if (updErr) {
          return {
            resultaat: { ok: false, foutcode: "intrekken_mislukt", melding: "Intrekken geweigerd door de database." },
            effect: { afgewezen: "intrekken_mislukt" },
          };
        }

        await logMetadata(svc, documentId, huidig.titel, identiteit, reden?.trim() || null, [
          { veld_naam: "status", oude_waarde: huidig.status, nieuwe_waarde: "alleen_historisch", wijzig_type: "status", rag_impact: true },
          { veld_naam: "bronstatus", oude_waarde: huidig.bronstatus, nieuwe_waarde: "historisch", wijzig_type: "bronstatus", rag_impact: true },
          { veld_naam: "geldig_tot", oude_waarde: huidig.geldig_tot, nieuwe_waarde: nieuwGeldigTot, wijzig_type: "metadata", rag_impact: true },
        ]);
        revalidatePath(LIJST_PAD);

        return {
          resultaat: { ok: true, documentId, bericht: "Document ingetrokken (alleen historisch)." },
          effect: { document_id: documentId, status: "alleen_historisch" },
        };
      }
    );
  } catch (e) {
    return naarFout(e, "intrekken");
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
            status: "alleen_historisch",
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
          { veld_naam: "status", oude_waarde: oud.status, nieuwe_waarde: "alleen_historisch", wijzig_type: "status", rag_impact: true },
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

// ── 8. HER-INDEXEREN GENERIEKE BIBLIOTHEEK (R1.1 + R1.2, service-role) ───────
// Tegenhanger van /api/documents/reindex-backfill voor de generieke bibliotheek.
// Tenants zijn op generieke chunks read-only (RLS), dus deze re-index loopt via
// de platform-back-office met de service-role-client. Verwerkt ÉÉN generiek
// document per aanroep (her-extractie + prefix/embedding); de UI roept
// herhaaldelijk aan tot `klaar`. `tekst` blijft onaangeraakt (omkeerbaar).
export type HerindexGeneriekResultaat =
  | {
      ok: true;
      document_id: string | null;
      titel: string | null;
      status: "verwerkt" | "overgeslagen" | "mislukt" | "klaar";
      aantal_chunks: number;
      resterend: number;
      klaar: boolean;
    }
  | { ok: false; foutcode: string; melding: string };

export async function curatieHerindexeren(): Promise<HerindexGeneriekResultaat> {
  try {
    return await withPlatform<HerindexGeneriekResultaat>(
      {
        capability: CAP,
        handeling: "platform.generic.library.reindex",
        doelObject: "documenten:generiek",
      },
      async (svc, { identiteit }) => {
        const tellResterend = async (): Promise<number> => {
          const { count } = await svc
            .from("document_chunks")
            .select("id", { count: "exact", head: true })
            .eq("bibliotheek", "generiek")
            .is("indexering_versie", null);
          return count ?? 0;
        };

        // Eén nog-baseline generiek document zoeken (via een baseline-chunk).
        const { data: chunkRij } = await svc
          .from("document_chunks")
          .select("document_id")
          .eq("bibliotheek", "generiek")
          .is("indexering_versie", null)
          .limit(1)
          .maybeSingle();

        if (!chunkRij) {
          return {
            resultaat: {
              ok: true,
              document_id: null,
              titel: null,
              status: "klaar",
              aantal_chunks: 0,
              resterend: 0,
              klaar: true,
            },
            effect: { klaar: true, resterend: 0 },
          };
        }

        const { data: doc } = await svc
          .from("documenten")
          .select("id, titel, opslag_pad, bestandstype, bibliotheek")
          .eq("id", chunkRij.document_id)
          .maybeSingle();

        if (!doc || doc.bibliotheek !== "generiek") {
          return {
            resultaat: { ok: false, foutcode: "niet_gevonden", melding: "Generiek document niet gevonden." },
            effect: { afgewezen: "niet_gevonden" },
          };
        }

        const res = await herindexeerDocument(svc, doc);

        // Per-run provenance: generiek → fonds_id NULL, gestart_door = platform-id.
        const { error: runErr } = await svc.from("reindex_runs").insert({
          fonds_id: null,
          bibliotheek: "generiek",
          prefix_model: PREFIX_MODEL,
          prompt_versie: PREFIX_PROMPT_VERSIE,
          indexering_versie: INDEXERING_VERSIE,
          aantal_documenten: res.status === "verwerkt" ? 1 : 0,
          aantal_chunks: res.aantalChunks,
          gestart_door: identiteit.id,
        });
        if (runErr) console.error("[P1] reindex_runs (generiek) niet geschreven:", runErr.message);

        const resterend = await tellResterend();
        if (res.status === "verwerkt") revalidatePath(LIJST_PAD);

        return {
          resultaat: {
            ok: true,
            document_id: doc.id,
            titel: doc.titel,
            status: res.status,
            aantal_chunks: res.aantalChunks,
            resterend,
            klaar: resterend === 0,
          },
          effect: {
            document_id: doc.id,
            status: res.status,
            reden: res.reden ?? null,
            aantal_chunks: res.aantalChunks,
            resterend,
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
