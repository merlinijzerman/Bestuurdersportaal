import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { requireCapability } from "@/core/lib/capabilities";
import { weigerAlsModuleUit } from "@/core/lib/module-guard";
import { errorResponse, badRequest, rateLimited } from "@/core/lib/api-errors";
import { controleerLimiet, LIMIETEN } from "@/core/lib/rate-limit";
import {
  parseSjabloonRijen,
  SJABLOON_VELDEN,
  type SjabloonParseResultaat,
} from "@/core/lib/stuurinfo-sjabloon";
import {
  berekenEvenwicht,
  ACTIVA_KEYS,
  PASSIVA_KEYS,
  type ActivaKey,
  type PassivaKey,
} from "@/core/lib/stuurinfo-invoer";

// ============================================================
//  POST /api/stuurinformatie/beheer/upload — Excel-sjabloon parsen (T14).
//
//  PARSE-ONLY: deze route schrijft NIETS. Het bestand wordt server-side
//  geparset (SheetJS) en op vaste labels gemapt (pure module); de respons is
//  de controle-payload voor het controlescherm. De commit loopt daarna via
//  het normale POST-schrijfpad (type balans_reserves, invoer_bron 'upload'),
//  waar de volledige validatie (allowlist/evenwicht) en de RPC/RLS gelden —
//  geen tweede schrijfpad, geen schijnzekerheid.
//
//  Bestandsgrootte begrensd (1 MB — het sjabloon is ~20 rijen); rate-limited;
//  geen bestandsuitvoering (alleen celwaarden worden gelezen).
// ============================================================

const MAX_BESTAND_BYTES = 1_000_000;
const MAX_RIJEN = 200;

export const POST = withFondsRoute({ capability: "stuurinformatie.manage" }, async (ctx, req: NextRequest) => {
  try {
    const supabase = ctx.supabase;

    if (!ctx.fondsId)
      return NextResponse.json({ error: "Geen fonds" }, { status: 400 });

    const magBeheren = await requireCapability(ctx.gebruikerId, "stuurinformatie.manage");
    if (!magBeheren)
      return NextResponse.json({ error: "Onvoldoende rechten" }, { status: 403 });

    const weigering = await weigerAlsModuleUit(ctx.fondsId, "stuurinformatie");
    if (weigering) return weigering;

    const limiet = await controleerLimiet(supabase, LIMIETEN.stuurinfo_upload);
    if (!limiet.toegestaan) return rateLimited("stuurinformatie.beheer.upload", limiet.resetAt);

    const formData = await req.formData();
    const bestand = formData.get("bestand");
    if (!(bestand instanceof File))
      return badRequest("stuurinformatie.beheer.upload", "Geen bestand ontvangen.");
    if (!bestand.name.toLowerCase().endsWith(".xlsx"))
      return badRequest("stuurinformatie.beheer.upload", "Alleen .xlsx-bestanden worden ondersteund.");
    if (bestand.size > MAX_BESTAND_BYTES)
      return badRequest(
        "stuurinformatie.beheer.upload",
        "Bestand is te groot (max 1 MB). Het sjabloon heeft maar enkele rijen nodig.",
        413
      );

    // Server-side parsen: eerste werkblad, celwaarden als 2D-array (patroon
    // core/lib/document-extractie.ts). Geen formule-evaluatie of uitvoering.
    const buffer = Buffer.from(await bestand.arrayBuffer());
    let rijen: unknown[][];
    try {
      const werkboek = XLSX.read(buffer, { type: "buffer" });
      const eersteBlad = werkboek.SheetNames[0];
      if (!eersteBlad) return badRequest("stuurinformatie.beheer.upload", "Het bestand bevat geen werkblad.");
      rijen = XLSX.utils.sheet_to_json<unknown[]>(werkboek.Sheets[eersteBlad], {
        header: 1,
        blankrows: false,
        defval: "",
      });
    } catch {
      return badRequest("stuurinformatie.beheer.upload", "Het bestand kon niet als .xlsx worden gelezen.");
    }
    if (rijen.length > MAX_RIJEN)
      return badRequest(
        "stuurinformatie.beheer.upload",
        `Het werkblad heeft te veel rijen (max ${MAX_RIJEN}); gebruik het vaste sjabloon.`
      );

    const resultaat: SjabloonParseResultaat = parseSjabloonRijen(rijen);

    // Balanscheck draait mee zodra alle balansvelden herkend zijn (cosmetisch
    // voorproefje; de harde 422-check zit in het commit-pad).
    const activa = {} as Record<ActivaKey, number>;
    const passiva = {} as Record<PassivaKey, number>;
    let balansCompleet = true;
    for (const h of resultaat.herkend) {
      if (h.veld.doel.soort === "balans_activa") activa[h.veld.doel.key] = h.waarde;
      if (h.veld.doel.soort === "balans_passiva") passiva[h.veld.doel.key] = h.waarde;
    }
    for (const k of ACTIVA_KEYS) if (!(k in activa)) balansCompleet = false;
    for (const k of PASSIVA_KEYS) if (!(k in passiva)) balansCompleet = false;
    const evenwicht = balansCompleet ? berekenEvenwicht(activa, passiva) : null;

    const aandacht = resultaat.onherkend.length + resultaat.ontbrekend.length;
    const samenvatting = [
      `${resultaat.herkend.length} van ${SJABLOON_VELDEN.length} velden herkend`,
      evenwicht === null ? "balans nog niet compleet" : evenwicht.sluit ? "balans sluit" : "balans sluit NIET",
      aandacht === 0 ? "geen aandachtspunten" : `${aandacht} veld${aandacht === 1 ? "" : "en"} vraagt aandacht`,
    ].join(" · ");

    return NextResponse.json({
      herkend: resultaat.herkend,
      onherkend: resultaat.onherkend,
      ontbrekend: resultaat.ontbrekend,
      evenwicht,
      samenvatting,
    });
  } catch (e) {
    return errorResponse("stuurinformatie.beheer.upload.POST", e, {
      userMessage: "Verwerken van het bestand is mislukt. Controleer het sjabloon en probeer opnieuw.",
    });
  }
});
