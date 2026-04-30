import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase-server";
import { zoekRelevanteChunks, maakContext } from "@/lib/rag";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SYSTEM_PROMPT = `U bent een ervaren sparringpartner voor het bestuur van een Nederlands pensioenfonds.

Uw taak: help een bestuurder een agendapunt voor te bereiden voor een vergadering. Niet door het stuk samen te vatten, maar door scherper te denken — door blinde vlekken te markeren, kritische vragen te formuleren, en het stuk te toetsen tegen de juiste lenzen.

LENZEN waarover u kunt nadenken (kies de 2-4 die ECHT van toepassing zijn op DIT stuk — niet alle):
* Stakeholder-impact: werkgevers, actieve deelnemers, gewezen deelnemers, pensioengerechtigden, ex-partners
* Pensioenregeling-principes: uitvoerbaarheid, financierbaarheid, uitlegbaarheid
* Bestuurlijke uitgangspunten: beheerst besluitvormingsproces, evenwichtige belangenafweging, intern toezicht informeren, verantwoording afleggen

REGELS:
- Kies alleen de lenzen die er voor dit specifieke stuk toe doen. Het mag voorkomen dat een stuk vooral over ÉÉN lens gaat — zeg dat dan, dwing geen kunstmatige completeness.
- Per lens: één tot twee zinnen scherpe analyse en één gerichte open vraag aan de bestuurder.
- Geen samenvatting van het stuk — daar dient een aparte AI-functie voor. U mag wel verwijzen naar specifieke onderdelen ("paragraaf 3.2 stelt X — maar laat onbenoemd Y").
- Wees concreet en kritisch. Vermijd algemene vragen zoals "is dit goed onderbouwd?" — vraag wat ER specifiek niet onderbouwd is.
- Verwijs naar bronnen met [Bron N] notatie waar dat de scherpte ten goede komt. Niet als opsomming.

OUTPUT: alleen JSON, geen markdown. Exacte formaat:
{
  "lenzen": [
    {
      "naam": "korte label, bv. 'Stakeholder-impact: gepensioneerden'",
      "analyse": "1-2 zinnen scherpe analyse",
      "vraag": "1 gerichte open vraag aan de bestuurder"
    }
  ],
  "ontbrekend": [
    "Korte zin: wat staat er niet maar zou wel relevant zijn (2-3 items, of leeg array als alles afgedekt is)"
  ],
  "vergadervragen": [
    "3 concrete kritische vragen om in de vergadering te stellen"
  ],
  "samenvatting": "Eén zin: hoe scherp is dit stuk afgedekt? (bv. 'Dit voorstel is op de financiële kant goed onderbouwd, maar uitlegbaarheid voor jongere deelnemers blijft onderbelicht.')"
}`;

