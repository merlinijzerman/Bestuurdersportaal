// GET /api/procedures/[id]/afschriften/[afschriftId]/download
// -----------------------------------------------------------------------------
// T6 — Download een afschrift via een kortlevende signed URL (redirect). Runt
// onder de user-RLS-client: de signed URL wordt gemint met de sessie, zodat de
// storage-leespolicy (eigen fonds + niet-bureau) geldt. Zonder deze regel zou
// een bureaulid de zip (met stemgedrag) alsnog kunnen ophalen (ontwerpbeslissing 4).
// Elke download wordt vastgelegd in procedure_log.
// -----------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { beoordeelNavigatieHerkomst, crossSiteGeweigerd } from "@/core/lib/navigatie-herkomst";
import { isBureauRol } from "@/core/lib/bureau-gate";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 60;
const AFSCHRIFT_BUREAU_WEIGERING =
  "Het afschrift bevat het auditdossier met stemgedrag per bestuurslid en is daarom niet beschikbaar voor het bestuursbureau.";

// De host↔fonds-guard zit sinds W5 in de wrapper (`hostGuard: true`). GEMETEN:
// de inline aanroep stond al direct ná het profiel en vóór de bureau-gate, dus
// de volgorde van poorten blijft ongewijzigd. `AFS-3` in
// tests/cross-tenant/afschrift-toegang.test.ts is sinds W4 wrapper-bewust en
// dekt deze route zonder aanpassing.
export const GET = withFondsRoute({ hostGuard: "afdwingen", rateLimit: "nog-niet-beoordeeld", audit: "geen", capability: "procedures.view", label: "procedures.afschrift.download.GET", schema: "geen-body" }, async (ctx, req: NextRequest, params) => {
  // H-04: een top-level navigatie vanaf een vreemde site stuurt onder een
  // Lax-cookie de sessie mee. Deze route schrijft een auditrecord, dus zo'n
  // aanroep zou een gebeurtenis in het dossier van het slachtoffer zetten.
  // Weigeren vóór er werk gebeurt; de uitkomst gaat mee in het record.
  const oordeel = beoordeelNavigatieHerkomst(req);
  if (!oordeel.toegestaan) return crossSiteGeweigerd("procedures.afschrift.download.GET");

  try {
    const { id: procedureId, afschriftId } = params as { id: string; afschriftId: string };
    const supabase = ctx.supabase;

    if (isBureauRol(ctx.rol)) {
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
      .createSignedUrl(afschrift.opslag_pad as string, SIGNED_URL_TTL_SECONDS, {
        download: `afschrift-${afschriftId}.zip`,
      });
    if (signErr || !signed?.signedUrl) {
      console.error("Signed URL mislukt:", signErr);
      return NextResponse.json({ error: "Kon de download niet voorbereiden." }, { status: 500 });
    }

    // Auditspoor: gedownload (best effort — blokkeert de download niet).
    await supabase.from("procedure_log").insert({
      procedure_id: procedureId,
      event_type: "afschrift_gedownload",
      actor_id: ctx.gebruikerId,
      actor_naam: ctx.naam ?? null,
      payload: { afschrift_id: afschriftId, herkomst: oordeel.herkomst },
    });

    return NextResponse.redirect(signed.signedUrl, { status: 307 });
  } catch (e) {
    console.error("Fout in GET afschrift download:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
