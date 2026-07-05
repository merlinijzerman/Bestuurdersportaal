import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase-server";
import { zoekRelevanteChunks, maakContext, verrijkNotulenChunks } from "@/lib/rag";
import { controleerLimiet, LIMIETEN } from "@/lib/rate-limit";
import { rateLimited } from "@/lib/api-errors";
import {
  bouwProfielsturingAgenda,
  type ProfielsturingAspecten,
} from "@/lib/profielsturing";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// FR-6 (increment "bestuurlijke duiding") — zelfde model als de chat-route,
// in één constante zodat een upgrade op één plek gebeurt.
const AI_MODEL = "claude-sonnet-4-6";

// Robuuste JSON-extractie uit een AI-respons. Strip eventuele code-fences en
// pak het fragment van de eerste '{' tot de laatste '}'. Samen met de
// assistant-prefill ('{') vangt dit de gevallen af waarin het model toch
// omringende tekst meelevert — de oorzaak van "AI-output kon niet geparseerd
// worden" bij agendapunten zonder gekoppelde stukken.
function parseAiJson(tekst: string): Record<string, unknown> {
  let s = tekst
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const eerste = s.indexOf("{");
  const laatste = s.lastIndexOf("}");
  if (eerste !== -1 && laatste !== -1 && laatste > eerste) {
    s = s.slice(eerste, laatste + 1);
  }
  return JSON.parse(s);
}

