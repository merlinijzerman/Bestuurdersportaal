import type { SupabaseClient } from "@supabase/supabase-js";
import type { PreflightUitkomst } from "./ai-preflight";
import type { OcrReservering } from "./ocr";

/** Koppel de gereserveerde OCR-actie aan precies deze providerpoging. */
export function ocrReserveringMetAfronding(
  svc: SupabaseClient,
  uitkomst: PreflightUitkomst
): Awaited<ReturnType<OcrReservering>> {
  if (uitkomst.uitkomst !== "nieuw" || !uitkomst.actieId) return false;

  const actieId = uitkomst.actieId;
  return {
    toegestaan: true,
    afronden: async (status) => {
      const { data, error } = await svc.rpc("fn_ai_actie_afronden", {
        p_actie_id: actieId,
        p_status: status,
        p_resultaat_ref: null,
      });
      // Ook een stilzwijgende false is een mislukte afronding.
      if (error || data !== true) throw new Error("ocr_actie_afronden_mislukt");
    },
  };
}
