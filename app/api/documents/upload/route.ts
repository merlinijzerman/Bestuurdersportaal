import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
// F6: extractie/OCR/chunking/caps/samenvatting draaien in de async worker
// (platform/lib/ingest-orchestrator). F7 (direct-to-storage): het bestand gaat
// rechtstreeks browser→Storage (langs de Vercel-body-limiet heen); deze route
// gate't de metadata (init) en valideert+registreert het geüploade object
// (complete). Zie core/lib/document-upload-client.ts voor de client-kant.
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
import { toegestaneUploadExtensie } from "@/core/lib/ingest-caps";
import { controleerLimiet, LIMIETEN } from "@/core/lib/rate-limit";
import { badRequest, rateLimited } from "@/core/lib/api-errors";
import { beoordeelRouteHostToegang } from "@/core/lib/tenant-route-guard";

type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

// Strip de bestandsextensie van de naam — werkt voor alle ondersteunde types.
function stripExtensie(naam: string): string {
  return naam.replace(/\.(pdf|docx|pptx|xlsx)$/i, "");
}

// ── Gedeelde metadata-poort (init én complete) ─────────────────────────────
// F7: init gate't vóór de upload (geen verspilde upload bij een blokkade),
// maar complete maakt de documentrij en MOET daarom dezelfde poorten opnieuw
// draaien — nooit vertrouwen dat de client init eerlijk doorliep. Alle checks
// server-side (guardrail). Retourneert genormaliseerde velden of een respons.
type MetadataUitkomst =
  | {
      ok: true;
      bibliotheek: string;
      bron: string;
      titel: string;
      agendapunt_id: string | null;
      vergadering_id: string | null;
      ingestStatus: DocumentStatus | null;
      statusReden: string | null;
    }
  | { ok: false; response: NextResponse };

async function valideerUploadMetadata(
  supabase: ServerSupabase,
  userId: string,
  fondsId: string,
  raw: {
    bestandsnaam: string;
    agendapunt_id?: string | null;
    bibliotheek?: string | null;
    bron?: string | null;
    titel?: string | null;
    status?: string | null;
    status_reden?: string | null;
  }
): Promise<MetadataUitkomst> {
  const agendapunt_id = raw.agendapunt_id || null;
  let bibliotheek = raw.bibliotheek || null;
  let bron = raw.bron || null;
  let titel = raw.titel || null;

  // Wanneer dit een vergaderstuk is, zijn standaardwaarden voldoende.
  if (agendapunt_id) {
    bibliotheek = bibliotheek || "fonds";
    bron = bron || "Intern";
    titel = titel || (raw.bestandsnaam ? stripExtensie(raw.bestandsnaam) : "Vergaderstuk");
  }

  // B13: generieke (platform-gecureerde) documenten mogen NIET via de tenant-
  // uploadroute worden aangemaakt. Default = 'fonds'; server-side leidend.
  if (bibliotheek === "generiek") {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Generieke (platform-gecureerde) documenten kunnen niet door fondsen worden geüpload. Upload dit als fondsdocument.",
        },
        { status: 403 }
      ),
    };
  }
  bibliotheek = bibliotheek || "fonds";

  if (!bibliotheek || !bron || !titel) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Verplichte velden ontbreken: bibliotheek, bron, titel" },
        { status: 400 }
      ),
    };
  }

  // -- Statusverklaring bij ingest (besluit 0136), drie server-side poorten ---
  const gevraagdeStatus = raw.status?.trim() || null;
  const statusReden = raw.status_reden?.trim() || null;
  let ingestStatus: DocumentStatus | null = null;

  if (gevraagdeStatus && gevraagdeStatus !== "concept") {
    const doelStatus = gevraagdeStatus as DocumentStatus;
    if (!magOvergaan("upload", doelStatus)) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error:
              `Status "${gevraagdeStatus}" kan niet bij aanlevering worden verklaard. ` +
              `Toegestaan: ${toegestaneIngestStatussen().join(", ")}.`,
            foutcode: "status_bij_ingest_ongeldig",
          },
          { status: 400 }
        ),
      };
    }
    const cap = vereisteCapability("upload", doelStatus);
    if (cap && cap !== "upload" && !(await requireCapability(userId, cap as Capability))) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error:
              "Onvoldoende rechten om bij aanlevering een status te verklaren. " +
              "Upload als concept en laat een beheerder of voorzitter de status zetten.",
          },
          { status: 403 }
        ),
      };
    }
    if (redenVerplicht("upload", doelStatus) && !statusReden) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error:
              "Geef een reden bij de statusverklaring -- bijvoorbeeld waar en wanneer " +
              "het stuk is vastgesteld. Die reden landt in het auditlog.",
            foutcode: "status_reden_ontbreekt",
          },
          { status: 400 }
        ),
      };
    }
    ingestStatus = doelStatus;
  }

  // Stuk bij een agendapunt: vergadering_id afleiden. De trigger
  // fn_document_agendapunt_vergadering_check eist gelijkheid (en niet NULL).
  let vergadering_id: string | null = null;
  if (agendapunt_id) {
    const { data: agendapuntRij, error: agendapuntError } = await supabase
      .from("agendapunten")
      .select("vergadering_id")
      .eq("id", agendapunt_id)
      .single();
    if (agendapuntError || !agendapuntRij) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Agendapunt niet gevonden of geen toegang" },
          { status: 400 }
        ),
      };
    }
    vergadering_id = agendapuntRij.vergadering_id;
  }

  return {
    ok: true,
    bibliotheek,
    bron,
    titel,
    agendapunt_id,
    vergadering_id,
    ingestStatus,
    statusReden,
  };
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Ongeldige aanvraag (verwacht JSON)." },
      { status: 400 }
    );
  }
  const mode = body.mode === "complete" ? "complete" : "init";
  return mode === "complete" ? completeUpload(req, body) : initUpload(req, body);
}

