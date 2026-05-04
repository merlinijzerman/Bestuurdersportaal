import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase-server";
import { maakChunks } from "@/lib/rag";
import {
  bepaalBestandstype,
  CONTENT_TYPE_PER_BESTANDSTYPE,
  diagnoseerExtractie,
  extractTekst,
  ONDERSTEUNDE_TYPES,
} from "@/lib/document-extractie";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SP_SAMENVATTING = `Je bent een AI-assistent voor een Nederlands pensioenfondsbestuur.
Je vat een vergaderstuk bondig samen voor bestuursleden die zich voorbereiden op de vergadering.

Geef de samenvatting ALLEEN als geldige JSON in dit exacte format (geen markdown, geen omliggende tekst, geen toelichting eromheen):

{
  "aanleiding": "Eén zin over waarom dit stuk geagendeerd is.",
  "hoofdpunten": ["Punt 1", "Punt 2", "Punt 3"],
  "gevraagd_besluit": "Eén of twee zinnen over wat het bestuur moet beslissen of dat het ter informatie is.",
  "aandachtspunten": ["Optioneel risico of openstaand punt"]
}

Regels:
- Maximaal 200 woorden in totaal.
- 3 tot 5 hoofdpunten als bullets.
- Aandachtspunten zijn optioneel; lege array als er geen zijn.
- Schrijf in professioneel Nederlands voor bestuurders.
- Geen jargon zonder uitleg.`;

async function genereerSamenvatting(tekst: string): Promise<string | null> {
  try {
    // Beperk de input tot ~12k tekens om binnen budget te blijven
    const inputTekst = tekst.length > 12000 ? tekst.slice(0, 12000) + "\n\n[... afgekapt ...]" : tekst;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 800,
      system: SP_SAMENVATTING,
      messages: [
        {
          role: "user",
          content: `Vat het volgende vergaderstuk samen:\n\n${inputTekst}`,
        },
      ],
    });

    const ruw = response.content[0].type === "text" ? response.content[0].text : "";
    if (!ruw) return null;

    // Probeer te valideren als JSON; anders sla raw op
    try {
      JSON.parse(ruw);
      return ruw;
    } catch {
      // Probeer JSON tussen omliggende tekst te vinden
      const match = ruw.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          JSON.parse(match[0]);
          return match[0];
        } catch {
          return ruw;
        }
      }
      return ruw;
    }
  } catch (error) {
    console.error("Samenvatting genereren mislukt:", error);
    return null;
  }
}

