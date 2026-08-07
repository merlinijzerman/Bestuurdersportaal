import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { controleerLimiet, LIMIETEN } from "@/core/lib/rate-limit";
import { rateLimited } from "@/core/lib/api-errors";

// POST /api/documents/[id]/opnieuw-verwerken
//
// Zet een async-mislukt document terug de verwerkingspipeline in (F5). Anders dan
// her-extract draait dit GEEN synchrone extractie: de kale chunks staan er al
// (F3), alleen de embeddings ontbreken. We zetten verwerkingsstatus terug op
// 'embedding'; de ingest-worker-reaper (F4) enqueued het document en verwerkt het.
//
// Rechten: alleen voorzitter/beheerder, server-side afgedwongen. Tenant-isolatie
// via RLS (anon-key): een gebruiker kan alleen documenten van het eigen fonds
// raken; generieke documenten zijn read-only voor tenants.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  // Fail-closed rate-limit (dezelfde pot als her-extract: het is een
  // herverwerkings-actie die de worker externe modelcalls laat doen).
  const limiet = await controleerLimiet(supabase, LIMIETEN.her_extract, {
    failClosed: true,
  });
  if (!limiet.toegestaan) {
    return rateLimited("documents.opnieuw-verwerken", limiet.resetAt);
  }

  const { data: profiel } = await supabase
    .from("profielen")
    .select("rol")
    .eq("id", user.id)
    .single();
  const isVoorzitterOfBeheerder =
    profiel?.rol === "voorzitter" || profiel?.rol === "beheerder";
  if (!isVoorzitterOfBeheerder) {
    return NextResponse.json(
      { error: "Alleen voorzitter of beheerder mag een document opnieuw verwerken." },
      { status: 403 }
    );
  }

  const { data: document, error: docError } = await supabase
    .from("documenten")
    .select("id, verwerkingsstatus, bibliotheek, actief")
    .eq("id", id)
    .single();
  if (docError || !document) {
    return NextResponse.json({ error: "Document niet gevonden" }, { status: 404 });
  }
  if (document.bibliotheek === "generiek") {
    return NextResponse.json(
      { error: "Generieke documenten worden centraal beheerd en niet vanaf hier verwerkt." },
      { status: 403 }
    );
  }
  if (!document.actief) {
    return NextResponse.json(
      { error: "Een gedeactiveerd document kan niet opnieuw worden verwerkt." },
      { status: 400 }
    );
  }
  if (document.verwerkingsstatus !== "mislukt") {
    return NextResponse.json(
      { error: "Dit document staat niet in een mislukte staat." },
      { status: 400 }
    );
  }

  // Terug de pipeline in: de worker-reaper pikt documenten met
  // verwerkingsstatus='embedding' + geindexeerd=false op. geindexeerd blijft/wordt
  // false tot de worker de invariant haalt (nul chunks met embedding is null).
  const { error: updateError } = await supabase
    .from("documenten")
    .update({ verwerkingsstatus: "embedding", geindexeerd: false })
    .eq("id", id);
  if (updateError) {
    console.error(`[opnieuw-verwerken] status resetten mislukt voor ${id}:`, updateError);
    return NextResponse.json(
      { error: "Kon het document niet opnieuw in de wachtrij zetten." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    status: "verwerken",
    bericht: "Het document is opnieuw in de verwerkingswachtrij gezet.",
  });
}
