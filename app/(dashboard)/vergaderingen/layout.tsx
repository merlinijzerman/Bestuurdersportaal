import type { ReactNode } from "react";
import { vereisModuleToegang } from "@/core/lib/module-gate-page";

export default async function VergaderingenLayout({ children }: { children: ReactNode }) {
  await vereisModuleToegang("vergaderingen", "vergaderingen.manage");
  return children;
}
