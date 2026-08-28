import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FullConfig } from "@playwright/test";
import { sessieCookies } from "../karakterisering/sessie.mjs";
import { authStateBestand, E2E_FONDSEN, E2E_ROLLEN } from "./fixtures/config.mjs";
import { seedE2e } from "./fixtures/seed.mjs";

type SessieCookie = { name: string; value: string };
type SeedResultaat = {
  omgeving: {
    supabaseUrl: string;
    anonKey: string;
    origins: Record<string, string>;
  };
  users: Record<
    string,
    Record<string, { email: string; password: string; userId: string }>
  >;
};

function playwrightCookies(cookies: SessieCookie[], hosts: string[]) {
  return hosts.flatMap((host) =>
    cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: host,
      path: "/",
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: "Lax" as const,
    }))
  );
}

export default async function globalSetup(_config: FullConfig) {
  // De JS-fixture wordt door Playwright geladen; de runtimegrendel garandeert
  // de verplichte strings vóór dit resultaat terugkomt.
  const { omgeving, users } = (await seedE2e()) as unknown as SeedResultaat;
  const hosts = [
    new URL(omgeving.origins.fondsA).hostname,
    new URL(omgeving.origins.fondsB).hostname,
    new URL(omgeving.origins.onbekend).hostname,
    new URL(omgeving.origins.platform).hostname,
  ];

  for (const fondsSleutel of Object.keys(E2E_FONDSEN)) {
    for (const rol of E2E_ROLLEN) {
      const account = users[fondsSleutel][rol];
      const { cookies } = await sessieCookies({
        url: omgeving.supabaseUrl,
        anonKey: omgeving.anonKey,
        email: account.email,
        password: account.password,
      });
      const pad = authStateBestand(fondsSleutel, rol);
      await mkdir(dirname(pad), { recursive: true });
      await writeFile(
        pad,
        JSON.stringify({ cookies: playwrightCookies(cookies, hosts), origins: [] }),
        { mode: 0o600 }
      );
    }
  }
}
