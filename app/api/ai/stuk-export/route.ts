// ============================================================================
//  /api/ai/stuk-export — Word-export (.docx) van een AI-ondersteund voorbereid
//  stuk (T2, bureau-stand, ontwerp §9 / FR-16..18).
// ----------------------------------------------------------------------------
//  Waarom SERVER-SIDE bouwen en niet in de browser:
//   • De capability-gate (ai.stukvoorbereiding, G2/FR-21) is hard alleen als de
//     bouw én de logging server-side gebeuren — een geknutseld request stuit dan
//     op de gate, niet op een clientcheck.
//   • De export MOET geregistreerd worden (B-4/G16). Door bouw en logging in één
//     route te leggen, kan er geen bestand naar buiten zonder auditregel: eerst
//     loggen, dan pas het bestand teruggeven. Mislukt het loggen, dan geen export.
//
//  De .docx zelf wordt gebouwd met dezelfde AST + bouwKopie()-discipline als het
//  klembord (core/lib/antwoord-docx.ts) — géén tweede renderer (besluit 0079). De
//  verplichte bronnenlijst en herkomstregel worden daar constructief afgedwongen.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { rolHeeftCapability } from "@/core/lib/capabilities";
import { weigerAlsModuleUit } from "@/core/lib/module-guard";
import {
  isStuksoort,
  stuksoortDef,
  STUK_PROMPTVARIANT,
  extraheerStukBlok,
} from "@/core/lib/stukvoorbereiding";
import { bouwDocx, type DocxStukContext } from "@/core/lib/antwoord-docx";
import { nlDatum, type KopieBron } from "@/core/lib/antwoord-klembord";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Ruime bovengrens tegen misbruik; een concept is nooit zo lang.
const MAX_ANTWOORD = 200_000;

/** Neemt alleen de bekende, veilige velden van een bronobject over (geen tekst). */
function schoonBron(b: unknown): KopieBron | null {
  if (typeof b !== "object" || b === null) return null;
  const o = b as Record<string, unknown>;
  if (typeof o.nummer !== "number") return null;
  return {
    nummer: o.nummer,
    titel: typeof o.titel === "string" ? o.titel : "",
    bron: typeof o.bron === "string" ? o.bron : "",
    paragraaf: typeof o.paragraaf === "string" ? o.paragraaf : null,
    pagina: typeof o.pagina === "number" ? o.pagina : null,
    documentdatum: typeof o.documentdatum === "string" ? o.documentdatum : null,
    documentstatus: typeof o.documentstatus === "string" ? o.documentstatus : null,
  };
}

