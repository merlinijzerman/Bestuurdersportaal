import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse moet als externe Node-package geladen worden in server components,
  // anders crasht de build. In Next.js 15+ heet deze optie `serverExternalPackages`.
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
