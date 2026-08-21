// ============================================================================
//  W1 — Sessie→cookie-brug.
// ----------------------------------------------------------------------------
//  De app leest sessies uit @supabase/ssr-COOKIES (sb-<ref>-auth-token, evt.
//  gechunkt), niet uit een supabase-js sessie-object. Deze helper laat de
//  bibliotheek ZELF de cookies serialiseren via een in-memory cookie-jar en
//  levert een kant-en-klare `Cookie`-header voor HTTP-requests tegen `next
//  start`. Zo is het cookieformaat exact wat de app-server verwacht — geen
//  zelfgebouwd formaat dat bij een @supabase/ssr-upgrade stilletjes breekt.
//
//  Gebruik dezelfde URL + anon-key als waarmee de app draait, want @supabase/ssr
//  leidt de cookie-storagekey daaruit af.
// ============================================================================
import { createServerClient } from "@supabase/ssr";

/**
 * Meld een reeds bestaande gebruiker aan en geef zijn sessie-cookies terug.
 * @returns {Promise<{cookieHeader: string, cookies: {name:string,value:string}[]}>}
 */
export async function sessieCookies({ url, anonKey, email, password }) {
  /** @type {Map<string,string>} */
  const jar = new Map();
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return [...jar.entries()].map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          // Een leeg/expiry-cookie (logout) verwijdert de sleutel.
          if (value === "" ) jar.delete(name);
          else jar.set(name, value);
        }
      },
    },
  });

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signInWithPassword faalde voor ${email}: ${error.message}`);
  if (!data?.session?.access_token) throw new Error(`geen access_token voor ${email}`);

  const cookies = [...jar.entries()].map(([name, value]) => ({ name, value }));
  if (cookies.length === 0) {
    throw new Error(
      `cookie-jar bleef leeg voor ${email} — @supabase/ssr schreef geen sessie-cookie`
    );
  }
  // Cookie-headerwaarde: naam=waarde; @supabase/ssr base64-encodeert de waarde,
  // dus header-veilig. Geen extra encoding nodig.
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  return { cookieHeader, cookies, session: data.session, userId: data.user?.id };
}
