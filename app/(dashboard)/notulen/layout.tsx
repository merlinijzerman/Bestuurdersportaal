import type { ReactNode } from "react";
import { vereisModuleToegang } from "@/core/lib/module-gate-page";

export default async function NotulenLayout({ children }: { children: ReactNode }) {
  await vereisModuleToegang("notulen", "documents.view");
  return children;
}
