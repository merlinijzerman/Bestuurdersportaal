import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { zoekRelevanteChunks, maakContext, verrijkNotulenChunks } from "@/core/lib/rag";
import { controleerLimiet, LIMIETEN } from "@/core/lib/rate-limit";
import { rateLimited } from "@/core/lib/api-errors";
import { bouwProfielsturingAgenda } from "@/core/lib/profielsturing";
import { bouwOrganisatieprofiel } from "@/core/lib/organisatieprofiel";
// Eén gedeelde modelconstante (env-overschrijfbaar) i.p.v. een eigen hardcoded
// string — voorkomt dat de agendavoorbereiding op een ander model draait dan de
// chat-route na een modelwissel.
import { AI_MODEL } from "@/core/lib/generatie-kern";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

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

    // OP-3 (FO Organisatieprofiel v0.4 §6, B3) — organisatiecontext van het eigen fonds.
    const organisatieprofiel = await bouwOrganisatieprofiel(supabase, profiel.fonds_id);

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

    if (organisatieprofiel) {
      userParts.push(`\n${organisatieprofiel.tekst}`);
    }

    if (profielsturing) {
      userParts.push(`\n${profielsturing.tekst}`);
    }

    userParts.push(
      `\n=== UW OPDRACHT ===\nStel de voorbereiding op voor dit agendapunt volgens de opbouw en regels in de systeem-prompt.`
    );

    // De genummerde bronlijst waarnaar de [Bron N]-markers verwijzen — zelfde
    // vorm als de chat-route (BronVerwijzing), zodat de chat-UI het bericht
    // identiek rendert (pills + onderbouwingsblok). Vóór de model-call opgebouwd
    // zodat we het onderbouwingsblok meteen met het meta-event kunnen meesturen.
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

    // Bronbasis-melding (uitlegbaarheid). Zonder genummerde fondsbronnen steunt de
    // voorbereiding op de toelichting van het agendapunt en algemene kennis; dan is
    // er geen "Onderbouwing en bronnen"-blok, dus tonen we een expliciete melding
    // zodat de bestuurder de basis ziet. Zijn er wél bronnen, dan draagt het
    // onderbouwingsblok die transparantie al (rustige weergave — geen melding).
    const inlineMeldingen =
      bronnen.length === 0
        ? [
            {
              type: "geen_fondstreffer",
              tekst:
                "Geen gekoppelde fondsstukken gevonden. Deze voorbereiding steunt op de toelichting van het agendapunt en algemene kennis; verifieer bij formele besluitvorming.",
            },
          ]
        : [];

    // Streaming (SSE): het antwoord wordt token voor token opgebouwd i.p.v. in één
    // keer volledig geladen — bij een trager model (Opus) voelt dat sneller en
    // houdt het de bestuurder betrokken. Zelfde event-vorm als /api/chat
    // (meta → delta → done), zodat AgendapuntChat dezelfde consumer hergebruikt.
    // max_tokens 3500: bij een te krap budget sneuvelt de staart (de vergadervragen).
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          // Bronnen + melding vooraf: onderbouwingsblok en melding staan er meteen,
          // terwijl de tekst nog binnenkomt.
          send({ type: "meta", bronnen, inline_meldingen: inlineMeldingen });

          let volledig = "";
          const claudeStream = anthropic.messages.stream({
            model: AI_MODEL,
            max_tokens: 3500,
            // SYSTEM_PROMPT is volledig statisch → cache-breakpoint (ephemeral),
            // zelfde patroon als bouwSysteemBlokken in de chat-route.
            system: [
              { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
            ],
            messages: [{ role: "user", content: userParts.join("\n") }],
          });
          claudeStream.on("text", (delta) => {
            volledig += delta;
            send({ type: "delta", text: delta });
          });

          const finaal = await claudeStream.finalMessage();
          // Afkapping niet stil laten passeren (herleidbaar in de serverlog).
          if (finaal.stop_reason === "max_tokens") {
            console.warn(
              `Voorbereiding agendapunt ${id}: antwoord afgekapt op max_tokens — vergadervragen mogelijk onvolledig.`
            );
          }
          if (!volledig.trim()) {
            send({ type: "error", error: "Geen antwoord ontvangen, probeer opnieuw." });
          } else {
            send({ type: "done" });
          }
        } catch (e) {
          console.error("Fout in voorbereiding-streamen:", e);
          send({ type: "error", error: "Serverfout" });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    console.error("Fout in voorbereiding-genereren:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
