import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { krijgNextNavigationMocks } from "./next-mocks";

beforeEach(() => {
  const nextNavigationMocks = krijgNextNavigationMocks();
  nextNavigationMocks.pathname = "/";
  vi.clearAllMocks();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as typeof HTMLCanvasElement.prototype.getContext;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      throw new Error(`Onverwacht netwerkverzoek in componenttest: ${url}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
