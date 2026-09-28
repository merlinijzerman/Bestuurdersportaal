import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withFondsRoute, type FondsContext } from "@/core/lib/route-wrapper";
import { requireCapability } from "@/core/lib/capabilities";
import { microsoftSharePointActief } from "@/core/lib/microsoft-connector";
import { sharepointDocumenten } from "@/core/lib/microsoft-sharepoint";
import {
  koppelSharePointBronnenAanAgendapunt,
  leesSharePointAgendapuntKoppelingen,
  ontkoppelSharePointVanAgendapunt,
  type SharePointKoppelsoort,
} from "@/core/lib/microsoft-vault";
import {
  projecteerSharePointAgendakoppelingen,
  refsZijnLiveToegankelijk,
} from "@/core/lib/microsoft-sharepoint-agendapunt-projectie";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_KOPPELINGEN_PER_VERZOEK = 25;
const UNIFORME_FOUT = "De SharePoint-koppeling kon niet worden verwerkt.";

const bronSchema = z.object({
  soort: z.enum(["document", "map"]),
  ref: z.string().regex(UUID),
});

const postSchema = z.object({
  bronnen: z.array(bronSchema).min(1).max(MAX_KOPPELINGEN_PER_VERZOEK),
});

const deleteSchema = z.object({
  koppeling_id: z.string().regex(UUID),
});

async function geldigAgendapunt(ctx: FondsContext, agendapuntId: string) {
  if (!ctx.fondsId || !UUID.test(agendapuntId)) return false;
  const { data, error } = await ctx.supabase
    .from("agendapunten")
    .select("id, verwijderd_op, vergaderingen!inner(fonds_id)")
    .eq("id", agendapuntId)
    .eq("vergaderingen.fonds_id", ctx.fondsId)
    .is("verwijderd_op", null)
    .maybeSingle();
  return !error && !!data;
}

