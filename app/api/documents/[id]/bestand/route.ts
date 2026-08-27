import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { beoordeelNavigatieHerkomst, crossSiteGeweigerd } from "@/core/lib/navigatie-herkomst";
import {
  bepaalBestandsnaam,
  bepaalContentType,
  normaliseerBestandstype,
} from "@/core/lib/document-download-headers";
import { heeftSchoonScanbewijs } from "@/core/lib/document-scan-poort";

// GET /api/documents/[id]/bestand
// Levert het originele bestand uitsluitend als download.
// RLS op documenten zorgt al voor toegangscontrole; we voegen alleen het
// inzage-logregeltje toe.
// T1.3 — host↔fonds-afdwinging vóór de document-lookup/download
// (defense-in-depth náást RLS) zit sinds W5 in de wrapper: `hostGuard: true`.
// GEMETEN: de inline guard stond al direct ná het profiel en vóór élke andere
// poort, dus de volgorde blijft dezelfde. De naam die het profiel hier ook
// leverde voor de inzage-logging komt nu uit `ctx.naam`.
//
// LET OP: deze route heeft GEEN eigen try/catch. Een onafgevangen fout kwam vóór
// W5 bij Next terecht en wordt nu 500 {"error":"Serverfout"} uit het vangnet van
// de wrapper. Uniformering, maar wel een verschil — zie het BESLUIT in #101.
export const GET = withFondsRoute({ hostGuard: "afdwingen", rateLimit: "nog-niet-beoordeeld", audit: "geen", capability: "documents.view", label: "documents.bestand.GET", schema: "geen-body" }, async (ctx, req: NextRequest, params) => {
  // H-04: een top-level navigatie vanaf een vreemde site stuurt onder een
  // Lax-cookie de sessie mee. Deze route schrijft een auditrecord, dus zo'n
  // aanroep zou een gebeurtenis in het dossier van het slachtoffer zetten.
  // Weigeren vóór er werk gebeurt; de uitkomst gaat mee in het record.
  const oordeel = beoordeelNavigatieHerkomst(req);
  if (!oordeel.toegestaan) return crossSiteGeweigerd("documents.bestand.GET");

  const { id } = params as { id: string };
  const supabase = ctx.supabase;

  const { data: document, error: docError } = await supabase
    .from("documenten")
    .select("id, titel, fonds_id, opslag_pad, bestandsnaam, bestandstype, actief, verwerkingsstatus, bestand_hash, scan_resultaat")
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

  // WP3 wordt per omgeving geactiveerd. Zodra de schakelaar aan staat is alleen
  // een volledig verwerkt document met een positief, hash-gebonden verdict
  // downloadbaar. Null/onbekend/scannerfout is dus nooit impliciet schoon.
  if (
    process.env.WP3_MALWARESCAN_AAN === "true" &&
    (document.verwerkingsstatus !== "beschikbaar" || !heeftSchoonScanbewijs(document))
  ) {
    return NextResponse.json(
      { error: "Dit document is nog niet veilig beschikbaar." },
      { status: 403 }
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
  // inzag — kon dus gaten hebben zonder enig signaal. Naam en fonds komen sinds
  // W5 uit `ctx`; de wrapper haalt hetzelfde profiel op.
  const { error: inzageError } = await supabase.from("document_inzage").insert({
    document_id: document.id,
    document_titel_snapshot: document.titel,
    fonds_id: document.fonds_id,
    gebruiker_id: ctx.gebruikerId,
    gebruiker_naam: ctx.naam ?? null,
    actie: "inzage",
    herkomst: oordeel.herkomst,
  });
  if (inzageError) {
    console.error(
      `[documents.bestand.GET] inzage-log mislukt voor document ${document.id}:`,
      inzageError
    );
  }

  // Bepaal content-type op basis van bestandstype — fail-closed (WP4, 17-08-2026).
  //
  // De vorige regel was `(document.bestandstype as Bestandstype) || "pdf"`, met
  // twee scherpe randen. (a) Een LEEG of null type werd stilzwijgend
  // `application/pdf`: de browser kreeg te horen dat willekeurige bytes een PDF
  // zijn, op onze eigen origin. (b) Een ongeldig maar niet-leeg type (drift in
  // de kolom, een handmatige insert) viel buiten de lookup en leverde
  // `contentType === undefined` — dan gaat er een respons uit met de letterlijke
  // header `Content-Type: undefined`, en bepaalt de client zelf maar wat het is.
  //
  // Nu: alleen een waarde die écht in de enum zit krijgt zijn eigen content-type;
  // al het andere wordt `application/octet-stream`. Dat is het type dat niets
  // belooft — de browser rendert het niet, hij bewaart het. Samen met de
  // onvoorwaardelijke `attachment` hieronder en `nosniff` is er dan geen pad meer
  // waarin onbekende bytes als een renderbaar formaat op onze origin landen.
  const ruwType = document.bestandstype;
  const bestandstype = normaliseerBestandstype(ruwType);
  const contentType = bepaalContentType(ruwType);
  if (!bestandstype) {
    // Geen blokkade — het origineel blijft ophaalbaar — maar wel een spoor: een
    // document zonder geldig bestandstype is een datakwaliteitsprobleem dat
    // anders onzichtbaar blijft omdat de download gewoon werkt.
    console.warn(
      `[documents.bestand.GET] document ${document.id} heeft geen geldig bestandstype (${JSON.stringify(ruwType)}); geserveerd als application/octet-stream`
    );
  }
  const filename = bepaalBestandsnaam(document.bestandsnaam, document.titel, ruwType);

  const arrayBuffer = await bestand.arrayBuffer();

  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
});