const SYSTEM_PROMPT = `U bent een ervaren sparringpartner voor het bestuur van een Nederlands pensioenfonds.

Uw taak: help een bestuurder een agendapunt voor te bereiden voor een vergadering. Begin met een BESTUURLIJKE DUIDING (wat betekent dit stuk, welk besluit wordt gevraagd, wie raakt het), toets het stuk vervolgens tegen de juiste lenzen, markeer blinde vlekken, en sluit af met vragen om mee de vergadering in te nemen.

LENZEN waarover u kunt nadenken (kies de 2-4 die ECHT van toepassing zijn op DIT stuk — niet alle):
* Stakeholder-impact: werkgevers, actieve deelnemers, gewezen deelnemers, pensioengerechtigden, ex-partners
* Pensioenregeling-principes: uitvoerbaarheid, financierbaarheid, uitlegbaarheid
* Bestuurlijke uitgangspunten: beheerst besluitvormingsproces, evenwichtige belangenafweging, intern toezicht informeren, verantwoording afleggen

REGELS:
- De duiding is het hoofdproduct. "betekenis": 2-4 zinnen — wat betekent dit stuk voor het fonds, in bestuurlijke taal. "gevraagd_besluit": 1-2 zinnen — welk besluit wordt van het bestuur gevraagd; is er geen besluit, schrijf dan expliciet dat het punt informatief is. "impact": 1-3 zinnen — gevolgen voor deelnemers, financiering, risico of uitvoering; noem alleen wat van toepassing is.
- BRONVERWIJZING VERPLICHT in de duiding: elke feitelijke claim krijgt direct erna een marker. [Bron N] voor claims uit de genummerde bronnen; [Toelichting agendapunt] voor claims die alleen op de toelichting van het agendapunt steunen; [Algemene kennis] voor vakkennis zonder fondsbron. Afzonderlijke claims krijgen afzonderlijke markers. Verzin NOOIT een bronnummer of vindplaats.
- Kies alleen de lenzen die er voor dit specifieke stuk toe doen. Het mag voorkomen dat een stuk vooral over ÉÉN lens gaat — zeg dat dan, dwing geen kunstmatige completeness.
- Per lens: één tot twee zinnen scherpe analyse en één gerichte open vraag aan de bestuurder. Gebruik [Bron N] waar dat de scherpte ten goede komt.
- Geen samenvatting van het stuk — daar dient een aparte AI-functie voor. U mag wel verwijzen naar specifieke onderdelen ("paragraaf 3.2 stelt X — maar laat onbenoemd Y").
- Wees concreet en kritisch. Vermijd algemene vragen zoals "is dit goed onderbouwd?" — vraag wat ER specifiek niet onderbouwd is.
- De vergadervragen zijn de afsluiter: 3 concrete kritische vragen die de bestuurder mee de vergadering in neemt.
- Ook als er weinig of geen stukken zijn aangeleverd, baseert u de voorbereiding op de titel en toelichting van het agendapunt plus uw vakkennis (markeer dan met [Toelichting agendapunt] / [Algemene kennis]). U levert dan tóch de volledige JSON — nooit een tekstuele mededeling dat er te weinig context is, en nooit een vraag terug.

OUTPUT: alleen JSON, geen markdown, geen omringende tekst. Begin uw antwoord direct met '{'. Exacte formaat:
{
  "duiding": {
    "betekenis": "2-4 zinnen: wat betekent dit stuk voor het fonds, met bronmarkers",
    "gevraagd_besluit": "1-2 zinnen: welk besluit wordt gevraagd, of expliciet 'geen besluit gevraagd — informatief'",
    "impact": "1-3 zinnen: wie/wat raakt dit (deelnemers, financiering, risico, uitvoering), met bronmarkers"
  },
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
  // Increment F (FO §14) — herleidbaarheid: welke profielvelden de
  // voorbereiding hebben gekleurd. "uitgeschakeld" bestaat hier (nog) niet:
  // agendaprep kent geen "algemeen perspectief"-toggle, dus alleen "actief"
  // (profiel gevuld) of "geen-profiel".
  profielsturing?: "actief" | "geen-profiel";
  profielsturing_aspecten?: ProfielsturingAspecten;
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

    // Rate limiting (WP2): vóór de RAG-/Anthropic-call.
    const limiet = await controleerLimiet(supabase, LIMIETEN.voorbereiding);
    if (!limiet.toegestaan) return rateLimited("agendapunten.voorbereiding", limiet.resetAt);

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

    // Increment F (FO §14) — profielgestuurde NADRUK. De voorbereiding wordt
    // per gebruiker gegenereerd en opgeslagen (gebruiker_id), dus personalisatie
    // is hier passend. KERNPRINCIPE: prioriteren/nadruk, niet inperken — de
    // bestuurlijk noodzakelijke lenzen blijven leidend (zie steering-tekst).
    const profielsturing = await bouwProfielsturingAgenda(supabase, user.id);

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
    // Gedeactiveerde documenten worden uitgesloten als context.
    const { data: stukken } = await supabase
      .from("documenten")
      .select("id, titel, bron, samenvatting_ai, opslag_pad")
      .eq("agendapunt_id", id)
      .eq("actief", true);

    // RAG over bibliotheek. Increment G — agendaprep gebruikt uitsluitend de
    // ACTUELE bron (concept/verlopen/vervangen tellen niet mee als actuele basis
    // voor een vergadering); peildatum = vandaag.
    const ragQuery = `${agendapunt.titel} ${agendapunt.beschrijving ?? ""}`.trim();
    const ragMax = diepte === "grondig" ? 10 : 4;
    const chunks = await verrijkNotulenChunks(
      await zoekRelevanteChunks(ragQuery, profiel.fonds_id, ragMax, {
        modus: "actueel",
        peildatum: new Date().toISOString().slice(0, 10),
      })
    );
    // FR-4 — één doorlopende bronnummering: gekoppelde stukken eerst
    // ([Bron 1..k]), daarna de bibliotheek-chunks ([Bron k+1..]). Dezelfde
    // nummering gaat als `bronnen` mee in ai_output, zodat pill N in de UI
    // altijd naar bron N in de lijst verwijst.
    const aantalStukken = (stukken || []).length;
    const { contextTekst: bibliotheekContext, bronnen: bibBronnen } = maakContext(
      chunks,
      aantalStukken
    );

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

    if (profielsturing) {
      userParts.push(`\n${profielsturing.tekst}`);
    }

    userParts.push(
      `\n=== UW OPDRACHT ===\nGenereer de voorbereiding voor dit agendapunt volgens het JSON-formaat in de systeem-prompt. Diepte: ${diepte}.`
    );

    const userMessage = userParts.join("\n");

    const respons = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: diepte === "grondig" ? 2500 : 1500,
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: userMessage },
        // Prefill met '{' dwingt het model tot directe JSON-output, ook bij
        // dunne input (alleen een toelichting, geen stukken). Dit is de
        // hoofdoorzaak van parse-fouten: zonder prefill antwoordt het model dan
        // soms in proza. Zie parseAiJson() voor de robuuste extractie.
        { role: "assistant", content: "{" },
      ],
    });

    const blok = respons.content.find((c) => c.type === "text");
    // De prefill '{' zit niet in de respons; plak terug aan de kop.
    const ruweTekst = `{${blok && blok.type === "text" ? blok.text : ""}`.trim();

    let aiOutput: {
      duiding?: { betekenis?: string; gevraagd_besluit?: string; impact?: string };
      lenzen?: { naam: string; analyse: string; vraag: string }[];
      ontbrekend?: string[];
      vergadervragen?: string[];
      samenvatting?: string;
    } = {};
    try {
      aiOutput = parseAiJson(ruweTekst) as typeof aiOutput;
    } catch (parseErr) {
      console.error("JSON-parse fout in voorbereiding:", parseErr, ruweTekst);
      return NextResponse.json(
        { error: "AI-output kon niet geparseerd worden, probeer opnieuw." },
        { status: 502 }
      );
    }

    // FR-4 — de genummerde bronlijst waarnaar de [Bron N]-markers verwijzen:
    // eerst de gekoppelde stukken (1..k), dan de bibliotheek-chunks (k+1..).
    // Zelfde vorm als de chat-route (BronVerwijzing) zodat CitatieTekst en het
    // onderbouwingsblok in de UI identiek kunnen renderen. Opslag als extra
    // veld in het bestaande ai_output-jsonb — geen schemawijziging.
    const bronnenLijst = [
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
      profielsturing: profielsturing ? "actief" : "geen-profiel",
      ...(profielsturing
        ? { profielsturing_aspecten: profielsturing.aspecten }
        : {}),
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
          ai_output: { ...aiOutput, bronnen: bronnenLijst },
          bronnen_meta: bronnenMeta,
          gegenereerd_op: new Date().toISOString(),
          bijgewerkt_op: new Date().toISOString(),
        })
        .eq("id", bestaand.id)
        .select()
        .single();
      if (error) {
        console.error("Voorbereiding update fout:", error);
        return NextResponse.json({ error: "Voorbereiding bijwerken mislukt" }, { status: 500 });
      }
      voorbereiding = updated;
    } else {
      const { data: ingevoegd, error } = await supabase
        .from("voorbereidingen")
        .insert({
          agendapunt_id: id,
          gebruiker_id: user.id,
          diepte,
          ai_output: { ...aiOutput, bronnen: bronnenLijst },
          eigen_notities: {},
          bronnen_meta: bronnenMeta,
        })
        .select()
        .single();
      if (error) {
        console.error("Voorbereiding aanmaken fout:", error);
        return NextResponse.json({ error: "Voorbereiding aanmaken mislukt" }, { status: 500 });
      }
      voorbereiding = ingevoegd;
    }

    return NextResponse.json({ voorbereiding });
  } catch (e) {
    console.error("Fout in voorbereiding-genereren:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