// ── init: gate de metadata + wijs een opslagpad toe (nog geen bestand/rij) ──
async function initUpload(req: NextRequest, body: Record<string, unknown>) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

    // Rate limiting (WP2): op de init-stap — de gate vóór de eigenlijke upload.
    const limiet = await controleerLimiet(supabase, LIMIETEN.upload);
    if (!limiet.toegestaan) return rateLimited("documents.upload", limiet.resetAt);

    const { data: profiel } = await supabase
      .from("profielen")
      .select("fonds_id, rol, naam")
      .eq("id", user.id)
      .single();
    if (!profiel?.fonds_id)
      return NextResponse.json({ error: "Geen fonds gekoppeld" }, { status: 400 });

    const hostOordeel = await beoordeelRouteHostToegang({
      sessieFondsId: profiel.fonds_id,
      gebruikerId: user.id,
      label: "documents.upload.init",
    });
    if (!hostOordeel.toegestaan)
      return NextResponse.json(
        { error: "Dit webadres hoort niet bij uw fonds." },
        { status: 403 }
      );

    const bestandsnaam = String(body.bestandsnaam ?? "");
    const grootte = Number(body.grootte ?? 0);

    // Aangekondigde grootte (client) — weiger een te groot bestand vóór de upload.
    // De echte bytecontrole gebeurt in complete op het gedownloade object.
    if (grootte > MAX_BESTAND_BYTES) {
      return badRequest(
        "documents.upload",
        `Het bestand is groter dan ${Math.round(MAX_BESTAND_BYTES / 1024 / 1024)} MB.`,
        413
      );
    }

    const ext = toegestaneUploadExtensie(bestandsnaam);
    if (!ext) {
      return NextResponse.json(
        {
          error: "Bestandstype niet ondersteund (alleen PDF, Word, PowerPoint of Excel).",
          foutcode: "type_niet_ondersteund",
        },
        { status: 400 }
      );
    }

    const meta = await valideerUploadMetadata(supabase, user.id, profiel.fonds_id, {
      bestandsnaam,
      agendapunt_id: body.agendapunt_id as string | null,
      bibliotheek: body.bibliotheek as string | null,
      bron: body.bron as string | null,
      titel: body.titel as string | null,
      status: body.status as string | null,
      status_reden: body.status_reden as string | null,
    });
    if (!meta.ok) return meta.response;

    // Pad-conventie: <fonds_uuid>/<document_uuid>.<ext>. De storage-INSERT-policy
    // dwingt af dat de foldernaam het eigen fonds_id is; de client mint niets zelf.
    const document_id = randomUUID();
    const opslag_pad = `${profiel.fonds_id}/${document_id}.${ext}`;

    return NextResponse.json({ document_id, opslag_pad });
  } catch (error) {
    console.error("Upload-init fout:", error);
    return NextResponse.json(
      { error: "Er is een fout opgetreden bij het voorbereiden van de upload." },
      { status: 500 }
    );
  }
}

