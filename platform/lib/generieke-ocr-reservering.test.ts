import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  volgnummer: 0,
  preflightSysteem: vi.fn(),
}));
vi.mock("@/core/lib/ai-preflight", () => ({
  beheerSleutel: (actietype: string) => `${actietype}:test-${++mocks.volgnummer}`,
  preflightSysteem: mocks.preflightSysteem,
  vingerafdruk: () => "test-vingerafdruk",
}));

import { generiekeHerindexOcrReservering } from "./generieke-ocr-reservering";

beforeEach(() => {
  mocks.volgnummer = 0;
  mocks.preflightSysteem.mockReset();
});

describe("generieke OCR-reservering", () => {
  test("iedere providerpoging krijgt een eigen sleutel en actie; curatie blijft ongemoeid", async () => {
    mocks.preflightSysteem
      .mockResolvedValueOnce({ uitkomst: "nieuw", actieId: "ocr-actie-1" })
      .mockResolvedValueOnce({ uitkomst: "nieuw", actieId: "ocr-actie-2" });
    const afrondingen: Array<Record<string, unknown>> = [];
    const svc = { rpc: vi.fn(async (naam: string, args: Record<string, unknown>) => {
      expect(naam).toBe("fn_ai_actie_afronden");
      afrondingen.push(args);
      return { data: true, error: null };
    }) } as never;
    const reserveer = generiekeHerindexOcrReservering(svc, "document-id");

    const eerste = await reserveer(22, 1);
    const tweede = await reserveer(22, 2);
    expect(eerste).not.toBe(false);
    expect(tweede).not.toBe(false);
    if (typeof eerste === "boolean" || typeof tweede === "boolean") throw new Error("Geen actie-ID");
    await eerste.afronden("mislukt");
    await tweede.afronden("voltooid");

    const eerstePf = mocks.preflightSysteem.mock.calls[0][1];
    const tweedePf = mocks.preflightSysteem.mock.calls[1][1];
    expect(eerstePf).toMatchObject({ actietype: "ocr_generiek", fondsId: null, ocrPaginas: 22 });
    expect(tweedePf).toMatchObject({ actietype: "ocr_generiek", fondsId: null, ocrPaginas: 22 });
    expect(eerstePf.idempotentie).toMatch(/^ocr_generiek:test-1:1$/);
    expect(tweedePf.idempotentie).toMatch(/^ocr_generiek:test-2:2$/);
    expect(eerstePf.idempotentie).not.toBe(tweedePf.idempotentie);
    expect(afrondingen).toEqual([
      { p_actie_id: "ocr-actie-1", p_status: "mislukt", p_resultaat_ref: null },
      { p_actie_id: "ocr-actie-2", p_status: "voltooid", p_resultaat_ref: null },
    ]);
    expect(afrondingen.some((a) => a.p_actie_id === "curatie-actie")).toBe(false);
  });

  test("zonder gereserveerde actie-ID wordt OCR fail-closed geweigerd", async () => {
    mocks.preflightSysteem.mockResolvedValueOnce({ uitkomst: "nieuw", actieId: null });
    const reserveer = generiekeHerindexOcrReservering({} as never, "document-id");
    expect(await reserveer(22, 1)).toBe(false);
  });

  test("een false uit de afrond-RPC is geen stille geslaagde afronding", async () => {
    mocks.preflightSysteem.mockResolvedValueOnce({ uitkomst: "nieuw", actieId: "ocr-actie-1" });
    const svc = { rpc: vi.fn(async () => ({ data: false, error: null })) } as never;
    const reserveer = generiekeHerindexOcrReservering(svc, "document-id");
    const poging = await reserveer(22, 1);
    if (typeof poging === "boolean") throw new Error("Geen actie-ID");
    await expect(poging.afronden("voltooid")).rejects.toThrow("ocr_actie_afronden_mislukt");
  });
});
