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
// Besluit 0140 — classificatie bij aanlevering (documenttype + bronstatus).
// Puur, gedeeld met de UI, en getest in document-ingest-classificatie.sanity.ts.
import {
  beoordeelIngestBronstatus,
  beoordeelIngestDocumenttype,
  beoordeelIngestDocumentdatum,
  VEREISTE_BRONSTATUS_CAPABILITY,
} from "@/core/lib/document-ingest-classificatie";
import type { Documenttype, DocumentContext } from "@/core/lib/document-metadata";
import { magVanKracht, NORMATIEVE_DOCUMENTTYPEN } from "@/core/lib/document-statusprofiel";
import { beoordeelRapportageRetire } from "@/core/lib/document-rapportage-retire";
import type { Bronstatus } from "@/core/lib/document-status-transities";
import { requireCapability, type Capability } from "@/core/lib/capabilities";
import {
  valideerUpload,
  logNaam,
  normaliseerBestandsnaam,
  MAX_BESTAND_BYTES,
} from "@/core/lib/bestand-validatie";
import { toegestaneUploadExtensie } from "@/core/lib/ingest-caps";
import { controleerLimiet, LIMIETEN } from "@/core/lib/rate-limit";
import { badRequest, rateLimited } from "@/core/lib/api-errors";
import { beoordeelRouteHostToegang } from "@/core/lib/tenant-route-guard";
import { withFondsRoute, type FondsContext } from "@/core/lib/route-wrapper";
import { z } from "zod";

type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;
const malwareScanAan = () => process.env.WP3_MALWARESCAN_AAN === "true";

// Strip de bestandsextensie van de naam — werkt voor alle ondersteunde types.
function stripExtensie(naam: string): string {
  return naam.replace(/\.(pdf|docx|pptx|xlsx)$/i, "");
}

// Werkopdracht 2.5 — gevalideerde retire-gegevens die van de poort naar de
// uitvoering (completeUpload) reizen.
type RapportageRetireInfo = {
  voorgangerId: string;
  voorgangerOudeStatus: DocumentStatus;
  voorgangerTitel: string;
  reden: string;
};

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
      // Werkopdracht 1.5 — afgeleide context (niet meer door de client gevraagd).
      context: DocumentContext;
      // Werkopdracht 1.4/1.5 — documentdatum: verplicht bij rapportage, anders
      // default op de uploaddatum.
      documentdatum: string;
      ingestStatus: DocumentStatus | null;
      statusReden: string | null;
      // Besluit 0140 — classificatie bij aanlevering.
      documenttype: Documenttype | null;
      bronstatus: Bronstatus | null;
      bronstatusReden: string | null;
      bronstatusRagImpact: boolean;
      // Werkopdracht 2.5 — rapportage-retire: de gekozen voorganger die bij
      // aanlevering van deze (actuele) rapportage naar `historisch` gaat.
      retire: RapportageRetireInfo | null;
      // Retire kon in de complete-fase niet (meer) — de upload slaagt wél; dit is
      // de melding die aan de gebruiker teruggaat.
      retireWaarschuwing: string | null;
    }
  | { ok: false; response: NextResponse };

