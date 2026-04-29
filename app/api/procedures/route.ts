import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { vindTemplate } from "@/lib/proces-templates";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const body = (await req.json()) as {
      template_code?: string;
      titel?: string;
      beschrijving?: string | null;
      deadline?: string | null;
      eigenaren?: string[];
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

    const { data: profiel } = await supabase
      .from("profielen")
      .select("fonds_id, naam")
      .eq("id", user.id)
      .single();
    if (!profiel?.fonds_id) {
      return NextResponse.json(
        { error: "Geen fonds gekoppeld aan profiel" },
        { status: 400 }
      );
    }

    // 1. Procedure aanmaken
    const { data: procedure, error: procFout } = await supabase
      .from("procedures")
      .insert({
        fonds_id: profiel.fonds_id,
        template_code: templateCode,
        titel,
        beschrijving: body.beschrijving || null,
        deadline: body.deadline || null,
        status: "in_uitvoering",
        gestart_door: user.id,
      })
      .select()
      .single();

    if (procFout || !procedure) {
      console.error("Procedure aanmaken fout:", procFout);
      return NextResponse.json(
        { error: procFout?.message || "Aanmaken mislukt" },
        { status: 500 }
      );
    }

    // 2. Eigenaars (maker is altijd eigenaar; plus opgegeven namen)
    const eigenarenNamen = new Set<string>();
    if (profiel.naam) eigenarenNamen.add(profiel.naam);
    for (const n of body.eigenaren || []) {
      if (n.trim()) eigenarenNamen.add(n.trim());
    }
    if (eigenarenNamen.size > 0) {
      await supabase.from("procedure_eigenaars").insert(
        Array.from(eigenarenNamen).map((naam) => ({
          procedure_id: procedure.id,
          gebruiker_id: naam === profiel.naam ? user.id : null,
          gebruiker_naam: naam,
        }))
      );
    }

    // 3. Stappen + checklist snapshot
    // Eerste stap meteen op 'actief', rest op 'open'
    for (const tStap of template.stappen) {
      const { data: stap } = await supabase
        .from("procedure_stappen")
        .insert({
          procedure_id: procedure.id,
          volgorde: tStap.volgorde,
          naam: tStap.naam,
          beschrijving: tStap.beschrijving,
          vereist_besluit: tStap.vereist_besluit,
          geschatte_dagen: tStap.geschatte_dagen,
          status: tStap.volgorde === 1 ? "actief" : "open",
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
        actor_id: user.id,
        actor_naam: profiel.naam || null,
        payload: { template: template.naam },
      },
    ];
    for (const naam of body.eigenaren || []) {
      if (naam.trim() && naam.trim() !== profiel.naam) {
        logEntries.push({
          procedure_id: procedure.id,
          event_type: "eigenaar_toegevoegd",
          actor_id: user.id,
          actor_naam: profiel.naam || null,
          payload: { naam: naam.trim() },
        });
      }
    }
    logEntries.push({
      procedure_id: procedure.id,
      event_type: "stap_gestart",
      actor_id: user.id,
      actor_naam: profiel.naam || null,
      payload: { stap: template.stappen[0]?.naam ?? "" },
    });
    await supabase.from("procedure_log").insert(logEntries);

    return NextResponse.json({ procedure });
  } catch (e) {
    console.error("Fout in POST /api/procedures:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
