import { expect, it } from "vitest";

it("laat een onverwacht netwerkverzoek standaard hard falen", async () => {
  await expect(fetch("/api/onverwacht")).rejects.toThrow(
    "Onverwacht netwerkverzoek in componenttest: /api/onverwacht",
  );
});