async function valideerUploadMetadata(
  supabase: ServerSupabase,
  userId: string,
  fondsId: string,
  fase: "init" | "complete",
  raw: {
    bestandsnaam: string;
    agendapunt_id?: string | null;
    bibliotheek?: string | null;
    bron?: string | null;
    titel?: string | null;
    status?: string | null;
    status_reden?: string | null;
    documenttype?: string | null;
    documentdatum?: string | null;
    bronstatus?: string | null;
    bronstatus_reden?: string | null;
    vervangt_rapportage_id?: string | null;
    retire_reden?: string | null;
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

  // -- Classificatie bij aanlevering (besluit 0140) ---------------------------
  // Documenttype is verplicht op het BIBLIOTHEEK-pad en optioneel wanneer de
  // upload uit een andere context komt (vergaderstuk bij een agendapunt,
  // bewijsstuk bij een processtap). Die stromen tonen de vraag niet, en er
  // automatisch "bijlage" van maken zou een classificatie verzinnen die we niet
  // kennen. Zie de toelichting in document-ingest-classificatie.ts.
  const typeUitkomst = beoordeelIngestDocumenttype(raw.documenttype, {
    verplicht: !agendapunt_id,
  });
  if (!typeUitkomst.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: typeUitkomst.melding, foutcode: typeUitkomst.foutcode },
        { status: 400 }
      ),
    };
  }

  // Statusprofiel (werkopdracht 1.3, DOELMODEL §5): 'van kracht' is een geldende
  // NORM en mag alleen bij de normatieve cluster worden verklaard. Server-side
  // leidend, náást de UI-filter. Beide velden zijn hier bekend.
  if (ingestStatus === "van_kracht" && !magVanKracht(typeUitkomst.documenttype)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            `Status 'van kracht' is alleen toegestaan voor normatieve documenttypen ` +
            `(${NORMATIEVE_DOCUMENTTYPEN.join(", ")}). Kies 'vastgesteld' of pas het type aan.`,
          foutcode: "van_kracht_niet_toegestaan_voor_type",
        },
        { status: 400 }
      ),
    };
  }

  // -- Documentdatum (werkopdracht 1.4/1.5) -----------------------------------
  // Rapportage vereist een documentdatum; andere types defaulten op vandaag.
  const vandaag = new Date().toISOString().slice(0, 10);
  const datumUitkomst = beoordeelIngestDocumentdatum(
    typeUitkomst.documenttype,
    raw.documentdatum,
    vandaag
  );
  if (!datumUitkomst.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: datumUitkomst.melding, foutcode: datumUitkomst.foutcode },
        { status: 400 }
      ),
    };
  }

  // Bronstatus loopt door DEZELFDE transitietabel als een latere wijziging, met
  // dezelfde capability. Zonder deze poort zou upload een achterdeur zijn om de
  // bronstatus-governance te omzeilen.
  const bronstatusUitkomst = beoordeelIngestBronstatus(
    raw.bronstatus,
    raw.bronstatus_reden
  );
  if (!bronstatusUitkomst.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: bronstatusUitkomst.melding, foutcode: bronstatusUitkomst.foutcode },
        { status: 400 }
      ),
    };
  }
  if (
    bronstatusUitkomst.bronstatus &&
    !(await requireCapability(userId, VEREISTE_BRONSTATUS_CAPABILITY as Capability))
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Onvoldoende rechten om bij aanlevering een bronstatus te verklaren. " +
            "Upload zonder bronstatus en laat een beheerder of voorzitter hem zetten.",
          foutcode: "bronstatus_capability_ontbreekt",
        },
        { status: 403 }
      ),
    };
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

  // Werkopdracht 1.5 — context volledig AFLEIDEN uit de FK-koppelingen i.p.v.
  // door de client laten aanleveren. Op dit uploadpad is alleen de
  // vergadering-koppeling beschikbaar (agendapunt → vergadering); de
  // dossier-/procesinstantiekoppeling ontstaat later via een aparte join en is
  // hier dus geen invoer. Vandaar: vergadering_id → 'vergadering', anders
  // 'algemeen'. Voldoet aan de context-CHECK-constraints (vergadering vereist
  // vergadering_id).
  const context: DocumentContext = vergadering_id ? "vergadering" : "algemeen";

  // -- Rapportage-retire (werkopdracht 2.5) -----------------------------------
  // Bij het aanleveren van een NIEUWE, actuele rapportage kan de uploader de op
  // te volgen rapportage kiezen; die gaat dan → historisch. Puur additief op het
  // 5-waarden-statusmodel (0154).
  //
  // FASE-verschil: in `init` is een retire-fout een BLOKKER (400 vóór de upload,
  // UX-guardrail). In `complete` is het bestand al direct-to-storage geland;
  // dan mag een retire-fout de geslaagde upload NIET kelderen — hij degradeert
  // naar een waarschuwing (de retire wordt overgeslagen).
  let retire: RapportageRetireInfo | null = null;
  let retireWaarschuwing: string | null = null;
  const vervangtId =
    typeof raw.vervangt_rapportage_id === "string"
      ? raw.vervangt_rapportage_id.trim() || null
      : null;
  if (vervangtId) {
    const uitkomst = await (async (): Promise<
      | { soort: "ok"; retire: RapportageRetireInfo }
      | { soort: "fout"; melding: string; foutcode: string }
    > => {
      if (typeUitkomst.documenttype !== "rapportage") {
        return {
          soort: "fout",
          melding: "Een voorganger afvoeren kan alleen bij het aanleveren van een rapportage.",
          foutcode: "retire_geen_rapportage",
        };
      }
      if (ingestStatus !== "vastgesteld" && ingestStatus !== "van_kracht") {
        return {
          soort: "fout",
          melding:
            "Verklaar de nieuwe rapportage als 'vastgesteld' of 'van kracht' om de vorige af te voeren.",
          foutcode: "retire_nieuwe_niet_actueel",
        };
      }
      const { data: voorganger } = await supabase
        .from("documenten")
        .select("id, fonds_id, documenttype, status, titel, actief")
        .eq("id", vervangtId)
        .maybeSingle();
      if (!voorganger || voorganger.fonds_id !== fondsId || voorganger.actief === false) {
        return {
          soort: "fout",
          melding: "De gekozen voorgaande rapportage is niet gevonden in dit fonds.",
          foutcode: "retire_voorganger_onbekend",
        };
      }
      const voorgangerStatus = (voorganger.status as DocumentStatus) ?? null;
      const beoordeling = beoordeelRapportageRetire({
        nieuwDocumenttype: typeUitkomst.documenttype,
        voorgangerDocumenttype: (voorganger.documenttype as Documenttype) ?? null,
        voorgangerStatus,
      });
      if (!beoordeling.ok) {
        return { soort: "fout", melding: beoordeling.melding, foutcode: beoordeling.foutcode };
      }
      // Defense-in-depth: expliciete capability-check op de retire-transitie zelf,
      // náást de impliciete afdwinging via de ingest-statuspoort. Divergeert de
      // vereiste capability ooit (bv. admin-only afvoer), dan blijft dit sluitend.
      const retireCap = vereisteCapability(voorgangerStatus as DocumentStatus, "historisch");
      if (
        retireCap &&
        retireCap !== "upload" &&
        !(await requireCapability(userId, retireCap as Capability))
      ) {
        return {
          soort: "fout",
          melding: "Onvoldoende rechten om de vorige rapportage af te voeren (documents.status.change).",
          foutcode: "retire_capability_ontbreekt",
        };
      }
      const opgegevenReden =
        typeof raw.retire_reden === "string" ? raw.retire_reden.trim() : "";
      return {
        soort: "ok",
        retire: {
          voorgangerId: voorganger.id as string,
          voorgangerOudeStatus: voorgangerStatus as DocumentStatus,
          voorgangerTitel: (voorganger.titel as string) ?? "",
          reden: opgegevenReden || `Opgevolgd door nieuwe rapportage: ${titel}`,
        },
      };
    })();

    if (uitkomst.soort === "ok") {
      retire = uitkomst.retire;
    } else if (fase === "init") {
      return {
        ok: false,
        response: NextResponse.json(
          { error: uitkomst.melding, foutcode: uitkomst.foutcode },
          { status: 400 }
        ),
      };
    } else {
      retireWaarschuwing = ` Let op: de vorige rapportage is niet afgevoerd — ${uitkomst.melding} Voer die eventueel handmatig af via 'Metadata bewerken'.`;
    }
  }

  return {
    ok: true,
    bibliotheek,
    bron,
    titel,
    agendapunt_id,
    vergadering_id,
    context,
    documentdatum: datumUitkomst.documentdatum,
    ingestStatus,
    statusReden,
    documenttype: typeUitkomst.documenttype,
    bronstatus: bronstatusUitkomst.bronstatus,
    bronstatusReden:
      (typeof raw.bronstatus_reden === "string" ? raw.bronstatus_reden.trim() : "") || null,
    bronstatusRagImpact: bronstatusUitkomst.ragImpact,
    retire,
    retireWaarschuwing,
  };
}

