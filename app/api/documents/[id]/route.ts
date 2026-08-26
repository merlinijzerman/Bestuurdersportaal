import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { z } from "zod";

// PATCH /api/documents/[id]
// Body: { actie: "deactiveren" | "reactiveren", reden?: string }
//
// Rechten:
// - voorzitter / beheerder: altijd
// - bestuurder: deactiveren alleen als opgeslagen_door = jij én < 24 uur na upload
// - reactiveren: alleen voorzitter / beheerder
export const PATCH = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "documents.id.patch" }, capability: "documents.lifecycle.manage", schema: z.object({ "actie": z.unknown().optional(), "reden": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  const { id } = params as { id: string };
    const supabase = ctx.supabase;

  const body = await req.json().catch(() => ({}));
  const actie = body?.actie as "deactiveren" | "reactiveren" | undefined;
  const reden = (body?.reden as string | undefined)?.trim() || null;

  if (actie !== "deactiveren" && actie !== "reactiveren") {
    return NextResponse.json(
      { error: "Onbekende actie. Verwacht: 'deactiveren' of 'reactiveren'." },
      { status: 400 }
    );
  }

  const { data: document, error: docError } = await supabase
    .from("documenten")
    .select("id, titel, fonds_id, opgeslagen_door, actief, aangemaakt")
    .eq("id", id)
    .single();

  if (docError || !document) {
    return NextResponse.json({ error: "Document niet gevonden" }, { status: 404 });
  }

  const isVoorzitterOfBeheerder =
    ctx.rol === "voorzitter" || ctx.rol === "beheerder";

  if (actie === "reactiveren" && !isVoorzitterOfBeheerder) {
    return NextResponse.json(
      { error: "Alleen voorzitter of beheerder mag reactiveren." },
      { status: 403 }
    );
  }

  if (actie === "deactiveren" && !isVoorzitterOfBeheerder) {
    const isUploader = document.opgeslagen_door === ctx.gebruikerId;
    const uploadDatum = new Date(document.aangemaakt).getTime();
    const minderDan24u = Date.now() - uploadDatum < 24 * 60 * 60 * 1000;
    if (!isUploader || !minderDan24u) {
      return NextResponse.json(
        {
          error:
            "U mag dit document niet deactiveren. Vraag de voorzitter of beheerder, of deactiveer binnen 24 uur na uw eigen upload.",
        },
        { status: 403 }
      );
    }
  }

  if (actie === "deactiveren" && document.actief === false) {
    return NextResponse.json(
      { error: "Document is al gedeactiveerd." },
      { status: 409 }
    );
  }
  if (actie === "reactiveren" && document.actief === true) {
    return NextResponse.json(
      { error: "Document is al actief." },
      { status: 409 }
    );
  }

  const update =
    actie === "deactiveren"
      ? {
          actief: false,
          gedeactiveerd_op: new Date().toISOString(),
          gedeactiveerd_door: ctx.gebruikerId,
          deactivatie_reden: reden,
        }
      : {
          actief: true,
          gedeactiveerd_op: null,
          gedeactiveerd_door: null,
          deactivatie_reden: null,
        };

  const { error: updateError } = await supabase
    .from("documenten")
    .update(update)
    .eq("id", id);

  if (updateError) {
    console.error("Fout bij update:", updateError);
    return NextResponse.json(
      { error: "Kon de status niet bijwerken." },
      { status: 500 }
    );
  }

  await supabase.from("document_inzage").insert({
    document_id: document.id,
    document_titel_snapshot: document.titel,
    fonds_id: document.fonds_id,
    gebruiker_id: ctx.gebruikerId,
    gebruiker_naam: ctx.naam ?? null,
    actie: actie === "deactiveren" ? "gedeactiveerd" : "gereactiveerd",
    reden,
  });

  return NextResponse.json({
    success: true,
    actie,
    document_id: document.id,
  });
});