export const POST = withFondsRoute({ capability: "ai.stukvoorbereiding" }, async (ctx, req: NextRequest) => {
  try {
    const supabase = ctx.supabase;

    // Rol + fondsnaam uit het profiel (RLS-client, eigen rij). BLIJFT staan: de
    // wrapper levert vier profielkolommen, deze select heeft de join
    // `fondsen(naam)` erbij en die zit er niet bij. Recept "Gevallen die MET DE
    // HAND moeten": eigen aanvullende query in de handler, en de bestaande
    // casts eromheen ongemoeid — dat houdt de diff bij de preambule.
    const { data: profiel } = await supabase
      .from("profielen")
      .select("rol, naam, fonds_id, fondsen(naam)")
      .eq("id", ctx.gebruikerId)
      .single();

    // Capability-gate (G2/FR-21). De definer-RPC log_word_export() dubbelt deze
    // check als DB-backstop; hier levert hij een leesbare 403.
    if (!rolHeeftCapability((profiel as { rol?: string | null } | null)?.rol, "ai.stukvoorbereiding")) {
      return NextResponse.json(
        { error: "Deze functie is voorbehouden aan het bestuursbureau." },
        { status: 403 }
      );
    }

    // Beschikbaarheidsgate (BOVENOP de capability, "beschikbaarheid ≠ autorisatie"):
    // is de AI-module voor dit fonds via het manifest uitgezet, dan is dit
    // AI-entrypoint dicht — net als /api/chat. fonds_id server-side uit het profiel.
    const fondsId = (profiel as { fonds_id?: string | null } | null)?.fonds_id ?? null;
    const moduleWeigering = await weigerAlsModuleUit(fondsId, "ai");
    if (moduleWeigering) return moduleWeigering;

    const body = (await req.json().catch(() => ({}))) as {
      antwoord?: unknown;
      bronnen?: unknown;
      stuksoort?: unknown;
      onderwerp?: unknown;
      gesprek_id?: unknown;
    };

    const ruwAntwoord = typeof body.antwoord === "string" ? body.antwoord : "";
    if (!ruwAntwoord.trim()) {
      return NextResponse.json({ error: "Geen inhoud om te exporteren." }, { status: 400 });
    }
    if (ruwAntwoord.length > MAX_ANTWOORD) {
      return NextResponse.json({ error: "Inhoud te groot voor export." }, { status: 413 });
    }
    // T5 A5: het document bevat uitsluitend het stuk — géén conversationele in- of
    // uitleiding. De producerende taak levert het stuk al kaal; dit is de
    // afdwingende vangnetlaag vóór de bouw.
    const antwoord = extraheerStukBlok(ruwAntwoord);
    if (!antwoord.trim()) {
      return NextResponse.json({ error: "Geen inhoud om te exporteren." }, { status: 400 });
    }
    if (!isStuksoort(body.stuksoort)) {
      return NextResponse.json({ error: "Onbekende stuksoort." }, { status: 400 });
    }
    const bronnen = Array.isArray(body.bronnen)
      ? body.bronnen.map(schoonBron).filter((b): b is KopieBron => b !== null)
      : [];
    const gesprekId =
      typeof body.gesprek_id === "string" && UUID.test(body.gesprek_id)
        ? body.gesprek_id
        : null;

    const stukLabel = stuksoortDef(body.stuksoort)!.titel;
    const onderwerp =
      typeof body.onderwerp === "string" && body.onderwerp.trim()
        ? body.onderwerp.trim().slice(0, 200)
        : null;
    const titel = onderwerp ? `${stukLabel} — ${onderwerp}` : stukLabel;

    const fondsnaam =
      (profiel as { fondsen?: { naam?: string } | { naam?: string }[] } | null)?.fondsen &&
      !Array.isArray((profiel as { fondsen?: unknown }).fondsen)
        ? ((profiel as { fondsen?: { naam?: string } }).fondsen?.naam ?? null)
        : Array.isArray((profiel as { fondsen?: { naam?: string }[] }).fondsen)
        ? ((profiel as { fondsen?: { naam?: string }[] }).fondsen?.[0]?.naam ?? null)
        : null;

    // Hernoemd van `ctx` naar `docxCtx`: `ctx` is sinds de migratie de
    // FondsContext van de wrapper. Twee regels, en de alternatieve kant — de
    // wrapperparameter anders noemen — zou deze route laten afwijken van de 94
    // andere.
    const docxCtx: DocxStukContext = {
      titel,
      datum: nlDatum(new Date()),
      surface: "bureau",
      fondsnaam,
    };

    // ── Eerst LOGGEN, dan pas het bestand teruggeven (B-4/G16) ──────────────
    // Geen export zonder auditregel. De RPC bepaalt gebruiker/fonds server-side
    // en weigert een niet-bureau-rol als DB-backstop. Bronnen = identiteit
    // (titel/vindplaats), GEEN documenttekst.
    const { error: logFout } = await supabase.rpc("log_word_export", {
      p_gesprek_audit_id: gesprekId,
      p_stuksoort: body.stuksoort,
      p_promptvariant: STUK_PROMPTVARIANT,
      p_bronnen: bronnen.map((b) => ({
        nummer: b.nummer,
        titel: b.titel,
        bron: b.bron,
        paragraaf: b.paragraaf ?? null,
        pagina: b.pagina ?? null,
      })),
    });
    if (logFout) {
      console.error("log_word_export mislukt:", logFout);
      return NextResponse.json(
        { error: "Export kon niet worden geregistreerd; het bestand is niet aangemaakt." },
        { status: 500 }
      );
    }

    // ── Nu pas de .docx bouwen (herkomst + bronnenlijst constructief) ───────
    const payload = await bouwDocx(antwoord, bronnen, docxCtx);

    return new NextResponse(Buffer.from(payload.bytes), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${payload.bestandsnaam}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("Fout in POST /api/ai/stuk-export:", e);
    return NextResponse.json({ error: "Export mislukt" }, { status: 500 });
  }
});
