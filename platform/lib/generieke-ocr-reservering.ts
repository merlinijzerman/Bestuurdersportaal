import type { SupabaseClient } from "@supabase/supabase-js";
import {
  beheerSleutel,
  preflightSysteem,
  vingerafdruk,
} from "@/core/lib/ai-preflight";
import type { OcrReservering } from "@/core/lib/ocr";
import { ocrReserveringMetAfronding } from "@/core/lib/ocr-actie-afronding";

/** De OCR-pogingen van één generieke herindexering zijn aparte AI-acties. */
export function generiekeHerindexOcrReservering(
  svc: SupabaseClient,
  documentId: string
): OcrReservering {
  return async (paginas, poging) => {
    const ocrPf = await preflightSysteem(svc, {
      actietype: "ocr_generiek",
      fondsId: null,
      provider: "mistral",
      model: "mistral-ocr-latest",
      ocrPaginas: paginas,
      idempotentie: `${beheerSleutel("ocr_generiek")}:${poging}`,
      vingerafdruk: vingerafdruk({ documentId, paginas, poging }),
    });
    return ocrReserveringMetAfronding(svc, ocrPf);
  };
}