// ── complete: valideer het geüploade object + registreer de documentrij ─────
async function completeUpload(req: NextRequest, body: Record<string, unknown>) {
  // F0.1 — nulmeting-instrumentatie (metadata/tellingen, geen fondsinhoud/titel).
  const correlatieId = randomUUID();
  const tStart = Date.now();
  let validatieMs = 0;
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

    const { data: profiel } = await supabase
      .from("profielen")
      .select("fonds_id, rol, naam")
      .eq("id", user.id)
      .single();
    if (!profiel?.fonds_id)
      return NextResponse.json({ error: "Geen fonds gekoppeld" }, { status: 400 });

    const hostOordeel = await beoordeelRouteHostToegang({
      sessieFondsId: profiel.fonds_id,
      gebruikerId: user.id,
      label: "documents.upload.complete",
    });
    if (!hostOordeel.toegestaan)
      return NextResponse.json(
        { error: "Dit webadres hoort niet bij uw fonds." },
        { status: 403 }
      );

    const document_id = String(body.document_id ?? "");
    const opslag_pad = String(body.opslag_pad ?? "");
    const bestandsnaam = String(body.bestandsnaam ?? "");
    const mimeType = String(body.mimeType ?? "");

    // Pad-autoriteit: het pad MOET exact <eigen fonds_id>/<document_id>.<ext> zijn.
    // Zo kan een client geen ander fonds-pad of losse uuid registreren; RLS is de
    // tweede linie (SELECT/INSERT-policies op het fondspad).
    const ext = toegestaneUploadExtensie(opslag_pad);
    if (
      !document_id ||
      !ext ||
      opslag_pad !== `${profiel.fonds_id}/${document_id}.${ext}`
    ) {
      return NextResponse.json(
        { error: "Ongeldig opslagpad voor deze upload.", foutcode: "opslagpad_ongeldig" },
        { status: 400 }
      );
    }

    const meta = await valideerUploadMetadata(supabase, user.id, profiel.fonds_id, {
      bestandsnaam,
      agendapunt_id: body.agendapunt_id as string | null,
      bibliotheek: body.bibliotheek as string | null,
      bron: body.bron as string | null,
      titel: body.titel as string | null,
      status: body.status as string | null,
      status_reden: body.status_reden as string | null,
    });
    if (!meta.ok) return meta.response;

    // Het object staat al in Storage (browser→Storage, RLS-afgedwongen). Haal het
    // server-side op — géén request-body-limiet — en draai de VOLLEDIGE validatie
    // (magic bytes, OOXML-subtype, zip-bom-budget, hash) vóórdat er een rij komt.
    const { data: blob, error: dlErr } = await supabase.storage
      .from("documenten")
      .download(opslag_pad);
    if (dlErr || !blob) {
      return NextResponse.json(
        {
          error:
            "Het geüploade bestand is niet gevonden. Probeer de upload opnieuw.",
          foutcode: "origineel_ontbreekt",
        },
        { status: 400 }
      );
    }
    const buffer = Buffer.from(await blob.arrayBuffer());

    // Vangnet naast de bucket-limiet (file_size_limit) en de client-check.
    if (buffer.length > MAX_BESTAND_BYTES) {
      return badRequest(
        "documents.upload",
        `Het bestand is groter dan ${Math.round(MAX_BESTAND_BYTES / 1024 / 1024)} MB.`,
        413
      );
    }

    const tValidatie = Date.now();
    const validatie = await valideerUpload({ naam: bestandsnaam, mimeType, buffer });
    validatieMs = Date.now() - tValidatie;
    if (!validatie.ok) {
      console.warn(
        `[documents.upload] geweigerd (${validatie.foutcode}) voor ${logNaam(bestandsnaam)}`
      );
      // Het afgekeurde object blijft als wees achter en wordt door de worker-
      // orphan-sweep opgeruimd (geen service-role op deze app-surface).
      const status =
        validatie.foutcode === "te_groot" || validatie.foutcode === "decompressie_cap"
          ? 413
          : 400;
      return NextResponse.json(
        { error: validatie.melding, foutcode: validatie.foutcode },
        { status }
      );
    }

    // De pad-extensie moet bij het gesnifte type passen. valideerUpload leidt het
    // type uit dezelfde bestandsnaam af, dus dit is een belt-and-braces-check.
    if (validatie.bestandstype !== ext) {
      return NextResponse.json(
        {
          error: "De bestandsextensie past niet bij de inhoud van het bestand.",
          foutcode: "extensie_inhoud_mismatch",
        },
        { status: 400 }
      );
    }

    // Deduplicatie op inhoudshash binnen het eigen fonds.
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

    // Eén insert met opslag_pad ÉN verwerkingsstatus='ontvangen' (het reaper-
    // signaal). Atomair: de worker-reaper ziet het document nooit zonder
    // opslag_pad. `id` = de in init gemunte uuid, zodat rij en object matchen.
    const { data: document, error: docError } = await supabase
      .from("documenten")
      .insert({
        id: document_id,
        fonds_id: profiel.fonds_id,
        bibliotheek: meta.bibliotheek,
        bron: meta.bron,
        titel: meta.titel,
        bestandsnaam: validatie.veiligeNaam,
        bestand_hash: validatie.hash,
        bestandstype: validatie.bestandstype,
        paginas: null,
        opgeslagen_door: user.id,
        geindexeerd: false,
        opslag_pad,
        verwerkingsstatus: "ontvangen",
        agendapunt_id: meta.agendapunt_id,
        vergadering_id: meta.vergadering_id,
        ...(meta.ingestStatus ? { status: meta.ingestStatus } : {}),
      })
      .select()
      .single();

    if (docError || !document) {
      // 23505 = dit document_id bestaat al (dubbele complete-aanroep). Idempotent
      // behandelen: de eerste aanroep heeft de rij al gemaakt.
      if (docError?.code === "23505") {
        return NextResponse.json({
          success: true,
          status: "verwerken",
          document_id,
          titel: meta.titel,
          bestandstype: validatie.bestandstype,
          bericht:
            "Document geüpload. Het wordt nu verwerkt en is binnen enkele minuten doorzoekbaar.",
        });
      }
      console.error("Fout bij opslaan document:", docError);
      return NextResponse.json(
        { error: "Kon document niet opslaan in database" },
        { status: 500 }
      );
    }

    // -- Auditregel bij een statusverklaring (besluit 0136), best-effort --------
    if (meta.ingestStatus) {
      const { error: auditFout } = await supabase.from("document_metadata_log").insert({
        document_id: document.id,
        document_titel_snapshot: meta.titel,
        fonds_id: profiel.fonds_id,
        gewijzigd_door: user.id,
        gewijzigd_door_naam: profiel.naam ?? null,
        veld_naam: "status",
        oude_waarde: "upload",
        nieuwe_waarde: meta.ingestStatus,
        wijzig_reden: meta.statusReden,
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

    // F0.1: request-zijde meting (metadata only).
    console.log(
      JSON.stringify({
        tag: "ingest-meting",
        fase: "request",
        correlatie_id: correlatieId,
        document_id: document.id,
        fonds_id: profiel.fonds_id,
        bestandstype: validatie.bestandstype,
        agendapunt: !!meta.agendapunt_id,
        status: "verwerken",
        duur_ms: { validatie: validatieMs, totaal: Date.now() - tStart },
      })
    );

    return NextResponse.json({
      success: true,
      status: "verwerken",
      document_id: document.id,
      titel: meta.titel,
      bestandstype: validatie.bestandstype,
      bericht:
        "Document geüpload. Het wordt nu verwerkt en is binnen enkele minuten doorzoekbaar.",
    });
  } catch (error) {
    console.error("Upload-complete fout:", error);
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
