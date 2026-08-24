import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { vindTemplate } from "@/core/lib/proces-templates";
import { beginStatussen } from "@/core/lib/procedure-activatie";

export const POST = withFondsRoute({ capability: "procedures.manage" }, async (ctx, req: NextRequest) => {
  try {
    const supabase = ctx.supabase;

    const body = (await req.json()) as {
      template_code?: string;
      titel?: string;
      beschrijving?: string | null;
      deadline?: string | null;
      /** Gekozen fondsleden (id's uit vw_fondsleden). Sinds besluit 0102. */
      eigenaar_ids?: string[];
    };

    const templateCode = body.template_code;
    const titel = body.titel?.trim();
    if (!templateCode) {
      return NextResponse.json({ error: "Template is verplicht" }, { status: 400 });
    }
    if (!titel) {
      return NextResponse.json({ error: "Titel is verplicht" }, { status: 400 });
    }
    const template = vindTemplate(templateCode);
    if (!template) {
      return NextResponse.json(
        { error: `Template ${templateCode} bestaat niet` },
        { status: 400 }
      );
    }

    if (!ctx.fondsId) {
      return NextResponse.json(
        { error: "Geen fonds gekoppeld aan profiel" },
        { status: 400 }
      );
    }

    // 1. Procedure aanmaken
    const { data: procedure, error: procFout } = await supabase
      .from("procedures")
      .insert({
        fonds_id: ctx.fondsId,
        template_code: templateCode,
        titel,
        beschrijving: body.beschrijving || null,
        deadline: body.deadline || null,
        status: "lopend",
        gestart_door: ctx.gebruikerId,
      })
      .select()
      .single();

    if (procFout || !procedure) {
      console.error("Procedure aanmaken fout:", procFout);
      return NextResponse.json(
        { error: "Aanmaken mislukt" },
        { status: 500 }
      );
    }

    // 2. Eigenaars (maker is altijd eigenaar; plus de gekozen fondsleden)
    //
    // Besluit 0102: co-eigenaars worden GEKOZEN uit de fondsleden, niet meer
    // vrij ingetypt. Dat levert een `gebruiker_id` op, waardoor de weergavenaam
    // voortaan live uit vw_fondsleden komt in plaats van uit een bevroren kopie.
    // De naam wordt hier alsnog meegeschreven: `gebruiker_naam` is NOT NULL en
    // maakt deel uit van de primaire sleutel, en hij dient als terugval wanneer
    // een account later verdwijnt.
    //
    // De id's worden server-side gevalideerd tegen vw_fondsleden — die view is
    // op het eigen fonds gescopet, dus een id van buiten het fonds valt er
    // vanzelf uit. Nooit vertrouwen op wat de client meestuurt.
    const gekozenIds = Array.from(
      new Set((body.eigenaar_ids || []).filter((v) => typeof v === "string" && v))
    ).filter((v) => v !== ctx.gebruikerId);

    const eigenaars: { gebruiker_id: string | null; gebruiker_naam: string }[] = [];
    if (ctx.naam) {
      eigenaars.push({ gebruiker_id: ctx.gebruikerId, gebruiker_naam: ctx.naam });
    }
    if (gekozenIds.length > 0) {
      const { data: leden } = await supabase
        .from("vw_fondsleden")
        .select("id, naam")
        .in("id", gekozenIds);
      for (const lid of (leden || []) as { id: string; naam: string | null }[]) {
        if (lid.naam?.trim()) {
          eigenaars.push({ gebruiker_id: lid.id, gebruiker_naam: lid.naam.trim() });
        }
      }
    }

    // `procedure_eigenaars` heeft (procedure_id, gebruiker_naam) als primaire
    // sleutel. Twee leden met dezelfde weergavenaam zouden de insert laten
    // klappen en daarmee het aanmaken van de procedure blokkeren; ontdubbelen op
    // naam voorkomt dat. Het tweede account raakt dan zijn eigenaarschap kwijt —
    // zichtbaar in de UI, en op te lossen door een van beiden een
    // onderscheidende weergavenaam te geven.
    const perNaam = new Map<string, { gebruiker_id: string | null; gebruiker_naam: string }>();
    for (const e of eigenaars) if (!perNaam.has(e.gebruiker_naam)) perNaam.set(e.gebruiker_naam, e);

    if (perNaam.size > 0) {
      await supabase.from("procedure_eigenaars").insert(
        Array.from(perNaam.values()).map((e) => ({
          procedure_id: procedure.id,
          gebruiker_id: e.gebruiker_id,
          gebruiker_naam: e.gebruiker_naam,
        }))
      );
    }

    // 3. Stappen + checklist snapshot
    //
    // Engine v2 (D6): een template die afhankelijkheden declareert
    // (blokkerende_afhankelijkheden gezet, ook al is dat een lege lijst) draait
    // op het PARALLELLE model — elke stap zonder onvervulde afhankelijkheid
    // start 'actief', de rest 'geblokkeerd'. Een parallelle procedure zonder
    // gates start dus met alle stappen 'actief'. Klassieke code-templates (geen
    // afhankelijkheden gedeclareerd) behouden het oude sequentiële gedrag:
    // stap 1 'actief', de rest legacy 'open' (snapshot-integriteit).
    const parallelModel = template.stappen.some((s) =>
      Array.isArray(s.blokkerende_afhankelijkheden)
    );
    const beginStatus = parallelModel
      ? beginStatussen(
          template.stappen.map((s) => ({
            volgorde: s.volgorde,
            blokkerende_afhankelijkheden: s.blokkerende_afhankelijkheden ?? [],
          }))
        )
      : null;

    for (const tStap of template.stappen) {
      const status = beginStatus
        ? beginStatus.get(tStap.volgorde) ?? "geblokkeerd"
        : tStap.volgorde === 1
          ? "actief"
          : "open";
      const { data: stap } = await supabase
        .from("procedure_stappen")
        .insert({
          procedure_id: procedure.id,
          volgorde: tStap.volgorde,
          naam: tStap.naam,
          beschrijving: tStap.beschrijving,
          vereist_besluit: tStap.vereist_besluit,
          geschatte_dagen: tStap.geschatte_dagen,
          status,
          blokkerende_afhankelijkheden: tStap.blokkerende_afhankelijkheden ?? [],
          fase_code: tStap.fase_code ?? null,
        })
        .select()
        .single();

      if (stap && tStap.checklist.length > 0) {
        await supabase.from("procedure_checklist").insert(
          tStap.checklist.map((item) => ({
            stap_id: stap.id,
            volgorde: item.volgorde,
            label: item.label,
            bewijs_vereist: item.bewijs_vereist,
            toelichting: item.toelichting ?? null,
            voldaan: false,
          }))
        );
      }
    }

    // 4. Logboek-events
    const logEntries: Array<{
      procedure_id: string;
      event_type: string;
      actor_id: string;
      actor_naam: string | null;
      payload: Record<string, unknown>;
    }> = [
      {
        procedure_id: procedure.id,
        event_type: "procedure_aangemaakt",
        actor_id: ctx.gebruikerId,
        actor_naam: ctx.naam || null,
        payload: { template: template.naam },
      },
    ];
    // Auditregel per toegevoegde co-eigenaar. De naam wordt hier bewust WEL
    // meegeschreven in de payload: procedure_log legt vast wat er op dat moment
    // gold en is append-only (besluit 0001) — die regels worden dus nooit
    // achteraf met een nieuwe naam herschreven. Sinds besluit 0102 gaat het
    // gebruiker_id mee, zodat een latere lezer de persoon kan terugvinden ook
    // als diens weergavenaam inmiddels is gewijzigd.
    for (const e of Array.from(perNaam.values())) {
      if (e.gebruiker_id !== ctx.gebruikerId) {
        logEntries.push({
          procedure_id: procedure.id,
          event_type: "eigenaar_toegevoegd",
          actor_id: ctx.gebruikerId,
          actor_naam: ctx.naam || null,
          payload: { naam: e.gebruiker_naam, gebruiker_id: e.gebruiker_id },
        });
      }
    }
    // Bij het parallelle model kunnen meerdere stappen tegelijk starten;
    // leg vast welke (i.p.v. alleen stap 1) zodat het logboek de werkelijkheid
    // dekt.
    const actieveStapNamen = parallelModel
      ? template.stappen
          .filter((s) => beginStatus!.get(s.volgorde) === "actief")
          .map((s) => s.naam)
      : [template.stappen[0]?.naam ?? ""];
    logEntries.push({
      procedure_id: procedure.id,
      event_type: "stap_gestart",
      actor_id: ctx.gebruikerId,
      actor_naam: ctx.naam || null,
      payload: parallelModel
        ? { parallel: true, actieve_stappen: actieveStapNamen }
        : { stap: actieveStapNamen[0] },
    });
    await supabase.from("procedure_log").insert(logEntries);

    return NextResponse.json({ procedure });
  } catch (e) {
    console.error("Fout in POST /api/procedures:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
