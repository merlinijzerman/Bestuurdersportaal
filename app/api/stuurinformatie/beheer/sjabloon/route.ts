import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { requireCapability } from "@/core/lib/capabilities";
import { weigerAlsModuleUit } from "@/core/lib/module-guard";
import { errorResponse } from "@/core/lib/api-errors";
import { sjabloonAoa, SJABLOON_WERKBLAD } from "@/core/lib/stuurinfo-sjabloon";

// ============================================================
//  GET /api/stuurinformatie/beheer/sjabloon — download van het vaste
//  Excel-sjabloon (T14). De inhoud komt uit de pure module (sjabloonAoa);
//  roundtrip-garantie: de upload-parser herkent elk veld (sanity-getest).
//  Zelfde gates als de rest van de invoerlaag (capability + module).
// ============================================================

export const GET = withFondsRoute({ capability: "stuurinformatie.manage", schema: "geen-body" }, async (ctx) => {
  try {
    if (!ctx.fondsId)
      return NextResponse.json({ error: "Geen fonds" }, { status: 400 });

    const magBeheren = await requireCapability(ctx.gebruikerId, "stuurinformatie.manage");
    if (!magBeheren)
      return NextResponse.json({ error: "Onvoldoende rechten" }, { status: 403 });

    const weigering = await weigerAlsModuleUit(ctx.fondsId, "stuurinformatie");
    if (weigering) return weigering;

    const werkboek = XLSX.utils.book_new();
    const werkblad = XLSX.utils.aoa_to_sheet(sjabloonAoa());
    // Kolombreedtes voor leesbaarheid (label / waarde / eenheid).
    werkblad["!cols"] = [{ wch: 42 }, { wch: 14 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(werkboek, werkblad, SJABLOON_WERKBLAD);
    const buffer = XLSX.write(werkboek, { type: "buffer", bookType: "xlsx" }) as Buffer;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="stuurinformatie-sjabloon.xlsx"',
      },
    });
  } catch (e) {
    return errorResponse("stuurinformatie.beheer.sjabloon.GET", e);
  }
});
