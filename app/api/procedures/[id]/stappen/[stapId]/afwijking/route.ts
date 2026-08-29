import { withFondsRoute } from "@/core/lib/route-wrapper";
import { z } from "zod";
import { afrondenMetAfwijkingHandler } from "./handler";

// POST /api/procedures/[id]/stappen/[stapId]/afwijking
//
// P3 (#168, §5.1): afronden met een gemotiveerde afwijking. De handler houdt
// een route-eigen rolpoort; fn_stap_afronden_met_afwijking herhaalt rol/fonds en
// schrijft status, snapshot en auditspoor atomair. De cascade volgt als
// herstelbare afgeleide toestand.
export const POST = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "procedures.stappen.afwijking-vastleggen" }, capability: "procedures.afwijking.vastleggen",
    schema: z.object({ motivering: z.unknown().optional(), bevestigd: z.unknown().optional() }).passthrough(),
  },
  async (ctx, req, params) => afrondenMetAfwijkingHandler(ctx, req, params)
);
