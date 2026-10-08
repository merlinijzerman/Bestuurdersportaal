import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("./document-extractie", () => ({
  extractTekst: vi.fn(async () => ({
    tekst: "",
    aantalPaginas: 22,
    segmenten: [],
  })),
}));

import {
  extractTekstMetOcrFallback,
  OcrTijdelijkeFout,
} from "./ocr";

function poort() {
  return {
    supabase: {
      rpc: vi.fn(async () => ({ data: { toegestaan: true }, error: null })),
    } as never,
    label: "ocr-test",
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OCR-providerfouten", () => {
  test("geslaagde OCR rondt de eigen gereserveerde actie af", async () => {
    vi.stubEnv("MISTRAL_API_KEY", "test-key");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const afronden = vi.fn(async (_status: "voltooid" | "mislukt") => undefined);
    const reserveer = vi.fn(async () => ({ toegestaan: true as const, afronden }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      pages: [{ index: 0, markdown: "Een bruikbare OCR-passage met voldoende woorden voor extractie." }],
    }), { status: 200 })));

    const resultaat = await extractTekstMetOcrFallback(Buffer.from("pdf"), "pdf", {
      maxOcrPaginas: 40,
      poort: poort(),
      reserveerOcr: reserveer,
    });

    expect(resultaat.ocrToegepast).toBe(true);
    expect(reserveer).toHaveBeenCalledTimes(1);
    expect(afronden).toHaveBeenCalledExactlyOnceWith("voltooid");
  });

  test("429 sluit de mislukte poging vóór de volgende reservering; succes sluit de retry", async () => {
    vi.useFakeTimers();
    vi.stubEnv("MISTRAL_API_KEY", "test-key");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const gebeurtenissen: string[] = [];
    const reserveer = vi.fn(async (_paginas: number, poging: number) => {
      gebeurtenissen.push(`reserveer:${poging}`);
      return {
        toegestaan: true as const,
        afronden: async (status: "voltooid" | "mislukt") => {
          gebeurtenissen.push(`afronden:${poging}:${status}`);
        },
      };
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ type: "rate_limited" }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        pages: [{ index: 0, markdown: "Een bruikbare OCR-passage met voldoende woorden voor extractie." }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const resultaat = extractTekstMetOcrFallback(Buffer.from("pdf"), "pdf", {
      maxOcrPaginas: 40,
      poort: poort(),
      reserveerOcr: reserveer,
    });
    await vi.runAllTimersAsync();

    expect((await resultaat).ocrToegepast).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(gebeurtenissen).toEqual([
      "reserveer:1", "afronden:1:mislukt",
      "reserveer:2", "afronden:2:voltooid",
    ]);
  });

  test("429 blijft na vier interne pogingen tijdelijk voor workerbackoff", async () => {
    vi.useFakeTimers();
    vi.stubEnv("MISTRAL_API_KEY", "test-key");
    const waarschuwing = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ type: "rate_limited", message: "PRIVATE-PDF-CONTENT" }),
      { status: 429, headers: {
        "retry-after": "7",
        "x-ratelimit-limit": "625",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "60",
        "x-request-id": "mistral-req-123",
      } }
    ));
    vi.stubGlobal("fetch", fetchMock);
    const afrondingen: Array<[number, "voltooid" | "mislukt"]> = [];
    const reserveer = vi.fn(async (_paginas: number, poging: number) => ({
      toegestaan: true as const,
      afronden: async (status: "voltooid" | "mislukt") => {
        afrondingen.push([poging, status]);
      },
    }));

    const resultaat = extractTekstMetOcrFallback(Buffer.from("pdf"), "pdf", {
      maxOcrPaginas: 40,
      poort: poort(),
      reserveerOcr: reserveer,
    });
    const tijdelijkeFout = expect(resultaat).rejects.toMatchObject({
      name: "OcrTijdelijkeFout",
      foutcode: "ocr_rate_limit",
      status: 429,
    } satisfies Partial<OcrTijdelijkeFout>);
    await vi.runAllTimersAsync();

    await tijdelijkeFout;
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(reserveer.mock.calls.map(([, poging]) => poging)).toEqual([1, 2, 3, 4]);
    expect(afrondingen).toEqual([
      [1, "mislukt"], [2, "mislukt"], [3, "mislukt"], [4, "mislukt"],
    ]);
    expect(waarschuwing).toHaveBeenCalledTimes(4);
    expect(waarschuwing.mock.calls.map(([label, data]) => [label, JSON.parse(data as string)])).toEqual(
      [1, 2, 3, 4].map((poging) => ["[OCR][provider_429]", {
        provider: "mistral",
        status: 429,
        poging,
        retry_after: "7",
        rate_limit_limit: 625,
        rate_limit_remaining: 0,
        rate_limit_reset: 60,
        request_id: "mistral-req-123",
        error_type: "rate_limited",
        error_category: "rate_limit",
      }])
    );
    expect(JSON.stringify(waarschuwing.mock.calls)).not.toContain("PRIVATE-PDF-CONTENT");
    expect(JSON.stringify(waarschuwing.mock.calls)).not.toContain("test-key");
  });

  test("429-log weigert onveilige providervelden en behoudt de tijdelijke fout", async () => {
    vi.useFakeTimers();
    vi.stubEnv("MISTRAL_API_KEY", "test-key");
    const waarschuwing = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: { type: "PRIVATE-PDF-CONTENT", message: "SECRET" } }),
      { status: 429, headers: {
        "retry-after": "PRIVATE-PDF-CONTENT",
        "x-ratelimit-remaining": "SECRET",
        "x-request-id": "PRIVATE PDF CONTENT",
      } }
    )));

    const resultaat = extractTekstMetOcrFallback(Buffer.from("pdf"), "pdf", {
      maxOcrPaginas: 40,
      poort: poort(),
      reserveerOcr: async () => true,
    });
    const tijdelijkeFout = expect(resultaat).rejects.toMatchObject({
      foutcode: "ocr_rate_limit",
      status: 429,
      message: "Mistral OCR 429",
    });
    await vi.runAllTimersAsync();
    await tijdelijkeFout;

    expect(waarschuwing).toHaveBeenCalledTimes(4);
    const diagnostiek = JSON.parse(waarschuwing.mock.calls[0][1] as string);
    expect(diagnostiek).toMatchObject({
      retry_after: null,
      rate_limit_remaining: null,
      request_id: null,
      error_type: null,
      error_category: "onbekend",
    });
    expect(JSON.stringify(waarschuwing.mock.calls)).not.toMatch(/PRIVATE|SECRET|test-key/);
  });

  test("niet-tijdelijke providerafwijzing behoudt de bestaande lege fallback", async () => {
    vi.stubEnv("MISTRAL_API_KEY", "test-key");
    const fetchMock = vi.fn(async () => new Response("ongeldig verzoek", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const resultaat = await extractTekstMetOcrFallback(Buffer.from("pdf"), "pdf", {
      maxOcrPaginas: 40,
      poort: poort(),
      reserveerOcr: async () => true,
    });

    expect(resultaat.tekst).toBe("");
    expect(resultaat.ocrToegepast).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
