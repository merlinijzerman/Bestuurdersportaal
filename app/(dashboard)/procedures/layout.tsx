import type { ReactNode } from "react";
import { vereisModuleToegang } from "@/core/lib/module-gate-page";

export default async function ProceduresLayout({ children }: { children: ReactNode }) {
  await vereisModuleToegang("procedures", "procedures.view");
  return children;
}
