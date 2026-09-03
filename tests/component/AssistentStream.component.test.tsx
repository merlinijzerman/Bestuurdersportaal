// ============================================================================
//  De SSE-verwerking van de assistent, met een GESCRIPTE eventreeks.
// ----------------------------------------------------------------------------
//  Waarom deze test bestaat (P1a, besluit 0201): de stroomverwerking is het
//  brosste pad van de assistent — acht eventsoorten, een antwoord dat per delta
//  wordt herschreven, een terugvraag die 'done' moet negeren, en een
//  reflectiestatus die alleen van de server mag komen. Tot nu toe was dat
//  uitsluitend met de hand na te spelen, en juist de randgevallen (een
//  afgebroken stream, een event dat over twee reads valt) speelt niemand
//  betrouwbaar na.
//
//  De test is geschreven tegen de ORIGINELE implementatie, vóór de splitsing in
//  lagen. Wordt hij daarna rood, dan is dat per definitie een fout in de
//  refactor en niet in de test.
// ============================================================================

import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AssistentOppervlak from "@/app/(dashboard)/ai/_components/AssistentOppervlak";
import { AssistentHarnas } from "./assistent-harnas";
import { verwachtChatStream } from "./fetch-mock";
import { renderMetProviders } from "./render-met-providers";
import { maakSupabaseStub } from "./supabase-mock";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/core/lib/supabase", () => ({ createClient }));

// jsdom kent `scrollIntoView` niet; de assistent scrolt na elke beurt naar de
// gestelde vraag. Puur een omgevingsgat, geen gedrag dat deze test toetst.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function monteer() {
  createClient.mockReturnValue(
    maakSupabaseStub({
      tabellen: {
        profielen: {
          fonds_id: "fonds-1",
          naam: "Anne de Vries",
          rol: "bestuurder",
          standaard_ai_modus: null,
          reflectie_uitnodiging: false,
          fondsen: { naam: "Pensioenfonds Horizon" },
        },
        gesprekken: [],
      },
    }),
  );
  return renderMetProviders(
    <AssistentHarnas>
      <AssistentOppervlak />
    </AssistentHarnas>,
  );
}

/** Stelt een vraag via de invoerbalk en wacht tot de stream is verwerkt. */
async function stelVraag(user: ReturnType<typeof renderMetProviders>["user"]) {
  const veld = await screen.findByPlaceholderText(/Stel een vraag/);
  await user.type(veld, "Wat is onze dekkingsgraad?");
  await user.click(screen.getByRole("button", { name: "Vraag versturen" }));
}

const META = {
  type: "meta",
  modus: "combineren",
  antwoordmodus: "feitelijk",
  bronbasis: "Fondsdocumenten",
  bronnen: [
    {
      document_id: "d1",
      titel: "Actuariële en bedrijfstechnische nota",
      bron: "Intern",
      pagina: 12,
      paragraaf: null,
      fragment: "De beleidsdekkingsgraad bedroeg 118,4%.",
      heeft_origineel: true,
    },
  ],
};

describe("AssistentClient — SSE-verwerking", () => {
  it("bouwt een antwoord op uit losse delta's en sluit het af op 'done'", async () => {
    const { user } = monteer();
    verwachtChatStream(
      [
        { type: "progress", fase: "retrieval", status: "bezig", label: "Bronnen zoeken" },
        META,
        { type: "delta", text: "De beleidsdekkingsgraad " },
        { type: "delta", text: "bedroeg 118,4%." },
        { type: "done", log_id: "log-1" },
      ],
      // Knip de stroom in stukken, zodat een event over twee reads heen valt.
      { knip: 7 },
    );

    await stelVraag(user);

    await waitFor(() =>
      expect(screen.getByText(/De beleidsdekkingsgraad bedroeg 118,4%\./)).toBeInTheDocument(),
    );
    // Alleen een NETJES afgeronde generatie is kopieerbaar (besluit 0098 §4).
    expect(await screen.findByRole("button", { name: /Antwoord kopiëren/ })).toBeInTheDocument();
  });

  it("geeft een afgebroken stream GEEN kopieerknop", async () => {
    // Geen 'done': de verbinding viel weg. De tekst die er is blijft staan,
    // maar een kopie met een volledige herkomstregel eronder zou meer
    // suggereren dan er staat (besluit 0098 §4).
    const { user } = monteer();
    verwachtChatStream([META, { type: "delta", text: "De beleidsdekkingsgraad " }]);

    await stelVraag(user);

    await waitFor(() =>
      expect(screen.getByText(/De beleidsdekkingsgraad/)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /Antwoord kopiëren/ })).not.toBeInTheDocument();
  });

  it("toont bij een verduidelijking de chips en laat 'done' de bubbel ongemoeid", async () => {
    const { user } = monteer();
    verwachtChatStream([
      {
        type: "verduidelijking",
        vraag: "Wilt u dit weten voor uw fonds specifiek, of in algemene zin?",
        opties: [
          { intent: "fonds", label: "Voor mijn fonds" },
          { intent: "algemeen", label: "In algemene zin" },
        ],
      },
      { type: "done" },
    ]);

    await stelVraag(user);

    expect(
      await screen.findByRole("button", { name: "Voor mijn fonds" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "In algemene zin" })).toBeInTheDocument();
    expect(
      screen.getByText(/Wilt u dit weten voor uw fonds specifiek/),
    ).toBeInTheDocument();
    // De terugvraag is geen antwoord: geen kopieerknop.
    expect(screen.queryByRole("button", { name: /Antwoord kopiëren/ })).not.toBeInTheDocument();
  });

  it("toont een foutevent als bericht wanneer er nog geen antwoord staat", async () => {
    const { user } = monteer();
    verwachtChatStream([{ type: "error", error: "De AI-poort staat dicht." }]);

    await stelVraag(user);

    expect(await screen.findByText("De AI-poort staat dicht.")).toBeInTheDocument();
  });

  it("negeert onleesbare events zonder de generatie te laten klappen", async () => {
    const { user } = monteer();
    // Een half event mag het antwoord niet blokkeren.
    vi.mocked(fetch).mockImplementationOnce(async () => {
      const tekst =
        "data: {kapot\n\n" +
        `data: ${JSON.stringify(META)}\n\n` +
        `data: ${JSON.stringify({ type: "delta", text: "Toch een antwoord." })}\n\n` +
        `data: ${JSON.stringify({ type: "done", log_id: "log-2" })}\n\n`;
      return new Response(tekst, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    await stelVraag(user);

    expect(await screen.findByText("Toch een antwoord.")).toBeInTheDocument();
  });

  it("stuurt het volledige verzoeklichaam mee, inclusief het auditspoor", async () => {
    const { user } = monteer();
    const { lichaam } = verwachtChatStream([
      META,
      { type: "delta", text: "Antwoord." },
      { type: "done", log_id: "log-3" },
    ]);

    await stelVraag(user);
    await screen.findByText("Antwoord.");

    const body = lichaam() as Record<string, unknown>;
    // De agendapuntchat stuurt 9 van deze velden; /ai stuurt ze alle 24. Deze
    // assertie is het zichtbare deel van dat contract (zie assistent-payload).
    expect(body.fonds_id).toBe("fonds-1");
    expect(typeof body.gesprek_id).toBe("string");
    expect(body.messages).toEqual([
      { role: "user", content: "Wat is onze dekkingsgraad?" },
    ]);
    expect(body.alleen_fondsdocumenten).toBe(false);
    expect(body.algemeen_perspectief).toBe(false);
    expect(body.neem_niet_vastgestelde_mee).toBe(false);
    expect(body.reflectie_antwoord).toBe(false);
  });
});
