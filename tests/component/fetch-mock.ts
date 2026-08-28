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
