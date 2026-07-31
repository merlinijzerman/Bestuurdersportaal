import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { beoordeelRouteHostToegang } from "@/core/lib/tenant-route-guard";
import {
  CONTENT_TYPE_PER_BESTANDSTYPE,
  type Bestandstype,
} from "@/core/lib/document-extractie";

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

  // T1.3 — resolveer de sessie-fonds server-side en dwing host↔fonds af vóór de
  // document-lookup/download (defense-in-depth náást RLS). `profiel` wordt hier
  // ook hergebruikt voor de inzage-logging. Gedrag-neutraal zolang enforce uit.
  const { data: profiel } = await supabase
    .from("profielen")
    .select("naam, fonds_id")
    .eq("id", user.id)
    .single();
  const hostOordeel = await beoordeelRouteHostToegang({
    sessieFondsId: profiel?.fonds_id ?? null,
    gebruikerId: user.id,
    label: "documents.bestand.GET",
  });
  if (!hostOordeel.toegestaan) {
    return NextResponse.json(
      { error: "Dit webadres hoort niet bij uw fonds." },
      { status: 403 }
    );
  }

  const { data: document, error: docError } = await supabase
    .from("documenten")
    .select("id, titel, fonds_id, opslag_pad, bestandsnaam, bestandstype, actief")
    .eq("id", id)
    .single();

  if (docError || !document) {
    return NextResponse.json({ error: "Document niet gevonden" }, { status: 404 });
  }

  // H-08 (review 2026-07-30) — een gedeactiveerd document mag NIET meer
  // downloadbaar zijn. `actief` werd hier wél opgehaald maar nooit getoetst,
  // waardoor deactivatie (PATCH /api/documents/[id], mét reden en actor) een
  // schijnmaatregel was: wie de document-ID nog had uit een bronvermelding,
  // deeplink of browserhistorie haalde het origineel gewoon op — en de inzage
  // werd zelfs als geldige 'inzage' gelogd.
  //
  // De AI-laag en alle retrievalpaden filteren al op `actief = true`
  // (core/lib/document-scope.ts, zoek_chunks(_hybride)); dit trekt de
  // downloadroute daarmee gelijk. 410 (Gone) i.p.v. 404: het document bestaat,
  // maar is bewust ingetrokken — dat onderscheid is voor de gebruiker relevant.
  if (document.actief === false) {
    return NextResponse.json(
      {
        error:
          "Dit document is ingetrokken en is niet meer in te zien. Neem contact op met de beheerder als u het origineel nodig heeft.",
      },
      { status: 410 }
    );
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

  // Inzage loggen — non-blocking, maar de fout wordt WEL gelogd. Voorheen werd
  // de retourwaarde genegeerd terwijl het commentaar "fouten worden geprint"
  // beloofde: het inzagelogboek — de enige registratie van wie welk document
  // inzag — kon dus gaten hebben zonder enig signaal. `profiel` is hierboven al
  // opgehaald (naam + fonds_id) voor de host-afdwinging.
  const { error: inzageError } = await supabase.from("document_inzage").insert({
    document_id: document.id,
    document_titel_snapshot: document.titel,
    fonds_id: document.fonds_id,
    gebruiker_id: user.id,
    gebruiker_naam: profiel?.naam ?? null,
    actie: "inzage",
  });
  if (inzageError) {
    console.error(
      `[documents.bestand.GET] inzage-log mislukt voor document ${document.id}:`,
      inzageError
    );
  }

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
