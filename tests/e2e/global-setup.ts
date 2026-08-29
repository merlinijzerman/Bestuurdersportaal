import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FullConfig } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { sessieCookies } from "../karakterisering/sessie.mjs";
import {
  authStateBestand,
  E2E_FONDSEN,
  E2E_ROLLEN,
  platformAuthStateBestand,
} from "./fixtures/config.mjs";
import { seedE2e } from "./fixtures/seed.mjs";
import { maakTotp } from "./fixtures/totp.mjs";

type SessieCookie = { name: string; value: string };
type SeedResultaat = {
  omgeving: {
    supabaseUrl: string;
    anonKey: string;
    serviceKey: string;
    origins: Record<string, string>;
  };
  users: Record<
    string,
    Record<string, { email: string; password: string; userId: string }>
  >;
  platformUsers: Record<
    string,
    { email: string; password: string; userId: string }
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

async function schrijfAuthState(
  pad: string,
  cookies: SessieCookie[],
  hosts: string[],
) {
  await mkdir(dirname(pad), { recursive: true });
  await writeFile(
    pad,
    JSON.stringify({ cookies: playwrightCookies(cookies, hosts), origins: [] }),
    { mode: 0o600 },
  );
}

async function maakPlatformMfaStates(params: {
  url: string;
  anonKey: string;
  serviceKey: string;
  accountSleutel: string;
  account: { email: string; password: string; userId: string };
  hosts: string[];
}) {
  const admin = createClient(params.url, params.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: factorData, error: factorFout } =
    await admin.auth.admin.mfa.listFactors({ userId: params.account.userId });
  if (factorFout) throw new Error(`E2E MFA-factoren lezen: ${factorFout.message}`);
  for (const factor of factorData?.factors ?? []) {
    const { error } = await admin.auth.admin.mfa.deleteFactor({
      userId: params.account.userId,
      id: factor.id,
    });
    if (error) throw new Error(`E2E MFA-factor verwijderen: ${error.message}`);
  }

  const jar = new Map<string, string>();
  const client = createServerClient(params.url, params.anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies: Array<{ name: string; value: string }>) => {
        for (const { name, value } of cookies) {
          if (value === "") jar.delete(name);
          else jar.set(name, value);
        }
      },
    },
  });
  const { error: loginFout } = await client.auth.signInWithPassword({
    email: params.account.email,
    password: params.account.password,
  });
  if (loginFout) throw new Error(`E2E platformlogin: ${loginFout.message}`);
  const aal1Cookies = [...jar].map(([name, value]) => ({ name, value }));

  const { data: enroll, error: enrollFout } = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `wp3-e2e-${params.accountSleutel}`,
  });
  if (enrollFout || !enroll) throw new Error(`E2E MFA enroll: ${enrollFout?.message}`);
  const { data: challenge, error: challengeFout } = await client.auth.mfa.challenge({
    factorId: enroll.id,
  });
  if (challengeFout || !challenge) throw new Error(`E2E MFA challenge: ${challengeFout?.message}`);
  const { error: verifyFout } = await client.auth.mfa.verify({
    factorId: enroll.id,
    challengeId: challenge.id,
    code: maakTotp(enroll.totp.secret),
  });
  if (verifyFout) throw new Error(`E2E MFA verify: ${verifyFout.message}`);
  const aal2Cookies = [...jar].map(([name, value]) => ({ name, value }));

  const { error: mfaCacheFout } = await admin
    .from("platform_identities")
    .update({ mfa_enrolled: true })
    .eq("id", params.account.userId);
  if (mfaCacheFout) throw new Error(`E2E MFA-cache bijwerken: ${mfaCacheFout.message}`);
  await schrijfAuthState(
    platformAuthStateBestand(params.accountSleutel, "aal1"),
    aal1Cookies,
    params.hosts,
  );
  await schrijfAuthState(
    platformAuthStateBestand(params.accountSleutel, "aal2"),
    aal2Cookies,
    params.hosts,
  );
}

export default async function globalSetup(_config: FullConfig) {
  // De JS-fixture wordt door Playwright geladen; de runtimegrendel garandeert
  // de verplichte strings vóór dit resultaat terugkomt.
  const { omgeving, users, platformUsers } = (await seedE2e()) as unknown as SeedResultaat;
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
      await schrijfAuthState(authStateBestand(fondsSleutel, rol), cookies, hosts);
    }
  }

  for (const sleutel of ["zonderCapability", "observability"]) {
    await maakPlatformMfaStates({
      url: omgeving.supabaseUrl,
      anonKey: omgeving.anonKey,
      serviceKey: omgeving.serviceKey,
      accountSleutel: sleutel,
      account: platformUsers[sleutel],
      hosts,
    });
  }
}