// Strip de bestandsextensie van de naam — werkt voor alle ondersteunde types.
function stripExtensie(naam: string): string {
  return naam.replace(/\.(pdf|docx|xlsx)$/i, "");
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("fonds_id, rol")
      .eq("id", user.id)
      .single();

    if (!profiel?.fonds_id) {
      return NextResponse.json({ error: "Geen fonds gekoppeld" }, { status: 400 });
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

    if (!bestand || !bibliotheek || !bron || !titel) {
      return NextResponse.json(
        { error: "Verplichte velden ontbreken: bestand, bibliotheek, bron, titel" },
        { status: 400 }
      );
    }

    const bestandstype = bepaalBestandstype(bestand);
    if (!bestandstype) {
      return NextResponse.json(
        {
          error: `Bestandstype niet ondersteund. Toegestaan: ${ONDERSTEUNDE_TYPES.map(
            (t) => `.${t}`
          ).join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Lees binnen één keer in het geheugen — voor MVP-volume acceptabel.
    const bytes = await bestand.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Tekstextractie (per type, met OCR-fallback voor gescande PDF's).
    let extractie;
    try {
      extractie = await extractTekst(buffer, bestandstype);
    } catch (error) {
      console.error(`Tekstextractie ${bestandstype} mislukt:`, error);
      return NextResponse.json(
        {
          error: `Kon de inhoud van dit ${bestandstype.toUpperCase()}-bestand niet uitlezen. Is het bestand niet beschadigd of beveiligd?`,
        },
        { status: 400 }
      );
    }

    if (!extractie.tekst || extractie.tekst.trim().length < 100) {
      const melding =
        bestandstype === "pdf"
          ? "Kon geen tekst uit deze PDF halen — het is vermoedelijk een gescand document zonder tekstlaag. Maak het bestand eerst doorzoekbaar (bijv. via Acrobat 'Tekstherkenning' of Preview 'Exporteer als PDF met OCR') en upload opnieuw."
          : `Het ${bestandstype.toUpperCase()}-bestand lijkt geen tekstuele inhoud te bevatten.`;
      return NextResponse.json({ error: melding }, { status: 400 });
    }

    // Diagnostiek: log waarschuwingen als de extractie er verdacht uitziet.
    // Twee signalen voor PDF's:
    //  - >5% "lange woorden" wijst op gefaalde spatie-detectie
    //  - resterende hyphen-fragmenten wijzen op gemiste woordafbrekingen
    // Niet blokkerend — we slaan het document gewoon op, maar je kunt dit
    // in de Vercel-logs gebruiken om probleem-PDF's op te sporen.
    if (bestandstype === "pdf") {
      const diag = diagnoseerExtractie(extractie.tekst);
      if (diag.percentageVerdacht > 5 && diag.langeWoorden >= 3) {
        console.warn(
          `[PDF-extractie] Verdachte lange woorden voor "${bestand.name}": ` +
            `${diag.langeWoorden} van ${diag.totaalWoorden} woorden >30 chars ` +
            `(${diag.percentageVerdacht.toFixed(1)}%). Voorbeelden: ${diag.voorbeeldenLangeWoorden.join(", ")}`
        );
      }
      if (diag.hyphenFragmenten >= 3) {
        console.warn(
          `[PDF-extractie] Gemiste woordafbrekingen voor "${bestand.name}": ` +
            `${diag.hyphenFragmenten} hyphen-fragmenten gevonden. ` +
            `Voorbeelden: ${diag.voorbeeldenHyphenFragmenten.join(", ")}`
        );
      }
    }

    const { data: document, error: docError } = await supabase
      .from("documenten")
      .insert({
        fonds_id: bibliotheek === "generiek" ? null : profiel.fonds_id,
        bibliotheek,
        bron,
        titel,
        bestandsnaam: bestand.name,
        bestandstype,
        paginas: extractie.aantalPaginas,
        opgeslagen_door: user.id,
        geindexeerd: false,
        agendapunt_id,
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
    // Pad-conventie: <fonds_uuid>/<document_uuid>.<bestandstype>  voor fonds-bibliotheek,
    //                generiek/<document_uuid>.<bestandstype>      voor generieke bibliotheek.
    const opslagPad =
      bibliotheek === "generiek"
        ? `generiek/${document.id}.${bestandstype}`
        : `${profiel.fonds_id}/${document.id}.${bestandstype}`;

    const { error: storageError } = await supabase.storage
      .from("documenten")
      .upload(opslagPad, buffer, {
        contentType: CONTENT_TYPE_PER_BESTANDSTYPE[bestandstype],
        upsert: false,
      });

    if (storageError) {
      console.error("Fout bij opslaan bestand in Storage:", storageError);
      // Niet fataal — chunks worden alsnog aangemaakt zodat RAG blijft werken.
      // De inzage-knop wordt op de bibliotheek-pagina onzichtbaar voor dit doc.
    } else {
      await supabase
        .from("documenten")
        .update({ opslag_pad: opslagPad })
        .eq("id", document.id);
    }

    // Maak chunks voor RAG
    const chunks = maakChunks(extractie.tekst);
    const chunkRecords = chunks.map((chunk, index) => ({
      document_id: document.id,
      chunk_index: index,
      tekst: chunk,
      pagina: null,
      paragraaf: null,
    }));

    const batchGrootte = 50;
    for (let i = 0; i < chunkRecords.length; i += batchGrootte) {
      const batch = chunkRecords.slice(i, i + batchGrootte);
      const { error: chunkError } = await supabase
        .from("document_chunks")
        .insert(batch);
      if (chunkError) {
        console.error("Fout bij opslaan chunks:", chunkError);
      }
    }

    await supabase
      .from("documenten")
      .update({ geindexeerd: true })
      .eq("id", document.id);

    // Bij vergaderstukken: AI-samenvatting genereren
    let samenvatting: string | null = null;
    if (agendapunt_id) {
      samenvatting = await genereerSamenvatting(extractie.tekst);
      if (samenvatting) {
        await supabase
          .from("documenten")
          .update({
            samenvatting_ai: samenvatting,
            samengevat_op: new Date().toISOString(),
          })
          .eq("id", document.id);
      }
    }

    const paginaLabel =
      extractie.aantalPaginas != null
        ? `${extractie.aantalPaginas} ${
            bestandstype === "xlsx" ? "tabbladen" : "pagina's"
          }`
        : "";

    return NextResponse.json({
      success: true,
      document_id: document.id,
      titel,
      bestandstype,
      paginas: extractie.aantalPaginas,
      chunks_aangemaakt: chunks.length,
      samenvatting_aangemaakt: !!samenvatting,
      bericht: agendapunt_id
        ? `Stuk geüpload en ${samenvatting ? "samengevat" : "verwerkt"}: ${chunks.length} fragmenten${
            paginaLabel ? ` uit ${paginaLabel}` : ""
          }.`
        : `Document succesvol geüpload: ${chunks.length} zoekbare fragmenten aangemaakt${
            paginaLabel ? ` uit ${paginaLabel}` : ""
          }.`,
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
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ documenten: data });
  } catch (error) {
    console.error("Fout bij ophalen documenten:", error);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
