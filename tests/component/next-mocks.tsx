import type { AnchorHTMLAttributes, ReactNode } from "react";
import { vi } from "vitest";

const nextNavigationMocks = vi.hoisted(() => ({
  pathname: "/",
  /** De zoekstring; `useSearchParams` leest hem (T1 — de /ai-brug). */
  zoekstring: "",
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
}));

export function krijgNextNavigationMocks() {
  return nextNavigationMocks;
}

vi.mock("next/navigation", () => ({
  usePathname: () => nextNavigationMocks.pathname,
  useSearchParams: () => new URLSearchParams(nextNavigationMocks.zoekstring),
  useRouter: () => nextNavigationMocks,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
