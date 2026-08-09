// GET /api/procedures/[id]/afschriften/[afschriftId]/download
// -----------------------------------------------------------------------------
// T6 — Download een afschrift via een kortlevende signed URL (redirect). Runt
// onder de user-RLS-client: de signed URL wordt gemint met de sessie, zodat de
// storage-leespolicy (eigen fonds + niet-bureau) geldt. Zonder deze regel zou
// een bureaulid de zip (met stemgedrag) alsnog kunnen ophalen (ontwerpbeslissing 4).
// Elke download wordt vastgelegd in procedure_log.
// -----------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { beoordeelRouteHostToegang } from "@/core/lib/tenant-route-guard";
import { isBureauRol } from "@/core/lib/bureau-gate";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 60;
const AFSCHRIFT_BUREAU_WEIGERING =
  "Het afschrift bevat het auditdossier met stemgedrag per bestuurslid en is daarom niet beschikbaar voor het bestuursbureau.";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; afschriftId: string }> }
) {
  try {
    const { id: procedureId, afschriftId } = await params;
    const supabase = await createServerSupabase();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam, fonds_id, rol")
      .eq("id", user.id)
      .maybeSingle();

    const hostOordeel = await beoordeelRouteHostToegang({
      sessieFondsId: profiel?.fonds_id ?? null,
      gebruikerId: user.id,
      label: "procedures.afschrift.download.GET",
    });
    if (!hostOordeel.toegestaan) {
      return NextResponse.json({ error: "Dit webadres hoort niet bij uw fonds." }, { status: 403 });
    }
    if (isBureauRol(profiel?.rol)) {
      return NextResponse.json({ error: AFSCHRIFT_BUREAU_WEIGERING }, { status: 403 });
    }

    // RLS: het afschrift moet bij de procedure en het fonds van de gebruiker horen.
    const { data: afschrift } = await supabase
      .from("procedure_afschriften")
      .select("id, procedure_id, status, opslag_pad, ingetrokken_op")
      .eq("id", afschriftId)
      .eq("procedure_id", procedureId)
      .maybeSingle();
    if (!afschrift) {
      return NextResponse.json({ error: "Afschrift niet gevonden of geen toegang" }, { status: 404 });
    }
    if (afschrift.ingetrokken_op) {
      return NextResponse.json({ error: "Dit afschrift is ingetrokken." }, { status: 410 });
    }
    if (afschrift.status !== "gereed" || !afschrift.opslag_pad) {
      return NextResponse.json(
        { error: afschrift.status === "bezig" ? "Het afschrift wordt nog gegenereerd." : "Het afschrift is niet beschikbaar." },
        { status: 409 }
      );
    }

    const { data: signed, error: signErr } = await supabase.storage
      .from("afschriften")
      .createSignedUrl(afschrift.opslag_pad as string, SIGNED_URL_TTL_SECONDS, { download: true });
    if (signErr || !signed?.signedUrl) {
      console.error("Signed URL mislukt:", signErr);
      return NextResponse.json({ error: "Kon de download niet voorbereiden." }, { status: 500 });
    }

    // Auditspoor: gedownload (best effort — blokkeert de download niet).
    await supabase.from("procedure_log").insert({
      procedure_id: procedureId,
      event_type: "afschrift_gedownload",
      actor_id: user.id,
      actor_naam: profiel?.naam ?? null,
      payload: { afschrift_id: afschriftId },
    });

    return NextResponse.redirect(signed.signedUrl, { status: 307 });
  } catch (e) {
    console.error("Fout in GET afschrift download:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
