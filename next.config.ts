import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Document-extractie packages moeten als externe Node-packages geladen worden in
  // server components, anders crasht de build. In Next.js 15+ heet deze optie
  // `serverExternalPackages`.
  // - unpdf: PDF-tekstextractie (modern pdfjs onder de motorkap, Vercel-vriendelijk)
  // - mammoth: Word (.docx) tekstextractie
  // - xlsx: Excel (.xlsx) parsing
  serverExternalPackages: ["unpdf", "mammoth", "xlsx"],
};

export default nextConfig;
