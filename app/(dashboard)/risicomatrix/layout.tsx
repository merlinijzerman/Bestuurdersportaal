import type { ReactNode } from "react";
import { vereisModuleToegang } from "@/core/lib/module-gate-page";

export default async function RisicomatrixLayout({ children }: { children: ReactNode }) {
  await vereisModuleToegang("risicomatrix", "risicos.manage");
  return children;
}
