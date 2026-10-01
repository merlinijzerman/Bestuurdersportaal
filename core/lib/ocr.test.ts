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
  test("429 blijft na vier interne pogingen tijdelijk voor workerbackoff", async () => {
    vi.useFakeTimers();
    vi.stubEnv("MISTRAL_API_KEY", "test-key");
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ type: "rate_limited" }),
      { status: 429 }
    ));
    vi.stubGlobal("fetch", fetchMock);
    const reserveer = vi.fn(async (_paginas: number, _poging: number) => true);

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