// HANDWERK (W4). Deze route wijkt op twee punten af van het recept.
//
// (1) De preambule stond NIET in de handler maar in de twee hulpfuncties. De
//     wrapper zit daarom om de dispatcher, en `ctx` wordt doorgegeven. Een
//     codemod die de hulpfuncties "plausibel" een supabase-parameter geeft
//     compileert prima en ziet er goed uit — vandaar met de hand.
//
// (2) `hostGuard: "route-eigen"` — de route dwingt host↔fonds ZELF af, in
//     `initUpload` en `completeUpload`. Bewust geen `true`: de wrapper zou de
//     guard vóór de FAIL-CLOSED rate limit trekken, en de twee aparte labels
//     (`documents.upload.init` / `.complete`) die de anomaliedetectie voeden tot
//     één samenvouwen. Als WAARDE vastgelegd en niet als ontbrekend veld, zodat
//     de uitzondering greppable is en niet als omissie leest.
export const POST = withFondsRoute({ hostGuard: "route-eigen", rateLimit: "route-eigen", audit: { handeling: "documents.uploaden" }, capability: "documents.metadata.update", schema: z.object({ "agendapunt_id": z.unknown().optional(), "bestandsnaam": z.unknown().optional(), "bibliotheek": z.unknown().optional(), "bron": z.unknown().optional(), "bronstatus": z.unknown().optional(), "bronstatus_reden": z.unknown().optional(), "document_id": z.unknown().optional(), "documentdatum": z.unknown().optional(), "documenttype": z.unknown().optional(), "grootte": z.unknown().optional(), "mimeType": z.unknown().optional(), "mode": z.unknown().optional(), "opslag_pad": z.unknown().optional(), "quarantaine_pad": z.unknown().optional(), "retire_reden": z.unknown().optional(), "status": z.unknown().optional(), "status_reden": z.unknown().optional(), "titel": z.unknown().optional(), "vervangt_rapportage_id": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest) => {
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
  return mode === "complete" ? completeUpload(ctx, req, body) : initUpload(ctx, req, body);
});

// ── init: gate de metadata + wijs een opslagpad toe (nog geen bestand/rij) ──
async function initUpload(
  ctx: FondsContext,
  req: NextRequest,
  body: Record<string, unknown>
) {
  try {
    const supabase = ctx.supabase;

    // Rate limiting (WP2): op de init-stap — de gate vóór de eigenlijke upload.
    // Besluit 0180: fail-closed. Een upload zet de asynchrone ingest in gang en
    // is daarmee kostendragend, ook al doet deze route zelf geen providercall.
    // Drempel ongewijzigd.
    const limiet = await controleerLimiet(supabase, LIMIETEN.upload, {
      failClosed: true,
    });
    if (!limiet.toegestaan) return rateLimited("documents.upload", limiet.resetAt);

    if (!ctx.fondsId)
      return NextResponse.json({ error: "Geen fonds gekoppeld" }, { status: 400 });

    const hostOordeel = await beoordeelRouteHostToegang({
      sessieFondsId: ctx.fondsId,
      gebruikerId: ctx.gebruikerId,
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

    const meta = await valideerUploadMetadata(supabase, ctx.gebruikerId, ctx.fondsId, "init", {
      bestandsnaam,
      agendapunt_id: body.agendapunt_id as string | null,
      bibliotheek: body.bibliotheek as string | null,
      bron: body.bron as string | null,
      titel: body.titel as string | null,
      status: body.status as string | null,
      status_reden: body.status_reden as string | null,
      documenttype: body.documenttype as string | null,
      documentdatum: body.documentdatum as string | null,
      bronstatus: body.bronstatus as string | null,
      bronstatus_reden: body.bronstatus_reden as string | null,
      vervangt_rapportage_id: body.vervangt_rapportage_id as string | null,
      retire_reden: body.retire_reden as string | null,
    });
    if (!meta.ok) return meta.response;

    // Pad-conventie: <fonds_uuid>/<document_uuid>.<ext>. De storage-INSERT-policy
    // dwingt af dat de foldernaam het eigen fonds_id is; de client mint niets zelf.
    const document_id = randomUUID();
    const pad = `${ctx.fondsId}/${document_id}.${ext}`;
    return NextResponse.json(
      malwareScanAan()
        ? { document_id, quarantaine_pad: pad, bucket: "documenten-quarantaine" }
        : { document_id, opslag_pad: pad, bucket: "documenten" }
    );
  } catch (error) {
    console.error("Upload-init fout:", error);
    return NextResponse.json(
      { error: "Er is een fout opgetreden bij het voorbereiden van de upload." },
      { status: 500 }
    );
  }
}

// ── complete: valideer het geüploade object + registreer de documentrij ─────
async function completeUpload(
  ctx: FondsContext,
  req: NextRequest,
  body: Record<string, unknown>
) {
  // F0.1 — nulmeting-instrumentatie (metadata/tellingen, geen fondsinhoud/titel).
  const correlatieId = randomUUID();
  const tStart = Date.now();
  let validatieMs = 0;
  try {
    const supabase = ctx.supabase;

    if (!ctx.fondsId)
      return NextResponse.json({ error: "Geen fonds gekoppeld" }, { status: 400 });

    const hostOordeel = await beoordeelRouteHostToegang({
      sessieFondsId: ctx.fondsId,
      gebruikerId: ctx.gebruikerId,
      label: "documents.upload.complete",
    });
    if (!hostOordeel.toegestaan)
      return NextResponse.json(
        { error: "Dit webadres hoort niet bij uw fonds." },
        { status: 403 }
      );

    const document_id = String(body.document_id ?? "");
    const scanIngeschakeld = malwareScanAan();
    const opslag_pad = String(body.opslag_pad ?? "");
    const quarantaine_pad = String(body.quarantaine_pad ?? "");
    const aangeleverdPad = scanIngeschakeld ? quarantaine_pad : opslag_pad;
    const bestandsnaam = String(body.bestandsnaam ?? "");
    const mimeType = String(body.mimeType ?? "");

    // Pad-autoriteit: het pad MOET exact <eigen fonds_id>/<document_id>.<ext> zijn.
    // Zo kan een client geen ander fonds-pad of losse uuid registreren; RLS is de
    // tweede linie (SELECT/INSERT-policies op het fondspad).
    const ext = toegestaneUploadExtensie(aangeleverdPad);
    if (
      !document_id ||
      !ext ||
      aangeleverdPad !== `${ctx.fondsId}/${document_id}.${ext}`
    ) {
      return NextResponse.json(
        { error: "Ongeldig opslagpad voor deze upload.", foutcode: "opslagpad_ongeldig" },
        { status: 400 }
      );
    }

    const meta = await valideerUploadMetadata(supabase, ctx.gebruikerId, ctx.fondsId, "complete", {
      bestandsnaam,
      agendapunt_id: body.agendapunt_id as string | null,
      bibliotheek: body.bibliotheek as string | null,
      bron: body.bron as string | null,
      titel: body.titel as string | null,
      status: body.status as string | null,
      status_reden: body.status_reden as string | null,
      documenttype: body.documenttype as string | null,
      documentdatum: body.documentdatum as string | null,
      bronstatus: body.bronstatus as string | null,
      bronstatus_reden: body.bronstatus_reden as string | null,
      vervangt_rapportage_id: body.vervangt_rapportage_id as string | null,
      retire_reden: body.retire_reden as string | null,
    });
    if (!meta.ok) return meta.response;

    let gevalideerd: { bestandstype: string; veiligeNaam: string; hash: string } | null = null;
    if (!scanIngeschakeld) {
      // Legacy-pad zolang de rolloutflag uit staat. In de WP3-stroom kan deze
      // app-surface de quarantaine bewust niet lezen; de worker doet dit werk.
      const { data: blob, error: dlErr } = await supabase.storage
        .from("documenten")
        .download(opslag_pad);
      if (dlErr || !blob) {
        return NextResponse.json(
          { error: "Het geüploade bestand is niet gevonden. Probeer de upload opnieuw.", foutcode: "origineel_ontbreekt" },
          { status: 400 }
        );
      }
      const buffer = Buffer.from(await blob.arrayBuffer());
      if (buffer.length > MAX_BESTAND_BYTES) {
        return badRequest("documents.upload", `Het bestand is groter dan ${Math.round(MAX_BESTAND_BYTES / 1024 / 1024)} MB.`, 413);
      }
      const tValidatie = Date.now();
      const validatie = await valideerUpload({ naam: bestandsnaam, mimeType, buffer });
      validatieMs = Date.now() - tValidatie;
      if (!validatie.ok) {
        console.warn(`[documents.upload] geweigerd (${validatie.foutcode}) voor ${logNaam(bestandsnaam)}`);
        const status = validatie.foutcode === "te_groot" || validatie.foutcode === "decompressie_cap" ? 413 : 400;
        return NextResponse.json({ error: validatie.melding, foutcode: validatie.foutcode }, { status });
      }
      if (validatie.bestandstype !== ext) {
        return NextResponse.json({ error: "De bestandsextensie past niet bij de inhoud van het bestand.", foutcode: "extensie_inhoud_mismatch" }, { status: 400 });
      }
      const { data: bestaand } = await supabase
        .from("documenten")
        .select("id, titel")
        .eq("fonds_id", ctx.fondsId)
        .eq("bestand_hash", validatie.hash)
        .eq("actief", true)
        .maybeSingle();
      if (bestaand) {
        return NextResponse.json({ error: `Dit bestand is al eerder geüpload als "${bestaand.titel}".`, foutcode: "duplicaat", document_id: bestaand.id }, { status: 409 });
      }
      gevalideerd = validatie;
    }

    // Eén insert met opslag_pad ÉN verwerkingsstatus='ontvangen' (het reaper-
    // signaal). Atomair: de worker-reaper ziet het document nooit zonder
    // opslag_pad. `id` = de in init gemunte uuid, zodat rij en object matchen.
    const { data: document, error: docError } = await supabase
      .from("documenten")
      .insert({
        id: document_id,
        fonds_id: ctx.fondsId,
        bibliotheek: meta.bibliotheek,
        bron: meta.bron,
        titel: meta.titel,
        bestandsnaam: gevalideerd?.veiligeNaam ?? normaliseerBestandsnaam(bestandsnaam),
        bestand_hash: gevalideerd?.hash ?? null,
        bestandstype: gevalideerd?.bestandstype ?? ext,
        paginas: null,
        opgeslagen_door: ctx.gebruikerId,
        geindexeerd: false,
        opslag_pad: scanIngeschakeld ? null : opslag_pad,
        quarantaine_pad: scanIngeschakeld ? quarantaine_pad : null,
        verwerkingsstatus: "ontvangen",
        agendapunt_id: meta.agendapunt_id,
        vergadering_id: meta.vergadering_id,
        // Werkopdracht 1.5 — afgeleide context (niet meer client-aangeleverd) en
        // 1.4/1.5 — documentdatum (rapportage verplicht, anders uploaddatum).
        context: meta.context,
        documentdatum: meta.documentdatum,
        ...(meta.ingestStatus ? { status: meta.ingestStatus } : {}),
        // Besluit 0140. Beide alleen meesturen als ze zijn verklaard: een
        // ontbrekend documenttype blijft NULL (restgroep "Zonder type") en een
        // ontbrekende bronstatus blijft NULL (≡ actief). Zo verandert er niets
        // aan het gedrag van de stromen die deze velden niet aanleveren.
        ...(meta.documenttype ? { documenttype: meta.documenttype } : {}),
        ...(meta.bronstatus ? { bronstatus: meta.bronstatus } : {}),
        ...(scanIngeschakeld && meta.retire
          ? { vervangt_na_scan_document_id: meta.retire.voorgangerId, vervangt_na_scan_reden: meta.retire.reden }
          : {}),
        // Werkopdracht 2.5 — `vervangt_document_id` wordt bewust NIET hier gezet,
        // maar pas ná een geslaagde retire (hieronder), zodat de FK-koppeling
        // symmetrisch is: geen claim op een vervanging die niet plaatsvond.
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
          bestandstype: gevalideerd?.bestandstype ?? ext,
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

    // -- Auditregels bij een verklaring bij aanlevering, best-effort -----------
    // Statusverklaring: besluit 0136. Documenttype en bronstatus: besluit 0140.
    // Alle drie dragen `oude_waarde = 'upload'` — dát is het onderscheidende
    // kenmerk waaraan je in het log ziet dat de waarde bij AANLEVERING is
    // verklaard en niet later is gewijzigd.
    const auditRegels: Array<{
      veld_naam: string;
      nieuwe_waarde: string;
      wijzig_reden: string | null;
      wijzig_type: string;
      rag_impact: boolean;
    }> = [];
    if (meta.ingestStatus) {
      auditRegels.push({
        veld_naam: "status",
        nieuwe_waarde: meta.ingestStatus,
        wijzig_reden: meta.statusReden,
        wijzig_type: "status",
        rag_impact: true,
      });
    }
    if (meta.documenttype) {
      auditRegels.push({
        veld_naam: "documenttype",
        nieuwe_waarde: meta.documenttype,
        wijzig_reden: null,
        wijzig_type: "metadata",
        // documenttype staat in RAG_IMPACT_VELDEN (document-metadata.ts).
        rag_impact: true,
      });
    }
    if (meta.bronstatus) {
      auditRegels.push({
        veld_naam: "bronstatus",
        nieuwe_waarde: meta.bronstatus,
        wijzig_reden: meta.bronstatusReden,
        wijzig_type: "bronstatus",
        rag_impact: meta.bronstatusRagImpact,
      });
    }
    for (const regel of auditRegels) {
      const { error: auditFout } = await supabase.from("document_metadata_log").insert({
        document_id: document.id,
        document_titel_snapshot: meta.titel,
        fonds_id: ctx.fondsId,
        gewijzigd_door: ctx.gebruikerId,
        gewijzigd_door_naam: ctx.naam ?? null,
        oude_waarde: "upload",
        ...regel,
      });
      if (auditFout) {
        console.error(
          `[documents.upload] auditlog ${regel.veld_naam} mislukt voor ${document.id}:`,
          auditFout
        );
      }
    }

    // -- Rapportage-retire (werkopdracht 2.5), best-effort ----------------------
    // De gekozen voorganger → historisch (blijft historisch-vindbaar, valt uit
    // 'actueel'), daarna symmetrisch de vervangt/vervangen_door-FK's + auditregel.
    // De update draagt een STATUSGUARD (`.eq("status", verwachte)`) zodat een
    // race (de voorganger is tussen validatie en nu al afgevoerd/gewijzigd) 0
    // rijen raakt i.p.v. stil `historisch→historisch` te schrijven met een valse
    // auditregel. De DB-trigger valideert de overgang; de chunk-denorm schuift
    // mee. Faalt/mist de retire, dan blokkeert dat de geslaagde upload niet — er
    // gaat een waarschuwing terug. (Audit blijft best-effort, gelijk aan de
    // ingest-auditregels hierboven, 0136/0140.)
    let retireWaarschuwing: string | null = meta.retireWaarschuwing;
    if (meta.retire && !scanIngeschakeld) {
      const { data: geraakt, error: retireFout } = await supabase
        .from("documenten")
        .update({
          status: "historisch",
          vervangen_door_document_id: document.id,
        })
        .eq("id", meta.retire.voorgangerId)
        // Statusguard: alleen afvoeren vanuit de gevalideerde actuele status.
        .eq("status", meta.retire.voorgangerOudeStatus)
        .select("id");
      if (retireFout || !geraakt || geraakt.length === 0) {
        if (retireFout) {
          console.error(
            `[documents.upload] rapportage-retire mislukt voor voorganger ${meta.retire.voorgangerId}:`,
            retireFout
          );
        }
        retireWaarschuwing =
          " Let op: de vorige rapportage kon niet worden afgevoerd (mogelijk inmiddels gewijzigd) — voer die handmatig af via 'Metadata bewerken'.";
      } else {
        // Symmetrische FK op de NIEUWE rapportage — pas nu de retire vaststaat.
        await supabase
          .from("documenten")
          .update({ vervangt_document_id: meta.retire.voorgangerId })
          .eq("id", document.id);
        for (const regel of [
          {
            veld_naam: "status",
            oude_waarde: meta.retire.voorgangerOudeStatus as string | null,
            nieuwe_waarde: "historisch",
            wijzig_type: "status",
            rag_impact: true,
          },
          {
            veld_naam: "vervangen_door_document_id",
            // De statusguard bevestigt dat de voorganger nog actueel (niet eerder
            // afgevoerd) was; zijn vervangen_door was dus null.
            oude_waarde: null as string | null,
            nieuwe_waarde: document.id,
            wijzig_type: "koppeling",
            rag_impact: false,
          },
        ]) {
          const { error: retireAuditFout } = await supabase
            .from("document_metadata_log")
            .insert({
              document_id: meta.retire.voorgangerId,
              document_titel_snapshot: meta.retire.voorgangerTitel,
              fonds_id: ctx.fondsId,
              gewijzigd_door: ctx.gebruikerId,
              gewijzigd_door_naam: ctx.naam ?? null,
              wijzig_reden: meta.retire.reden,
              ...regel,
            });
          if (retireAuditFout) {
            console.error(
              `[documents.upload] retire-auditlog ${regel.veld_naam} mislukt voor ${meta.retire.voorgangerId}:`,
              retireAuditFout
            );
          }
        }
      }
    }

    // F0.1: request-zijde meting (metadata only).
    console.log(
      JSON.stringify({
        tag: "ingest-meting",
        fase: "request",
        correlatie_id: correlatieId,
        document_id: document.id,
        fonds_id: ctx.fondsId,
        bestandstype: gevalideerd?.bestandstype ?? ext,
        agendapunt: !!meta.agendapunt_id,
        status: "verwerken",
        duur_ms: { validatie: validatieMs, totaal: Date.now() - tStart },
      })
    );

    const retireNoot = scanIngeschakeld && meta.retire
      ? " De vorige rapportage wordt pas na de beveiligingscontrole afgevoerd."
      : meta.retire && !retireWaarschuwing
        ? ` De vorige rapportage "${meta.retire.voorgangerTitel}" is afgevoerd naar historisch.`
        : retireWaarschuwing ?? "";

    return NextResponse.json({
      success: true,
      status: "verwerken",
      document_id: document.id,
      titel: meta.titel,
      bestandstype: gevalideerd?.bestandstype ?? ext,
      bericht:
        "Document geüpload. Het wordt nu verwerkt en is binnen enkele minuten doorzoekbaar." +
        retireNoot,
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
export const GET = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: "geen", capability: "documents.view", schema: "geen-body" }, async (ctx, req: NextRequest) => {
  try {
    const supabase = ctx.supabase;

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
});
