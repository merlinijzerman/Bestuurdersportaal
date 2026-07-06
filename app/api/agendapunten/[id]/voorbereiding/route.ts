import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase-server";
import { zoekRelevanteChunks, maakContext, verrijkNotulenChunks } from "@/lib/rag";
import { controleerLimiet, LIMIETEN } from "@/lib/rate-limit";
import { rateLimited } from "@/lib/api-errors";
import { bouwProfielsturingAgenda } from "@/lib/profielsturing";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// Zelfde model als de chat-route, in één constante.
const AI_MODEL = "claude-sonnet-4-6";

// ============================================================
//  Voorbereiding als gespreksopener (06-07, herziening FO duiding)
// ============================================================
// De eerdere opzet (gestructureerd JSON-product in een eigen blok) is op
// verzoek van de opdrachtgever vervangen: "Genereer voorbereiding" levert nu
// een leesbaar bericht met [Bron N]-markers dat de client als eerste
// AI-beurt in het agendapunt-gesprek plaatst (zelfde weergave en
// bronvermelding als de assistent). Deze route behoudt de rijke context
// (stukken, bibliotheek, risicomatrix, procedures, profielsturing) die de
// chat-route niet heeft. Er wordt hier niets meer in `voorbereidingen`
// geschreven — die tabel dient nog uitsluitend voor eigen aantekeningen.
// Oude versie: Archief/ + git-historie.

