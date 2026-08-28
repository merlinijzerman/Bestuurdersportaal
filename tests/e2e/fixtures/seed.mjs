import { createClient } from "@supabase/supabase-js";
import { bevestigVeiligeE2eDoelomgeving } from "./omgeving.mjs";
import { E2E_FONDSEN, E2E_ROLLEN, E2E_WACHTWOORD, e2eEmail } from "./config.mjs";

async function vindGebruiker(admin, email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`E2E listUsers: ${error.message}`);
    const hit = (data?.users ?? []).find((user) => user.email === email);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  throw new Error(`E2E listUsers: paginalimiet bereikt voor ${email}`);
}

async function vindOfMaakGebruiker(admin, fondsSleutel, fonds, rol) {
  const email = e2eEmail(fondsSleutel, rol);
  const bestaand = await vindGebruiker(admin, email);
  if (bestaand) {
    const { data, error } = await admin.auth.admin.updateUserById(bestaand.id, {
      password: E2E_WACHTWOORD,
      email_confirm: true,
      app_metadata: { ...(bestaand.app_metadata ?? {}), fonds_id: fonds.id },
      user_metadata: { naam: `Synthetisch ${fondsSleutel.toUpperCase()} ${rol}` },
    });
    if (error || !data?.user) throw new Error(`E2E updateUserById(${email}): ${error?.message}`);
    return data.user;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: E2E_WACHTWOORD,
    email_confirm: true,
    app_metadata: { fonds_id: fonds.id },
    user_metadata: { naam: `Synthetisch ${fondsSleutel.toUpperCase()} ${rol}` },
  });
  if (error || !data?.user) throw new Error(`E2E createUser(${email}): ${error?.message}`);
  return data.user;
}

/** Seedt exact twee synthetische fondsen met ieder vier rollen.
 * De omgevinggrendel loopt vóór het maken van de service-role-client. */
export async function seedE2e(env = process.env) {
  const omgeving = bevestigVeiligeE2eDoelomgeving(env);
  const admin = createClient(omgeving.supabaseUrl, omgeving.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const users = {};

  for (const [fondsSleutel, fonds] of Object.entries(E2E_FONDSEN)) {
    const { error: fondsError } = await admin
      .from("fondsen")
      .upsert({ id: fonds.id, naam: fonds.naam, slug: fonds.slug }, { onConflict: "id" });
    if (fondsError) throw new Error(`E2E fondsen(${fondsSleutel}): ${fondsError.message}`);

    const { error: domeinError } = await admin.from("tenant_domains").upsert(
      { id: fonds.domeinId, host: fonds.host, fonds_id: fonds.id, actief: true },
      { onConflict: "host" }
    );
    if (domeinError) throw new Error(`E2E tenant_domains(${fondsSleutel}): ${domeinError.message}`);

    users[fondsSleutel] = {};
    for (const rol of E2E_ROLLEN) {
      const user = await vindOfMaakGebruiker(admin, fondsSleutel, fonds, rol);
      const { error: profielError } = await admin.from("profielen").upsert(
        {
          id: user.id,
          fonds_id: fonds.id,
          naam: `Synthetisch ${fondsSleutel.toUpperCase()} ${rol}`,
          rol,
        },
        { onConflict: "id" }
      );
      if (profielError) throw new Error(`E2E profielen(${fondsSleutel}/${rol}): ${profielError.message}`);
      users[fondsSleutel][rol] = {
        email: e2eEmail(fondsSleutel, rol),
        password: E2E_WACHTWOORD,
        userId: user.id,
      };
    }
  }

  return { omgeving, users };
}
