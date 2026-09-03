import { expect, vi } from "vitest";

interface FetchVerwachting {
  url: string;
  method?: string;
  status?: number;
  json?: unknown;
  controleerBody?: (body: unknown) => void;
}

export function verwachtFetchEenmaal({
  url,
  method = "GET",
  status = 200,
  json = {},
  controleerBody,
}: FetchVerwachting) {
  const fetchMock = vi.mocked(fetch);
  fetchMock.mockImplementationOnce(async (input, init) => {
    const werkelijkeUrl = input instanceof Request ? input.url : String(input);
    const werkelijkeMethode = init?.method ?? (input instanceof Request ? input.method : "GET");
    expect(werkelijkeUrl).toBe(url);
    expect(werkelijkeMethode).toBe(method);
    if (controleerBody) {
      const body = init?.body;
      controleerBody(typeof body === "string" ? JSON.parse(body) : body);
    }
    return new Response(JSON.stringify(json), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  return fetchMock;
}

/**
 * Bouwt een SSE-antwoord uit een gescripte eventreeks, zoals /api/chat het
 * stuurt: één JSON-object per event, gescheiden door een lege regel.
 *
 * `knip` splitst de stroom in willekeurige brokken, zodat de test ook het
 * geval dekt waarin een event over twee reads heen valt — precies waar een
 * eigengebouwde bufferlus stukgaat.
 */
export function maakSseAntwoord(
  events: unknown[],
  { knip = 1 }: { knip?: number } = {},
): Response {
  const tekst = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  const bytes = new TextEncoder().encode(tekst);
  const stukken: Uint8Array[] = [];
  const stap = Math.max(1, Math.ceil(bytes.length / Math.max(1, knip)));
  for (let i = 0; i < bytes.length; i += stap) stukken.push(bytes.slice(i, i + stap));

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const s of stukken) controller.enqueue(s);
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/**
 * Laat de volgende `POST /api/chat` de gescripte eventreeks streamen en geeft
 * het opgevangen verzoeklichaam terug (voor payload-asserties).
 */
export function verwachtChatStream(
  events: unknown[],
  opties: { knip?: number } = {},
): { lichaam: () => unknown } {
  let opgevangen: unknown;
  vi.mocked(fetch).mockImplementationOnce(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    expect(url).toBe("/api/chat");
    const body = init?.body;
    opgevangen = typeof body === "string" ? JSON.parse(body) : body;
    return maakSseAntwoord(events, opties);
  });
  return { lichaam: () => opgevangen };
}

/**
 * Laat de volgende fetch naar `url` een gescripte SSE-reeks streamen en geeft
 * het opgevangen verzoek terug — inclusief de HEADERS. `verwachtChatStream`
 * pint `/api/chat` hard en toont geen headers; een kostendragende route die een
 * `Idempotency-Key` eist, is daarmee niet te toetsen.
 */
export function verwachtSseStroomEenmaal(
  url: string,
  events: unknown[],
  opties: { knip?: number; method?: string } = {},
): { headers: () => Headers; lichaam: () => unknown } {
  let opgevangenHeaders = new Headers();
  let opgevangenLichaam: unknown;
  vi.mocked(fetch).mockImplementationOnce(async (input, init) => {
    const werkelijkeUrl = input instanceof Request ? input.url : String(input);
    const werkelijkeMethode = init?.method ?? (input instanceof Request ? input.method : "GET");
    expect(werkelijkeUrl).toBe(url);
    expect(werkelijkeMethode).toBe(opties.method ?? "POST");
    opgevangenHeaders = new Headers(init?.headers);
    const body = init?.body;
    opgevangenLichaam = typeof body === "string" ? JSON.parse(body) : body;
    return maakSseAntwoord(events, opties);
  });
  return {
    headers: () => opgevangenHeaders,
    lichaam: () => opgevangenLichaam,
  };
}
