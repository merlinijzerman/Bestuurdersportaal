import type { ReactNode } from "react";
import { vereisModuleToegang } from "@/core/lib/module-gate-page";

export default async function BibliotheekLayout({ children }: { children: ReactNode }) {
  await vereisModuleToegang("bibliotheek", "documents.view");
  return children;
}