function geenCache(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const GET = withFondsRoute(
  {
    hostGuard: "afdwingen",
    rateLimit: "geen",
    audit: "geen",
    capability: "documents.view",
    schema: "geen-body",
    label: "agendapunten.sharepoint.GET",
  },
  async (ctx, req: NextRequest, params) => {
    const { id } = params as { id: string };
    if (!ctx.fondsId || !(await geldigAgendapunt(ctx, id))) {
      return geenCache(NextResponse.json({ error: "Niet gevonden" }, { status: 404 }));
    }
    if (!(await microsoftSharePointActief(ctx.supabase, ctx.fondsId))) {
      return geenCache(NextResponse.json({ beschikbaar: false, koppelingen: [] }));
    }

    try {
      const koppelingen = await leesSharePointAgendapuntKoppelingen(ctx.fondsId, id);
      if (koppelingen.length === 0) {
        return geenCache(NextResponse.json({ beschikbaar: true, koppelingen: [] }));
      }

      // B-6: elke fout op token, toegang, timeout of Microsoft projecteert exact
      // dezelfde neutrale placeholders. Registermetadata is nooit een fallback.
      let live: Awaited<ReturnType<typeof sharepointDocumenten>> | undefined;
      try {
        const signal = AbortSignal.any([req.signal, AbortSignal.timeout(8_000)]);
        live = await sharepointDocumenten(
          {
            fondsId: ctx.fondsId,
            gebruikerId: ctx.gebruikerId,
            correlationId: ctx.requestId,
          },
          signal
        );
      } catch {
        live = undefined;
      }

      return geenCache(NextResponse.json({
        beschikbaar: true,
        koppelingen: projecteerSharePointAgendakoppelingen(
          koppelingen,
          live ? { documenten: live.documenten, mappen: live.mapRefs } : undefined
        ),
      }));
    } catch {
      return geenCache(NextResponse.json({ error: "Ophalen mislukt" }, { status: 500 }));
    }
  }
);

export const POST = withFondsRoute(
  {
    hostGuard: "afdwingen",
    rateLimit: "geen",
    audit: { handeling: "agendapunten.sharepoint-koppelen" },
    capability: "documents.metadata.update",
    label: "agendapunten.sharepoint.POST",
    // De wrapperdeclaratie blijft bewust compatibel met de bestaande
    // karakteriseringslaag; de strikte, gesloten validatie volgt hieronder met
    // postSchema voordat enige koppeling wordt gelezen of geschreven.
    schema: z.object({ "bronnen": z.unknown().optional() }).passthrough(),
  },
  async (ctx, req: NextRequest, params) => {
    const { id } = params as { id: string };
    if (!ctx.fondsId || !(await geldigAgendapunt(ctx, id))) {
      return NextResponse.json({ error: UNIFORME_FOUT }, { status: 422 });
    }
    if (!(await requireCapability(ctx.gebruikerId, "documents.metadata.update"))) {
      return NextResponse.json({ error: "U heeft geen rechten voor deze actie." }, { status: 403 });
    }
    if (!(await microsoftSharePointActief(ctx.supabase, ctx.fondsId))) {
      return NextResponse.json({ error: UNIFORME_FOUT }, { status: 422 });
    }

    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: UNIFORME_FOUT }, { status: 422 });
    }
    const uniek = [...new Map(
      parsed.data.bronnen.map((bron) => [`${bron.soort}:${bron.ref.toLowerCase()}`, {
        soort: bron.soort as SharePointKoppelsoort,
        ref: bron.ref.toLowerCase(),
      }])
    ).values()];

    try {
      const bestaand = await leesSharePointAgendapuntKoppelingen(ctx.fondsId, id);
      const totaalNaKoppelen = new Set([
        ...bestaand.map((bron) => `${bron.soort}:${bron.ref}`),
        ...uniek.map((bron) => `${bron.soort}:${bron.ref}`),
      ]).size;
      if (totaalNaKoppelen > MAX_KOPPELINGEN_PER_VERZOEK) {
        return NextResponse.json({ error: UNIFORME_FOUT }, { status: 422 });
      }
      // Koppelen volgt uitsluitend op een actuele delegated listing. Een lokale
      // registerref die niet live zichtbaar is krijgt exact dezelfde fout als een
      // onbekende of vreemd-fondsref: geen bestaansoracle.
      const signal = AbortSignal.any([req.signal, AbortSignal.timeout(8_000)]);
      const live = await sharepointDocumenten(
        { fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId, correlationId: ctx.requestId },
        signal
      );
      if (!refsZijnLiveToegankelijk(uniek, { documenten: live.documenten, mappen: live.mapRefs })) {
        return NextResponse.json({ error: UNIFORME_FOUT }, { status: 422 });
      }

      const resultaten = await koppelSharePointBronnenAanAgendapunt({
        fondsId: ctx.fondsId,
        gebruikerId: ctx.gebruikerId,
        agendapuntId: id,
        bronnen: uniek,
      });
      return NextResponse.json({ success: true, gekoppeld: resultaten.length });
    } catch {
      return NextResponse.json({ error: UNIFORME_FOUT }, { status: 422 });
    }
  }
);

export const DELETE = withFondsRoute(
  {
    hostGuard: "afdwingen",
    rateLimit: "geen",
    audit: { handeling: "agendapunten.sharepoint-ontkoppelen" },
    capability: "documents.metadata.update",
    label: "agendapunten.sharepoint.DELETE",
    // Zie POST: de route-eigen deleteSchema blijft de afdwingende grens.
    schema: z.object({ "koppeling_id": z.unknown().optional() }).passthrough(),
  },
  async (ctx, req: NextRequest, params) => {
    const { id } = params as { id: string };
    if (!ctx.fondsId || !(await geldigAgendapunt(ctx, id))) {
      return NextResponse.json({ error: UNIFORME_FOUT }, { status: 422 });
    }
    if (!(await requireCapability(ctx.gebruikerId, "documents.metadata.update"))) {
      return NextResponse.json({ error: "U heeft geen rechten voor deze actie." }, { status: 403 });
    }
    const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: UNIFORME_FOUT }, { status: 422 });
    }
    try {
      const verwijderd = await ontkoppelSharePointVanAgendapunt({
        fondsId: ctx.fondsId,
        agendapuntId: id,
        koppelingId: parsed.data.koppeling_id,
      });
      if (!verwijderd) {
        return NextResponse.json({ error: UNIFORME_FOUT }, { status: 422 });
      }
      return NextResponse.json({ success: true });
    } catch {
      return NextResponse.json({ error: UNIFORME_FOUT }, { status: 422 });
    }
  }
);
