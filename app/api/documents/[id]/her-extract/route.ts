import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { controleerLimiet, LIMIETEN } from "@/core/lib/rate-limit";
import { rateLimited } from "@/core/lib/api-errors";
import { ONDERSTEUNDE_TYPES, type Bestandstype } from "@/core/lib/document-extractie";

// POST /api/documents/[id]/her-extract
//
// ── ASYNC her-extract (item 2, na F7) ──────────────────────────────────────
// Vroeger draaide deze route per aanroep de duurste keten die het portaal kent
// (storage-download → volledige OCR → per chunk een context-prefix → embeddings),
// synchroon begrensd door maxDuration=300 én een OCR-cap van 40 pagina's. Sinds
// de async ingest-worker (F4/F6) bestaat, is dat overbodig: we zetten het
// document simpelweg terug de pipeline in en de worker her-extraheert het —
// met OCR tot MAX_OCR_PAGINAS (200) en zonder requesttimeout. De worker vervangt
// de chunks idempotent (delete-then-insert in extracteerEnChunk), dus de oude
// index blijft doorzoekbaar tot de nieuwe klaarstaat.
//
// verwerkingsstatus='ontvangen' = het reaper-signaal om vanaf de extractiefase
// opnieuw te verwerken; geindexeerd=false tot de worker de invariant haalt (nul
// chunks met embedding is null). De bibliotheek toont "Verwerken…" en pollt (F5).
//
// Rechten: alleen voorzitter/beheerder, server-side afgedwongen. Tenant-isolatie
// via RLS (anon-key): de document-policies filteren per fonds; een tenant kan
// generieke documenten niet muteren (read-only) — dat pad loopt via de platform-
// curatie. De autorisatie- en validatiepoorten zijn bewust identiek gebleven aan
// de vorige (synchrone) versie; alleen het zware werk is naar de worker verhuisd.
export const POST = withFondsRoute({ hostGuard: "geen", rateLimit: "route-eigen", audit: { handeling: "documents.her-extraheren" }, capability: "documents.lifecycle.manage", schema: "geen-body" }, async (ctx, _req: NextRequest, params) => {
  const { id } = params as { id: string };
    const supabase = ctx.supabase;

  // M-06: her-indexeren laat de worker externe modelcalls doen; fail-closed
  // rate-limit (dezelfde pot als opnieuw-verwerken).
  const limiet = await controleerLimiet(supabase, LIMIETEN.her_extract, {
    failClosed: true,
  });
  if (!limiet.toegestaan) return rateLimited("documents.her-extract", limiet.resetAt);

  const isVoorzitterOfBeheerder =
    ctx.rol === "voorzitter" || ctx.rol === "beheerder";
  if (!isVoorzitterOfBeheerder) {
    return NextResponse.json(
      { error: "Alleen voorzitter of beheerder mag een document her-indexeren." },
      { status: 403 }
    );
  }

  const { data: document, error: docError } = await supabase
    .from("documenten")
    .select("id, opslag_pad, bestandstype")
    .eq("id", id)
    .single();

  if (docError || !document) {
    return NextResponse.json({ error: "Document niet gevonden" }, { status: 404 });
  }

  if (!document.opslag_pad) {
    return NextResponse.json(
      {
        error:
          "Het origineel van dit document is niet beschikbaar (geüpload vóór de inzage-functionaliteit). Her-indexeren is alleen mogelijk door opnieuw te uploaden.",
      },
      { status: 410 }
    );
  }

  const bestandstype = (document.bestandstype as Bestandstype) || "pdf";
  if (!ONDERSTEUNDE_TYPES.includes(bestandstype)) {
    return NextResponse.json(
      { error: `Bestandstype '${bestandstype}' wordt niet ondersteund.` },
      { status: 400 }
    );
  }

  // Terug de pipeline in vanaf de extractiefase. De worker-reaper pikt documenten
  // met verwerkingsstatus in de pipeline + geindexeerd=false op en her-extraheert.
  const { error: updateError } = await supabase
    .from("documenten")
    .update({ verwerkingsstatus: "ontvangen", geindexeerd: false })
    .eq("id", id);

  if (updateError) {
    console.error(`[her-extract] status resetten mislukt voor ${id}:`, updateError);
    return NextResponse.json(
      { error: "Kon het document niet opnieuw in de wachtrij zetten." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    status: "verwerken",
    document_id: id,
    bericht:
      "Het document wordt opnieuw geïndexeerd; het is binnen enkele minuten weer doorzoekbaar.",
  });
});