const SYSTEM_PROMPT = `U bent een ervaren sparringpartner voor het bestuur van een Nederlands pensioenfonds.

Uw taak: stel voor een bestuurder de voorbereiding op voor een agendapunt van een vergadering. Uw antwoord opent een gesprek — de bestuurder kan erop doorvragen.

OPBOUW van uw antwoord (gebruik deze kopjes, vet gemarkeerd):
**Bestuurlijke duiding** — 2-4 zinnen: wat betekent dit stuk voor het fonds, in bestuurlijke taal. Daarna 1-2 zinnen: welk besluit wordt van het bestuur gevraagd (of expliciet: geen besluit gevraagd — informatief). Daarna 1-3 zinnen impact: gevolgen voor deelnemers, financiering, risico of uitvoering — alleen wat van toepassing is.
**Aandachtspunten** — de 2-4 invalshoeken die er voor DIT stuk echt toe doen (stakeholder-impact, uitvoerbaarheid/financierbaarheid/uitlegbaarheid, beheerst besluitvormingsproces, evenwichtige belangenafweging), elk één tot twee zinnen scherpe analyse. Benoem ook wat er níet in het stuk staat maar wel relevant is.
**Neem mee de vergadering in** — 3 concrete kritische vragen om in de vergadering te stellen.

REGELS:
- BRONVERWIJZING VERPLICHT: elke feitelijke claim krijgt direct erna een marker. [Bron N] voor claims uit de genummerde bronnen; [Toelichting agendapunt] voor claims die alleen op de toelichting van het agendapunt steunen; [Algemene kennis] voor vakkennis zonder fondsbron. Afzonderlijke claims krijgen afzonderlijke markers. Verzin NOOIT een bronnummer of vindplaats.
- Geen samenvatting van het stuk — daar dient een aparte AI-functie voor. U mag wel verwijzen naar specifieke onderdelen ("paragraaf 3.2 stelt X — maar laat onbenoemd Y").
- Wees concreet en kritisch. Vermijd algemene vragen zoals "is dit goed onderbouwd?" — vraag wat ER specifiek niet onderbouwd is.
- Ook als er weinig of geen stukken zijn aangeleverd, baseert u de voorbereiding op de titel en toelichting van het agendapunt plus uw vakkennis (markeer dan met [Toelichting agendapunt] / [Algemene kennis]). Nooit een mededeling dat er te weinig context is, en nooit een vraag terug.
- Schrijf compact: dit is een gespreksopener, geen rapport. Geen inleiding of afsluiting buiten de drie kopjes.`;

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

    // Rate limiting (WP2): vóór de RAG-/Anthropic-call.
    const limiet = await controleerLimiet(supabase, LIMIETEN.voorbereiding);
    if (!limiet.toegestaan) return rateLimited("agendapunten.voorbereiding", limiet.resetAt);

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

    // Increment F (FO §14) — profielgestuurde NADRUK: prioriteren, niet inperken.
    const profielsturing = await bouwProfielsturingAgenda(supabase, user.id);

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

    // Gekoppelde stukken; gedeactiveerde documenten uitgesloten.
    const { data: stukken } = await supabase
      .from("documenten")
      .select("id, titel, bron, samenvatting_ai, opslag_pad")
      .eq("agendapunt_id", id)
      .eq("actief", true);

    // RAG over bibliotheek (vaste diepte sinds 06-07: de aparte snel/grondig-
    // keuze is vervallen, doorvragen in het gesprek compenseert).
    // Increment G — alleen de ACTUELE bron, peildatum = vandaag.
    const ragQuery = `${agendapunt.titel} ${agendapunt.beschrijving ?? ""}`.trim();
    const chunks = await verrijkNotulenChunks(
      await zoekRelevanteChunks(ragQuery, profiel.fonds_id, 10, {
        modus: "actueel",
        peildatum: new Date().toISOString().slice(0, 10),
      })
    );
    // Eén doorlopende bronnummering: gekoppelde stukken eerst ([Bron 1..k]),
    // daarna de bibliotheek-chunks ([Bron k+1..]).
    const aantalStukken = (stukken || []).length;
    const { contextTekst: bibliotheekContext, bronnen: bibBronnen } = maakContext(
      chunks,
      aantalStukken
    );

    // Actieve risico's van het fonds
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

    const stukkenLijst = (stukken || []) as Array<{
      id: string;
      titel: string;
      bron: string;
      samenvatting_ai: string | null;
      opslag_pad: string | null;
    }>;

    // Samenvatting_ai is (meestal) een JSON-string; maak er leesbare tekst van.
    const leesbareSamenvatting = (raw: string | null): string | null => {
      if (!raw) return null;
      try {
        const obj = JSON.parse(raw);
        return Object.entries(obj)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n");
      } catch {
        return raw;
      }
    };

    const userParts: string[] = [
      `=== AGENDAPUNT ===`,
      `Titel: ${agendapunt.titel}`,
      `Categorie: ${agendapunt.categorie ?? "informatie"}`,
      agendapunt.beschrijving
        ? `Beschrijving:\n${agendapunt.beschrijving}`
        : "(Geen beschrijving)",
    ];

    if (stukkenLijst.length > 0) {
      userParts.push(
        `\n=== GEKOPPELDE STUKKEN BIJ DIT AGENDAPUNT (genummerde bronnen) ===`
      );
      stukkenLijst.forEach((s, i) => {
        userParts.push(`\n[Bron ${i + 1}] ${s.titel} (${s.bron}):`);
        userParts.push(
          leesbareSamenvatting(s.samenvatting_ai) ??
            "(Nog geen samenvatting beschikbaar)"
        );
      });
    } else {
      userParts.push(
        `\n=== GEKOPPELDE STUKKEN ===\n(Geen stukken aan dit agendapunt gekoppeld)`
      );
    }

    if (chunks.length > 0) {
      userParts.push(`\n=== BREDERE BIBLIOTHEEK (genummerde bronnen, vervolg) ===`);
      userParts.push(bibliotheekContext);
    }

    const risicosLijst = risicos || [];
    if (risicosLijst.length > 0) {
      userParts.push(`\n=== ACTIEVE RISICO'S VAN HET FONDS ===`);
      for (const r of risicosLijst) {
        userParts.push(
          `- [${r.niveau.toUpperCase()}] ${r.titel} (${r.categorie}, ${r.type_risico})${r.toelichting ? ` — ${r.toelichting.slice(0, 200)}` : ""}`
        );
      }
    }

    const proceduresLijst = procedures || [];
    if (proceduresLijst.length > 0) {
      userParts.push(`\n=== LOPENDE PROCEDURES ===`);
      for (const p of proceduresLijst) {
        userParts.push(
          `- ${p.titel} (${p.template_code}, ${p.status})${p.beschrijving ? ` — ${p.beschrijving.slice(0, 200)}` : ""}`
        );
      }
    }

    if (profielsturing) {
      userParts.push(`\n${profielsturing.tekst}`);
    }

    userParts.push(
      `\n=== UW OPDRACHT ===\nStel de voorbereiding op voor dit agendapunt volgens de opbouw en regels in de systeem-prompt.`
    );

    const respons = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userParts.join("\n") }],
    });

    const blok = respons.content.find((c) => c.type === "text");
    const tekst = (blok && blok.type === "text" ? blok.text : "").trim();
    if (!tekst) {
      return NextResponse.json(
        { error: "Geen antwoord ontvangen, probeer opnieuw." },
        { status: 502 }
      );
    }

    // De genummerde bronlijst waarnaar de [Bron N]-markers verwijzen — zelfde
    // vorm als de chat-route (BronVerwijzing), zodat de chat-UI het bericht
    // identiek rendert (pills + onderbouwingsblok).
    const bronnen = [
      ...stukkenLijst.map((s) => ({
        document_id: s.id,
        titel: s.titel,
        bron: s.bron,
        pagina: null as number | null,
        paragraaf: null as string | null,
        fragment: (leesbareSamenvatting(s.samenvatting_ai) ?? "").slice(0, 150),
        heeft_origineel: !!s.opslag_pad,
      })),
      ...bibBronnen,
    ];

    return NextResponse.json({ tekst, bronnen });
  } catch (e) {
    console.error("Fout in voorbereiding-genereren:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
