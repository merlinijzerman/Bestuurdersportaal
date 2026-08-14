// ============================================================================
//  Deploymentomgeving — pure herkenning voor zichtbare Preview-markering.
// ----------------------------------------------------------------------------
//  DEPLOY_TARGET is in dit project een SURFACE (`app` of `platform`), niet de
//  lifecycle-omgeving. Preview volgt daarom uitsluitend uit de Vercel-
//  omgevingsvariabelen. Puur gehouden voor regressietests en hergebruik.
// ============================================================================

export function isPreviewOmgeving(args: {
  vercelEnv?: string | null;
  vercelTargetEnv?: string | null;
}): boolean {
  const norm = (v: string | null | undefined) => v?.trim().toLowerCase() ?? "";
  const omgevingen = [norm(args.vercelEnv), norm(args.vercelTargetEnv)];
  return omgevingen.some((v) => v === "preview" || v === "staging");
}
