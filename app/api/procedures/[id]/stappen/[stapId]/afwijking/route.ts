import { withFondsRoute } from "@/core/lib/route-wrapper";
import { afrondenMetAfwijkingHandler } from "@/core/lib/procedure-afwijking-handler";
import { z } from "zod";

// POST /api/procedures/[id]/stappen/[stapId]/afwijking
//
// P3 (#168, §5.1): een stap kan ALTIJD worden afgerond; staat er iets open boven
// `optioneel`, dan legt een bevoegde rol (voorzitter/bestuurder) een gemotiveerde
// AFWIJKING vast — bij een openstaande `kritiek`-vereiste met expliciete
// bevestiging. "Overrulen is niet vervullen": de ontbrekende vereiste blijft open.
//
// De atomaire kern (status + vier kolommen + snapshot + procedure_log +
// governance-event) draait in één DB-transactie (fn_stap_afronden_met_afwijking);
// de activatie-cascade is afgeleide toestand en volgt erbuiten (besluit 0192).
export const POST = withFondsRoute(
  {
    hostGuard: "geen",
    rateLimit: "nog-niet-beoordeeld",
    audit: { handeling: "procedures.stappen.afwijking-vastleggen" },
    capability: "procedures.afwijking.vastleggen",
    schema: z
      .object({
        motivering: z.unknown().optional(),
        bevestigd: z.unknown().optional(),
      })
      .passthrough(),
  },
  async (ctx, req, params) => afrondenMetAfwijkingHandler(ctx, req, params)
);
