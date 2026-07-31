// ============================================================
//  POST /api/documents/bulk-metadata — Increment C
//
//  Bulk-metadata op meerdere documenten tegelijk (context, procesinstantie,
//  status, bronstatus, documenttype, datum/geldigheid). Dezelfde server-side
//  validatie + capability-gating als de enkele PATCH; per (document, veld)
//  één append-only auditrecord (acceptatiecriterium: 20 documenten = 20
//  auditrecords bij één veldwijziging).
//
//  Body: { document_ids: string[], wijziging: {...velden..., reden?} }
//  Alle documenten worden VOORAF gevalideerd; bij een blokker/fout op één
//  document faalt de hele batch niet — er wordt per document gerapporteerd.
//
//  Tenant-isolatie via RLS (anon-key + fonds_id). Geen service-role.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { controleerLimiet, LIMIETEN } from "@/core/lib/rate-limit";
import { rateLimited } from "@/core/lib/api-errors";
import { rolHeeftCapability } from "@/core/lib/capabilities";
import {
  bouwMetadataPlan,
  type HuidigDocument,
  type MetadataVerzoek,
  type GebruikerCapabilities,
} from "@/core/lib/document-metadata-service";

export const dynamic = "force-dynamic";

const SELECT =
  "id, titel, fonds_id, context, procesinstantie_id, vergadering_id, agendapunt_id, documenttype, status, bronstatus, documentdatum, geldig_vanaf, geldig_tot, vervangt_document_id, vervangen_door_document_id, bronorganisatie, extern_url, normgewicht";

interface DocResultaat {
  document_id: string;
  ok: boolean;
  aantal_wijzigingen: number;
  rag_impact: boolean;
  blokkers?: string[];
  fouten?: string[];
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

    // M-06 (review 2026-07-30): deze route doet per aanroep externe
    // modelcalls en had geen enkele limiet — onbeperkt herhaalbaar door een
    // geauthenticeerde gebruiker (kosten-DoS).
    const limiet = await controleerLimiet(supabase, LIMIETEN.bulk_metadata);
    if (!limiet.toegestaan) return rateLimited("documents.bulk-metadata", limiet.resetAt);

    const body = (await req.json().catch(() => ({}))) as {
      document_ids?: string[];
      wijziging?: MetadataVerzoek;
      preview?: boolean;
    };
    const ids = Array.isArray(body.document_ids) ? body.document_ids : [];
    const wijziging = body.wijziging ?? {};
    if (ids.length === 0) {
      return NextResponse.json({ error: "Geen document_ids meegegeven" }, { status: 400 });
    }
    if (ids.length > 200) {
      return NextResponse.json({ error: "Maximaal 200 documenten per batch" }, { status: 400 });
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("rol, naam")
      .eq("id", user.id)
      .maybeSingle();
    const rol = profiel?.rol ?? null;
    const caps: GebruikerCapabilities = {
      metadataUpdate: rolHeeftCapability(rol, "documents.metadata.update"),
      statusChange: rolHeeftCapability(rol, "documents.status.change"),
      bronstatusChange: rolHeeftCapability(rol, "documents.bronstatus.change"),
    };

    // RLS dwingt af dat alleen documenten van het eigen fonds (of generiek)
    // teruggelezen worden; documenten buiten bereik vallen vanzelf weg.
    const { data: documenten, error: leesFout } = await supabase
      .from("documenten")
      .select(SELECT)
      .in("id", ids);
    if (leesFout) {
      return NextResponse.json({ error: "Ophalen mislukt" }, { status: 500 });
    }

    const reden = wijziging.reden?.trim() || null;
    const resultaten: DocResultaat[] = [];
    const teLoggen: Record<string, unknown>[] = [];

    for (const document of documenten ?? []) {
      const huidig: HuidigDocument = {
        status: document.status,
        bronstatus: document.bronstatus,
        context: document.context,
        procesinstantie_id: document.procesinstantie_id,
        vergadering_id: document.vergadering_id,
        agendapunt_id: document.agendapunt_id,
        documenttype: document.documenttype,
        documentdatum: document.documentdatum,
        geldig_vanaf: document.geldig_vanaf,
        geldig_tot: document.geldig_tot,
        vervangt_document_id: document.vervangt_document_id,
        vervangen_door_document_id: document.vervangen_door_document_id,
        bronorganisatie: document.bronorganisatie,
        extern_url: document.extern_url,
        normgewicht: document.normgewicht,
      };
      const plan = bouwMetadataPlan(huidig, wijziging, caps);

      if (!plan.ok) {
        resultaten.push({
          document_id: document.id,
          ok: false,
          aantal_wijzigingen: 0,
          rag_impact: false,
          blokkers: plan.blokkers.length ? plan.blokkers : undefined,
          fouten: plan.fouten.length ? plan.fouten : undefined,
        });
        continue;
      }

      if (body.preview) {
        resultaten.push({
          document_id: document.id,
          ok: true,
          aantal_wijzigingen: plan.wijzigingen.length,
          rag_impact: plan.ragImpact,
        });
        continue;
      }

      const update: Record<string, unknown> = {};
      for (const w of plan.wijzigingen) {
        update[w.veld] = (wijziging as Record<string, unknown>)[w.veld] ?? null;
      }
      if (Object.keys(update).length > 0) {
        const { error: updFout } = await supabase
          .from("documenten")
          .update(update)
          .eq("id", document.id);
        if (updFout) {
          console.error("Bulk metadata-update fout:", document.id, updFout);
          resultaten.push({
            document_id: document.id,
            ok: false,
            aantal_wijzigingen: 0,
            rag_impact: false,
            fouten: ["Bijwerken mislukt"],
          });
          continue;
        }
      }

      for (const w of plan.wijzigingen) {
        teLoggen.push({
          document_id: document.id,
          document_titel_snapshot: document.titel,
          fonds_id: document.fonds_id,
          gewijzigd_door: user.id,
          gewijzigd_door_naam: profiel?.naam ?? null,
          veld_naam: w.veld,
          oude_waarde: w.oude_waarde,
          nieuwe_waarde: w.nieuwe_waarde,
          wijzig_reden: reden,
          wijzig_type: w.wijzig_type,
          rag_impact: w.rag_impact,
        });
      }

      resultaten.push({
        document_id: document.id,
        ok: true,
        aantal_wijzigingen: plan.wijzigingen.length,
        rag_impact: plan.ragImpact,
      });
    }

    if (!body.preview && teLoggen.length > 0) {
      const { error: logFout } = await supabase
        .from("document_metadata_log")
        .insert(teLoggen);
      if (logFout) {
        console.error("Bulk metadata-log fout:", logFout);
        return NextResponse.json(
          { error: "Wijzigingen toegepast maar auditlog faalde" },
          { status: 500 }
        );
      }
    }

    const gevonden = new Set((documenten ?? []).map((d) => d.id));
    const nietGevonden = ids.filter((i) => !gevonden.has(i));

    return NextResponse.json({
      preview: !!body.preview,
      aantal_documenten: resultaten.length,
      aantal_auditrecords: teLoggen.length,
      niet_gevonden: nietGevonden,
      resultaten,
    });
  } catch (e) {
    console.error("Fout in POST /api/documents/bulk-metadata:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
