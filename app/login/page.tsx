// ============================================================================
//  /login — server-pagina. Het wachtwoordformulier zelf is ongewijzigd en leeft in
//  _components/LoginForm.tsx (client). Deze laag beslist twee dingen (#335 T2):
//   1. of de knop "Inloggen met Microsoft" bestaat: host → fonds (tenant_domains)
//      → configuratie compleet → fondsflag aan (login_private.lees_config via de
//      gateway). Elke twijfel = geen knop (fail-closed, geen verborgen element);
//   2. de ENE neutrale melding voor `?fout=microsoft` én het bestaande
//      `?error=auth_callback` (V11), met hooguit een supportcode uit de URL.
// ============================================================================
import { headers } from "next/headers";
import LoginForm from "./_components/LoginForm";
import { microsoftLoginBeschikbaarVoorHost } from "@/core/lib/microsoft-login";
import {
  LOGIN_FOUT_PARAM,
  LOGIN_FOUT_WAARDE,
  LOGIN_MICROSOFT_MELDING,
  SUPPORTCODE_PARAM,
  SUPPORTCODE_RE,
} from "@/core/lib/microsoft-login-meldingen-core";

export const dynamic = "force-dynamic";

type ZoekParams = Record<string, string | string[] | undefined>;

export default async function LoginPage({ searchParams }: { searchParams: Promise<ZoekParams> }) {
  const sp = await searchParams;
  const fout = sp[LOGIN_FOUT_PARAM];
  const error = sp.error;
  const sc = sp[SUPPORTCODE_PARAM];
  const melding = fout === LOGIN_FOUT_WAARDE || error === "auth_callback" ? LOGIN_MICROSOFT_MELDING : null;
  const supportcode = melding && typeof sc === "string" && SUPPORTCODE_RE.test(sc) ? sc : null;

  const host = (await headers()).get("host");
  const microsoftLogin = await microsoftLoginBeschikbaarVoorHost(host);

  return <LoginForm microsoftLogin={microsoftLogin} melding={melding} supportcode={supportcode} />;
}
