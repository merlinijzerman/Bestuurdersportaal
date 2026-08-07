import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
// F6: extractie/OCR/chunking/caps/samenvatting draaien nu in de async worker
// (platform/lib/ingest-orchestrator). Het request valideert + slaat op + registreert.
import { CONTENT_TYPE_PER_BESTANDSTYPE } from "@/core/lib/document-extractie";
import {
  magOvergaan,
  redenVerplicht,
  toegestaneIngestStatussen,
  vereisteCapability,
  type DocumentStatus,
} from "@/core/lib/document-status-transities";
import { requireCapability, type Capability } from "@/core/lib/capabilities";
import {
  valideerUpload,
  logNaam,
  MAX_BESTAND_BYTES,
} from "@/core/lib/bestand-validatie";
import { controleerLimiet, LIMIETEN } from "@/core/lib/rate-limit";
import { badRequest, rateLimited } from "@/core/lib/api-errors";
import { beoordeelRouteHostToegang } from "@/core/lib/tenant-route-guard";

// Strip de bestandsextensie van de naam — werkt voor alle ondersteunde types.
function stripExtensie(naam: string): string {
  return naam.replace(/\.(pdf|docx|xlsx)$/i, "");
}

export async function POST(req: NextRequest) {
  // F0.1 (bouwticket async-ingest v2.1) — nulmeting-instrumentatie. Eén
  // correlatie-id per ingest (koppelt straks aan document_processing_jobs en
  // platform_event_log.correlatie_id) plus fase-timers. Puur observationeel;
  // verandert het verwerkingsgedrag niet. Logt alleen metadata/tellingen — geen
  // fondsinhoud, geen documenttitel.
  const correlatieId = randomUUID();
  const tStart = Date.now();
  let validatieMs = 0;
  try {
    const supabase = await createServerSupabase();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    // Rate limiting (WP2): vóór het inlezen/extraheren van het bestand.
    const limiet = await controleerLimiet(supabase, LIMIETEN.upload);
    if (!limiet.toegestaan) return rateLimited("documents.upload", limiet.resetAt);

    const { data: profiel } = await supabase
      .from("profielen")
      .select("fonds_id, rol, naam")
      .eq("id", user.id)
      .single();

    if (!profiel?.fonds_id) {
      return NextResponse.json({ error: "Geen fonds gekoppeld" }, { status: 400 });
    }

    // T1.3 — host↔fonds-afdwinging (defense-in-depth náást RLS), vóór het inlezen/
    // opslaan van het bestand. Observe + fail-closed onder TENANT_ENFORCE=on;
    // gedrag-neutraal zolang enforce uit staat.
    const hostOordeel = await beoordeelRouteHostToegang({
      sessieFondsId: profiel.fonds_id,
      gebruikerId: user.id,
      label: "documents.upload.POST",
    });
    if (!hostOordeel.toegestaan) {
      return NextResponse.json(
        { error: "Dit webadres hoort niet bij uw fonds." },
        { status: 403 }
      );
    }

    const formData = await req.formData();
    const bestand = formData.get("bestand") as File;
    const agendapunt_id = (formData.get("agendapunt_id") as string) || null;
    let bibliotheek = (formData.get("bibliotheek") as string) || null;
    let bron = (formData.get("bron") as string) || null;
    let titel = (formData.get("titel") as string) || null;

    // Wanneer dit een vergaderstuk is, zijn standaardwaarden voldoende
    if (agendapunt_id) {
      bibliotheek = bibliotheek || "fonds";
      bron = bron || "Intern";
      titel = titel || (bestand?.name ? stripExtensie(bestand.name) : "Vergaderstuk");
    }

    // B13: generieke (platform-gecureerde) documenten mogen NIET via de tenant-
    // uploadroute worden aangemaakt. Tenants zijn read-only op generiek; curatie
    // loopt interim via service-role/seed (Increment P1 levert de platform-UI).
    // Default = 'fonds'. Server-side leidend; RLS is de tweede verdedigingslinie.
    if (bibliotheek === "generiek") {
      return NextResponse.json(
        {
          error:
            "Generieke (platform-gecureerde) documenten kunnen niet door fondsen worden geüpload. Upload dit als fondsdocument.",
        },
        { status: 403 }
      );
    }
    bibliotheek = bibliotheek || "fonds";

    if (!bestand || !bibliotheek || !bron || !titel) {
      return NextResponse.json(
        { error: "Verplichte velden ontbreken: bestand, bibliotheek, bron, titel" },
        { status: 400 }
      );
    }

    // -- Statusverklaring bij ingest (besluit 0136) ------------------------
    // Zonder verklaring blijft het gedrag ongewijzigd: de DB-default zet
    // `concept` en het document is geen actuele bron. Met verklaring legt de
    // uploader vast dat het stuk BUITEN het portaal al is vastgesteld -- dat is
    // eerlijker dan het door de bestuurlijke keten duwen en zo drie overgangen
    // te fabriceren die nooit hebben plaatsgevonden.
    //
    // Drie poorten, alle server-side: (1) de status moet in de transitietabel
    // staan als toegestane ingest-status, (2) de rol moet de capability uit die
    // tabel hebben, (3) de reden is verplicht als de tabel dat zegt.
    const gevraagdeStatus = (formData.get("status") as string)?.trim() || null;
    const statusReden = (formData.get("status_reden") as string)?.trim() || null;
    let ingestStatus: DocumentStatus | null = null;

    if (gevraagdeStatus && gevraagdeStatus !== "concept") {
      const doelStatus = gevraagdeStatus as DocumentStatus;
      if (!magOvergaan("upload", doelStatus)) {
        return NextResponse.json(
          {
            error:
              `Status "${gevraagdeStatus}" kan niet bij aanlevering worden verklaard. ` +
              `Toegestaan: ${toegestaneIngestStatussen().join(", ")}.`,
            foutcode: "status_bij_ingest_ongeldig",
          },
          { status: 400 }
        );
      }
      const cap = vereisteCapability("upload", doelStatus);
      if (
        cap &&
        cap !== "upload" &&
        !(await requireCapability(user.id, cap as Capability))
      ) {
        return NextResponse.json(
          {
            error:
              "Onvoldoende rechten om bij aanlevering een status te verklaren. " +
              "Upload als concept en laat een beheerder of voorzitter de status zetten.",
          },
          { status: 403 }
        );
      }
      if (redenVerplicht("upload", doelStatus) && !statusReden) {
        return NextResponse.json(
          {
            error:
              "Geef een reden bij de statusverklaring -- bijvoorbeeld waar en wanneer " +
              "het stuk is vastgesteld. Die reden landt in het auditlog.",
            foutcode: "status_reden_ontbreekt",
          },
          { status: 400 }
        );
      }
      ingestStatus = doelStatus;
    }

    // ── H-07 (review 2026-07-30): fail-closed uploadvalidatie ──────────────
    // Deze route deed alleen een extensie-/MIME-controle. De volledige poort
    // (core/lib/bestand-validatie.ts) werd uitsluitend door de generieke
    // curatie gebruikt — de strengste laag zat dus op het pad met het laagste
    // volume, terwijl ALLE fondsdocumenten hier binnenkomen.
    //
    // Volgorde is bewust: eerst de aangekondigde grootte (`bestand.size`,
    // gratis uit de multipart-header) zodat we een te groot bestand weigeren
    // vóórdat het volledig in het geheugen wordt gelezen. Daarna pas de
    // inhoudelijke poort: magic bytes, OOXML-subtype, decompressiebudget
    // (zip bomb), naam-normalisatie en de inhoudshash voor deduplicatie.
    if (bestand.size > MAX_BESTAND_BYTES) {
      return badRequest(
        "documents.upload",
        `Het bestand is groter dan ${Math.round(MAX_BESTAND_BYTES / 1024 / 1024)} MB.`,
        413
      );
    }

    // Lees binnen één keer in het geheugen — voor MVP-volume acceptabel, en
    // begrensd door de check hierboven.
    const bytes = await bestand.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const tValidatie = Date.now();
    const validatie = await valideerUpload({
      naam: bestand.name,
      mimeType: bestand.type,
      buffer,
    });
    validatieMs = Date.now() - tValidatie;
    if (!validatie.ok) {
      console.warn(
        `[documents.upload] geweigerd (${validatie.foutcode}) voor ${logNaam(bestand.name)}`
      );
      // 413 voor grootte-/decompressiegrenzen (payload te groot), 400 voor de
      // rest — zodat de UI het onderscheid kan maken, net als bij de chunk-cap.
      const status =
        validatie.foutcode === "te_groot" || validatie.foutcode === "decompressie_cap"
          ? 413
          : 400;
      return NextResponse.json(
        { error: validatie.melding, foutcode: validatie.foutcode },
        { status }
      );
    }

    const bestandstype = validatie.bestandstype;
    const veiligeBestandsnaam = validatie.veiligeNaam;

    // Deduplicatie op inhoudshash binnen het eigen fonds. Zonder deze check
    // levert tienmaal hetzelfde document tien documentrijen, tien keer chunks,
    // tien keer embeddingkosten én dubbele treffers in de retrieval.
    const { data: bestaand } = await supabase
      .from("documenten")
      .select("id, titel")
      .eq("fonds_id", profiel.fonds_id)
      .eq("bestand_hash", validatie.hash)
      .eq("actief", true)
      .maybeSingle();
    if (bestaand) {
      return NextResponse.json(
        {
          error: `Dit bestand is al eerder geüpload als "${bestaand.titel}".`,
          foutcode: "duplicaat",
          document_id: bestaand.id,
        },
        { status: 409 }
      );
    }

    // ── F6: extractie/OCR/caps/samenvatting VERHUISD naar de worker ────────
    // Het request registreert alleen nog (validatie + opslag + documentrij) en
    // retourneert binnen seconden. De async worker downloadt het origineel uit
    // Storage, extraheert (met OCR-fallback, hogere cap), handhaaft de chunk-cap,
    // genereert de AI-samenvatting van een vergaderstuk en bouwt de index. Zo is
    // een document van willekeurige omvang niet langer aan de 300s-requesttijd
    // gebonden. `verwerkingsstatus='ontvangen'` + geen chunks is het signaal
    // waarop de worker-reaper het document oppikt.

    // Stuk bij een agendapunt: vergadering_id afleiden uit het agendapunt. De
    // trigger fn_document_agendapunt_vergadering_check eist dat vergadering_id
    // gelijk is aan de vergadering van het agendapunt (en dus niet NULL).
    let vergadering_id: string | null = null;
    if (agendapunt_id) {
      const { data: agendapuntRij, error: agendapuntError } = await supabase
        .from("agendapunten")
        .select("vergadering_id")
        .eq("id", agendapunt_id)
        .single();
      if (agendapuntError || !agendapuntRij) {
        return NextResponse.json(
          { error: "Agendapunt niet gevonden of geen toegang" },
          { status: 400 }
        );
      }
      vergadering_id = agendapuntRij.vergadering_id;
    }

    const { data: document, error: docError } = await supabase
      .from("documenten")
      .insert({
        // B13: deze tenant-route levert uitsluitend fondsdocumenten (generiek is
        // hierboven met 403 geweigerd), dus altijd het eigen fonds_id.
        fonds_id: profiel.fonds_id,
        bibliotheek,
        bron,
        titel,
        bestandsnaam: veiligeBestandsnaam,
        bestand_hash: validatie.hash,
        bestandstype,
        // F6: paginas zet de worker ná extractie. Nu nog onbekend.
        paginas: null,
        opgeslagen_door: user.id,
        geindexeerd: false,
        // F6: verwerkingsstatus blijft NULL tot het origineel in Storage staat
        // (zie de opslag_pad-update hieronder). Anders zou de worker-reaper het
        // document kunnen oppakken vóórdat opslag_pad gezet is en het ten onrechte
        // als mislukt markeren (geen origineel).
        agendapunt_id,
        vergadering_id,
        // Besluit 0136: alleen zetten als de uploader een status heeft
        // verklaard. Anders weglaten, zodat de DB-default `concept` blijft
        // gelden -- dat pad is expliciet ongewijzigd.
        ...(ingestStatus ? { status: ingestStatus } : {}),
      })
      .select()
      .single();

    if (docError || !document) {
      console.error("Fout bij opslaan document:", docError);
      return NextResponse.json(
        { error: "Kon document niet opslaan in database" },
        { status: 500 }
      );
    }

    // Origineel-bestand opslaan in Supabase Storage (bucket "documenten").
    // Pad-conventie: <fonds_uuid>/<document_uuid>.<bestandstype>. B13: deze route
    // schrijft alleen naar het eigen fonds-pad; het generiek/-pad is voor tenants
    // read-only (storage-policy 2026_06_20e) en wordt via service-role gecureerd.
    const opslagPad = `${profiel.fonds_id}/${document.id}.${bestandstype}`;

    const { error: storageError } = await supabase.storage
      .from("documenten")
      .upload(opslagPad, buffer, {
        contentType: CONTENT_TYPE_PER_BESTANDSTYPE[bestandstype],
        upsert: false,
      });

    if (storageError) {
      // F6: het origineel is nu ALTIJD dragend — de worker extraheert eruit.
      // Zonder origineel is het document onbruikbaar; opruimen en eerlijk falen.
      console.error("Fout bij opslaan bestand in Storage:", storageError);
      await supabase.from("documenten").delete().eq("id", document.id);
      return NextResponse.json(
        {
          error:
            "Het origineel kon niet worden opgeslagen; het document is niet " +
            "bewaard. Probeer het opnieuw.",
          foutcode: "origineel_opslaan_mislukt",
        },
        { status: 500 }
      );
    }

    // Nu het origineel in Storage staat: opslag_pad zetten ÉN het document
    // vrijgeven voor de worker-reaper (verwerkingsstatus='ontvangen'). Eén update,
    // zodat de reaper het document nooit zonder opslag_pad ziet.
    const { error: padError } = await supabase
      .from("documenten")
      .update({ opslag_pad: opslagPad, verwerkingsstatus: "ontvangen" })
      .eq("id", document.id);
    if (padError) {
      // F6: zonder opslag_pad kan de worker niet extraheren → onbruikbaar.
      console.error(
        `[documents.upload] opslag_pad zetten mislukt voor ${document.id}:`,
        padError
      );
      await supabase.from("documenten").delete().eq("id", document.id);
      return NextResponse.json(
        {
          error:
            "Het document kon niet volledig worden vastgelegd; het is niet " +
            "bewaard. Probeer het opnieuw.",
          foutcode: "origineel_opslaan_mislukt",
        },
        { status: 500 }
      );
    }

    // -- Auditregel bij een statusverklaring (besluit 0136) ----------------
    // Append-only spoor in document_metadata_log, in dezelfde vorm als de
    // metadata-PATCH gebruikt. `oude_waarde` is bewust 'upload': er wás geen
    // vorige status, dit is de herkomst. Zo is in het log te zien dat de status
    // bij aanlevering is verklaard en niet via de bestuurlijke keten is
    // gelopen -- precies het onderscheid waar dit besluit om draait.
    //
    // Best-effort: een mislukt auditlog mag een geslaagde upload niet
    // terugdraaien, maar moet wel zichtbaar zijn in de logs.
    if (ingestStatus) {
      const { error: auditFout } = await supabase
        .from("document_metadata_log")
        .insert({
          document_id: document.id,
          document_titel_snapshot: titel,
          fonds_id: profiel.fonds_id,
          gewijzigd_door: user.id,
          gewijzigd_door_naam: profiel.naam ?? null,
          veld_naam: "status",
          oude_waarde: "upload",
          nieuwe_waarde: ingestStatus,
          wijzig_reden: statusReden,
          wijzig_type: "status",
          rag_impact: true,
        });
      if (auditFout) {
        console.error(
          `[documents.upload] auditlog statusverklaring mislukt voor ${document.id}:`,
          auditFout
        );
      }
    }

    // ── F6: het request registreert alleen; de worker doet de rest ─────────
    // Kale chunks, prefix, embedding, AI-samenvatting én OCR gebeuren nu in de
    // async worker, die het origineel uit Storage haalt. Het request is klaar:
    // `verwerkingsstatus='ontvangen'` (in de insert gezet) is het reaper-signaal;
    // `geindexeerd` blijft false tot de worker de invariant haalt (nul chunks met
    // embedding is null). Ook een scan zonder tekstlaag hoeft niet meer manueel
    // "Tekstherkenning uitvoeren": de worker OCRt automatisch (tot MAX_OCR_PAGINAS).

    // F0.1: request-zijde meting — bewijst dat de bevestiging binnen seconden
    // komt (acceptatiecriterium 2). De worker logt de verwerkingsfasen apart.
    // Uitsluitend metadata — geen fondsinhoud, geen titel.
    console.log(
      JSON.stringify({
        tag: "ingest-meting",
        fase: "request",
        correlatie_id: correlatieId,
        document_id: document.id,
        fonds_id: profiel.fonds_id,
        bestandstype,
        agendapunt: !!agendapunt_id,
        status: "verwerken",
        duur_ms: {
          validatie: validatieMs,
          totaal: Date.now() - tStart,
        },
      })
    );

    // Eerlijke melding (geen schijnzekerheid): opgeslagen en in verwerking, nog
    // niet doorzoekbaar. `status:'verwerken'` stuurt de UI (F5) naar de
    // "Verwerken…"-badge en polling.
    return NextResponse.json({
      success: true,
      status: "verwerken",
      document_id: document.id,
      titel,
      bestandstype,
      bericht:
        "Document geüpload. Het wordt nu verwerkt en is binnen enkele minuten " +
        "doorzoekbaar.",
    });
  } catch (error) {
    console.error("Upload fout:", error);
    return NextResponse.json(
      { error: "Er is een fout opgetreden bij het uploaden." },
      { status: 500 }
    );
  }
}

// Haal lijst van documenten op
export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const bibliotheek = searchParams.get("bibliotheek");

    let query = supabase
      .from("documenten")
      .select("*")
      .order("aangemaakt", { ascending: false });

    if (bibliotheek) {
      query = query.eq("bibliotheek", bibliotheek);
    }

    const { data, error } = await query;
    if (error) {
      console.error("Documenten ophalen fout:", error);
      return NextResponse.json({ error: "Documenten ophalen mislukt" }, { status: 500 });
    }
    return NextResponse.json({ documenten: data });
  } catch (error) {
    console.error("Fout bij ophalen documenten:", error);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