interface BronnenMeta {
  documenten: { id: string; titel: string; bron: string }[];
  risicos: { id: string; titel: string; niveau: string }[];
  procedures: { id: string; titel: string; status: string }[];
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      diepte?: "snel" | "grondig";
    };
    const diepte: "snel" | "grondig" = body.diepte === "grondig" ? "grondig" : "snel";

    // Profiel + fonds-context
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

    // Agendapunt + vergadering + bovenliggende procedure (indien gekoppeld)
    const { data: agendapunt } = await supabase
      .from("agendapunten")
      .select(
        "id, titel, beschrijving, categorie, vergadering_id, procedure_stap_id, vergaderingen(titel, datum)"
      )
      .eq("id", id)
      .single();
    if (!agendapunt) {
      return NextResponse.json(
        { error: "Agendapunt niet gevonden" },
        { status: 404 }
      );
    }

    // Gekoppelde stukken (uit documenten met deze agendapunt_id)
    const { data: stukken } = await supabase
      .from("documenten")
      .select("id, titel, bron, samenvatting_ai")
      .eq("agendapunt_id", id);

    // RAG over bibliotheek
    const ragQuery = `${agendapunt.titel} ${agendapunt.beschrijving ?? ""}`.trim();
    const ragMax = diepte === "grondig" ? 10 : 4;
    const chunks = await zoekRelevanteChunks(ragQuery, profiel.fonds_id, ragMax);
    const { contextTekst: bibliotheekContext, bronnen: bibBronnen } = maakContext(chunks);

    // Actieve risicos van het fonds
    const { data: risicos } = await supabase
      .from("risicos")
      .select("id, titel, toelichting, niveau, type_risico, categorie")
      .eq("fonds_id", profiel.fonds_id)
      .eq("status", "actief")
      .order("niveau", { ascending: false })
      .limit(15);

    // Lopende procedures van het fonds
    const { data: procedures } = await supabase
      .from("procedures")
      .select("id, titel, beschrijving, status, template_code")
      .eq("fonds_id", profiel.fonds_id)
      .neq("status", "afgerond")
      .order("gestart_op", { ascending: false })
      .limit(10);

    // Build user message met alle context
    const stukkenLijst = (stukken || []) as Array<{
      id: string;
      titel: string;
      bron: string;
      samenvatting_ai: string | null;
    }>;
    const risicosLijst = (risicos || []) as Array<{
      id: string;
      titel: string;
      toelichting: string | null;
      niveau: string;
      type_risico: string;
      categorie: string;
    }>;
    const proceduresLijst = (procedures || []) as Array<{
      id: string;
      titel: string;
      beschrijving: string | null;
      status: string;
      template_code: string;
    }>;

    const userParts: string[] = [
      `=== AGENDAPUNT ===`,
      `Titel: ${agendapunt.titel}`,
      `Categorie: ${agendapunt.categorie ?? "informatie"}`,
      agendapunt.beschrijving
        ? `Beschrijving:\n${agendapunt.beschrijving}`
        : "(Geen beschrijving)",
    ];

    if (stukkenLijst.length > 0) {
      userParts.push(`\n=== GEKOPPELDE STUKKEN BIJ DIT AGENDAPUNT ===`);
      for (const s of stukkenLijst) {
        userParts.push(`\n--- ${s.titel} (${s.bron}) ---`);
        if (s.samenvatting_ai) {
          // Samenvatting is JSON-string, probeer te parsen
          let leesbaar = s.samenvatting_ai;
          try {
            const obj = JSON.parse(s.samenvatting_ai);
            leesbaar = Object.entries(obj)
              .map(([k, v]) => `${k}: ${v}`)
              .join("\n");
          } catch {
            // niet JSON, gebruik raw
          }
          userParts.push(leesbaar);
        } else {
          userParts.push("(Nog geen samenvatting beschikbaar)");
        }
      }
    } else {
      userParts.push(
        `\n=== GEKOPPELDE STUKKEN ===\n(Geen stukken aan dit agendapunt gekoppeld)`
      );
    }

    if (chunks.length > 0) {
      userParts.push(`\n=== BREDERE BIBLIOTHEEK (RAG) ===`);
      userParts.push(bibliotheekContext);
    }

    if (risicosLijst.length > 0) {
      userParts.push(`\n=== ACTIEVE RISICO'S VAN HET FONDS ===`);
      for (const r of risicosLijst) {
        userParts.push(
          `- [${r.niveau.toUpperCase()}] ${r.titel} (${r.categorie}, ${r.type_risico})${r.toelichting ? ` — ${r.toelichting.slice(0, 200)}` : ""}`
        );
      }
    }

    if (proceduresLijst.length > 0) {
      userParts.push(`\n=== LOPENDE PROCEDURES ===`);
      for (const p of proceduresLijst) {
        userParts.push(
          `- ${p.titel} (${p.template_code}, ${p.status})${p.beschrijving ? ` — ${p.beschrijving.slice(0, 200)}` : ""}`
        );
      }
    }

    userParts.push(
      `\n=== UW OPDRACHT ===\nGenereer de voorbereiding voor dit agendapunt volgens het JSON-formaat in de systeem-prompt. Diepte: ${diepte}.`
    );

    const userMessage = userParts.join("\n");

    const respons = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: diepte === "grondig" ? 2500 : 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const blok = respons.content.find((c) => c.type === "text");
    const ruweTekst = blok && blok.type === "text" ? blok.text.trim() : "";

    let aiOutput: {
      lenzen?: { naam: string; analyse: string; vraag: string }[];
      ontbrekend?: string[];
      vergadervragen?: string[];
      samenvatting?: string;
    } = {};
    try {
      const cleaned = ruweTekst
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "");
      aiOutput = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("JSON-parse fout in voorbereiding:", parseErr, ruweTekst);
      return NextResponse.json(
        { error: "AI-output kon niet geparseerd worden, probeer opnieuw." },
        { status: 502 }
      );
    }

    const bronnenMeta: BronnenMeta = {
      documenten: [
        ...stukkenLijst.map((s) => ({ id: s.id, titel: s.titel, bron: s.bron })),
        ...bibBronnen.map((b) => ({
          id: b.document_id,
          titel: b.titel,
          bron: b.bron,
        })),
      ],
      risicos: risicosLijst.map((r) => ({
        id: r.id,
        titel: r.titel,
        niveau: r.niveau,
      })),
      procedures: proceduresLijst.map((p) => ({
        id: p.id,
        titel: p.titel,
        status: p.status,
      })),
    };

    // Upsert in voorbereidingen-tabel
    const { data: bestaand } = await supabase
      .from("voorbereidingen")
      .select("id, eigen_notities")
      .eq("agendapunt_id", id)
      .eq("gebruiker_id", user.id)
      .maybeSingle();

    let voorbereiding;
    if (bestaand) {
      const { data: updated, error } = await supabase
        .from("voorbereidingen")
        .update({
          diepte,
          ai_output: aiOutput,
          bronnen_meta: bronnenMeta,
          gegenereerd_op: new Date().toISOString(),
          bijgewerkt_op: new Date().toISOString(),
        })
        .eq("id", bestaand.id)
        .select()
        .single();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      voorbereiding = updated;
    } else {
      const { data: ingevoegd, error } = await supabase
        .from("voorbereidingen")
        .insert({
          agendapunt_id: id,
          gebruiker_id: user.id,
          diepte,
          ai_output: aiOutput,
          eigen_notities: {},
          bronnen_meta: bronnenMeta,
        })
        .select()
        .single();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      voorbereiding = ingevoegd;
    }

    return NextResponse.json({ voorbereiding });
  } catch (e) {
    console.error("Fout in voorbereiding-genereren:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
