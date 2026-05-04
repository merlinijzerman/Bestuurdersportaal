import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import {
  CONTENT_TYPE_PER_BESTANDSTYPE,
  type Bestandstype,
} from "@/lib/document-extractie";

// GET /api/documents/[id]/bestand
// Streamt het originele bestand inline (PDF) of als download (Word/Excel).
// RLS op documenten zorgt al voor toegangscontrole; we voegen alleen het
// inzage-logregeltje toe.
export async function GET(
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

  const { data: document, error: docError } = await supabase
    .from("documenten")
    .select("id, titel, fonds_id, opslag_pad, bestandsnaam, bestandstype, actief")
    .eq("id", id)
    .single();

  if (docError || !document) {
    return NextResponse.json({ error: "Document niet gevonden" }, { status: 404 });
  }

  if (!document.opslag_pad) {
    return NextResponse.json(
      {
        error:
          "Dit document is geüpload vóór de inzage-functionaliteit beschikbaar was. Het origineel is niet meer beschikbaar — alleen de tekst voor de AI-assistent.",
      },
      { status: 410 }
    );
  }

  // Origineel ophalen uit Supabase Storage. RLS-policy dekt de toegang;
  // als de gebruiker geen recht heeft komt hier een fout terug.
  const { data: bestand, error: storageError } = await supabase.storage
    .from("documenten")
    .download(document.opslag_pad);

  if (storageError || !bestand) {
    console.error("Fout bij ophalen bestand:", storageError);
    return NextResponse.json(
      { error: "Kon het bestand niet ophalen." },
      { status: 500 }
    );
  }

  // Inzage loggen — non-blocking, fouten worden alleen geprint.
  const { data: profiel } = await supabase
    .from("profielen")
    .select("naam")
    .eq("id", user.id)
    .single();

  await supabase.from("document_inzage").insert({
    document_id: document.id,
    document_titel_snapshot: document.titel,
    fonds_id: document.fonds_id,
    gebruiker_id: user.id,
    gebruiker_naam: profiel?.naam ?? null,
    actie: "inzage",
  });

  // Bepaal content-type en disposition op basis van bestandstype.
  // Bij ontbrekend type (oude records) vallen we terug op PDF voor backwards
  // compatibility met al opgeslagen bestanden.
  const bestandstype = (document.bestandstype as Bestandstype) || "pdf";
  const contentType = CONTENT_TYPE_PER_BESTANDSTYPE[bestandstype];
  // PDF kan inline in de browser worden getoond; Word/Excel forceren we als download
  // omdat browsers die toch niet kunnen renderen.
  const disposition = bestandstype === "pdf" ? "inline" : "attachment";
  const filename =
    document.bestandsnaam || `${document.titel}.${bestandstype}`;

  const arrayBuffer = await bestand.arrayBuffer();

  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${disposition}; filename="${encodeURIComponent(filename)}"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}
