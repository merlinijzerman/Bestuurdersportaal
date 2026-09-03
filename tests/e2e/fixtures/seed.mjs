import { createClient } from "@supabase/supabase-js";
import { bevestigVeiligeE2eDoelomgeving } from "./omgeving.mjs";
import {
  E2E_ASSISTENT_CONTEXT,
  E2E_AI_BRONNEN,
  E2E_FONDSEN,
  E2E_PLATFORM_ACCOUNTS,
  E2E_ROLLEN,
  E2E_WACHTWOORD,
  e2eEmail,
} from "./config.mjs";

const AI_ZOEKTEKST = Object.freeze({
  uitvoering:
    "Synthetische uitvoeringsafspraak controlewaarde voor de bestuurlijke WP4 test. " +
    "De fictieve werkstroom noemt een eigenaar, een besluitmoment en een herstelpad voor de uitvoering.",
  controle:
    "Synthetische uitvoeringsafspraak controlewaarde voor de bestuurlijke WP4 test. " +
    "Het denkbeeldige controleprotocol beschrijft onafhankelijke review, een vierogencontrole en een auditnotitie.",
  isolatie:
    "Synthetische uitvoeringsafspraak controlewaarde voor de bestuurlijke WP4 test. " +
    "Deze andersoortige tekst hoort uitsluitend bij het tweede fictieve fonds en mag nooit bij fonds A verschijnen.",
});

async function seedAiBron(admin, fonds, bron, suffix, tekst) {
  const opslagPad = `${fonds.id}/wp4-synthetische-bron-${suffix}.pdf`;
  const upload = await admin.storage.from("documenten").upload(
    opslagPad,
    new TextEncoder().encode(`%PDF-1.4\n% WP4 synthetische bron ${suffix}\n%%EOF\n`),
    { contentType: "application/pdf", upsert: true },
  );
  if (upload.error) throw new Error(`E2E AI-storage(${suffix}): ${upload.error.message}`);
  const { error: documentFout } = await admin.from("documenten").upsert(
    {
      id: bron.id,
      fonds_id: fonds.id,
      bibliotheek: "fonds",
      bron: "Intern",
      titel: bron.titel,
      bestandsnaam: `wp4-synthetische-bron-${suffix}.pdf`,
      bestandstype: "pdf",
      opslag_pad: opslagPad,
      context: "algemeen",
      documenttype: "beleid",
      status: "van_kracht",
      bronstatus: "actief",
      documentdatum: "2026-01-15",
      verwerkingsstatus: "beschikbaar",
      geindexeerd: true,
      actief: true,
    },
    { onConflict: "id" },
  );
  if (documentFout) throw new Error(`E2E AI-document(${suffix}): ${documentFout.message}`);

  const { error: chunkFout } = await admin.from("document_chunks").upsert(
    {
      id: bron.chunkId,
      document_id: bron.id,
      chunk_index: 0,
      tekst,
      pagina: 1,
      structuur_type: "tekst",
      structuur_label: "WP4 fixture",
      indexering_versie: "wp4-e2e-v1",
    },
    { onConflict: "id" },
  );
  if (chunkFout) throw new Error(`E2E AI-chunk(${suffix}): ${chunkFout.message}`);
}

async function seedAssistentContext(admin, fonds) {
  const context = E2E_ASSISTENT_CONTEXT;
  const inserts = [
    admin.from("procedures").upsert(
      {
        id: context.procedure.id,
        fonds_id: fonds.id,
        template_code: "wp4_e2e_context",
        titel: context.procedure.titel,
        beschrijving: "Uitsluitend synthetische context voor de URL-ingangstest.",
        status: "lopend",
      },
      { onConflict: "id" },
    ),
    admin.from("vergaderingen").upsert(
      {
        id: context.vergadering.id,
        fonds_id: fonds.id,
        titel: context.vergadering.titel,
        datum: "2026-09-03T09:00:00.000Z",
        status: "gepland",
      },
      { onConflict: "id" },
    ),
    admin.from("risicos").upsert(
      {
        id: context.risico.id,
        fonds_id: fonds.id,
        categorie: "operationeel_datakwaliteit",
        titel: context.risico.titel,
        toelichting: "Uitsluitend synthetische context voor de URL-ingangstest.",
        kans: 2,
        impact: 3,
        niveau: "middel",
        status: "actief",
      },
      { onConflict: "id" },
    ),
  ];
  const resultaten = await Promise.all(inserts);
  for (const [index, resultaat] of resultaten.entries()) {
    if (resultaat.error) {
      throw new Error(`E2E assistentcontext(${index}): ${resultaat.error.message}`);
    }
  }

  const { error: agendapuntFout } = await admin.from("agendapunten").upsert(
    {
      id: context.agendapunt.id,
      vergadering_id: context.vergadering.id,
      volgorde: 1,
      titel: context.agendapunt.titel,
      beschrijving: "Uitsluitend synthetische context voor de URL-ingangstest.",
      categorie: "informatie",
    },
    { onConflict: "id" },
  );
  if (agendapuntFout) {
    throw new Error(`E2E assistentcontext(agendapunt): ${agendapuntFout.message}`);
  }
}

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

async function vindOfMaakPlatformGebruiker(admin, account) {
  const bestaand = await vindGebruiker(admin, account.email);
  if (bestaand) {
    const { data, error } = await admin.auth.admin.updateUserById(bestaand.id, {
      password: E2E_WACHTWOORD,
      email_confirm: true,
      app_metadata: { platform_e2e: true },
      user_metadata: { naam: account.naam },
    });
    if (error || !data?.user) throw new Error(`E2E platform updateUserById: ${error?.message}`);
    return data.user;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email: account.email,
    password: E2E_WACHTWOORD,
    email_confirm: true,
    app_metadata: { platform_e2e: true },
    user_metadata: { naam: account.naam },
  });
  if (error || !data?.user) throw new Error(`E2E platform createUser: ${error?.message}`);
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

  // De productiepreflight is fail-closed en de migratie seedt bewust geen
  // quota. Alleen in deze al gegrendelde lokale E2E-seed zetten we ruime,
  // synthetische limieten en vaste RAG-bronnen klaar.
  const { error: quotaFout } = await admin.from("ai_quota_config").upsert(
    ["gebruiker_maand", "fonds_maand", "globaal_maand", "ocr_fonds_maand"].map(
      (sleutel) => ({ sleutel, waarde: 10000 }),
    ),
    { onConflict: "sleutel" },
  );
  if (quotaFout) throw new Error(`E2E AI-quota: ${quotaFout.message}`);

  await seedAiBron(
    admin,
    E2E_FONDSEN.a,
    E2E_AI_BRONNEN.fondsAUitvoering,
    "a-uitvoering",
    AI_ZOEKTEKST.uitvoering,
  );
  await seedAiBron(
    admin,
    E2E_FONDSEN.a,
    E2E_AI_BRONNEN.fondsAControle,
    "a-controle",
    AI_ZOEKTEKST.controle,
  );
  await seedAiBron(
    admin,
    E2E_FONDSEN.b,
    E2E_AI_BRONNEN.fondsBIsolatie,
    "b-isolatie",
    AI_ZOEKTEKST.isolatie,
  );
  await seedAssistentContext(admin, E2E_FONDSEN.a);

  // Een upload-init telt als echte productieactie in de in-stack rate limiter.
  // Wis uitsluitend tellers van de zojuist begrensde synthetische accounts,
  // zodat herhaalde lokale stabiliteitsruns dezelfde beginstaat hebben.
  const tenantUserIds = Object.values(users)
    .flatMap((rollen) => Object.values(rollen))
    .map((account) => account.userId);
  const { error: rateLimitFout } = await admin
    .from("rate_limit_events")
    .delete()
    .in("gebruiker_id", tenantUserIds);
  if (rateLimitFout) throw new Error(`E2E rate-limit-tellers opschonen: ${rateLimitFout.message}`);

  const platformUsers = {};
  for (const [sleutel, account] of Object.entries(E2E_PLATFORM_ACCOUNTS)) {
    const user = await vindOfMaakPlatformGebruiker(admin, account);
    const { error } = await admin.from("platform_identities").upsert(
      {
        id: user.id,
        email: account.email,
        naam: account.naam,
        actief: true,
        mfa_enrolled: false,
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(`E2E platform_identities(${sleutel}): ${error.message}`);
    platformUsers[sleutel] = {
      email: account.email,
      password: E2E_WACHTWOORD,
      userId: user.id,
    };
  }

  const begrensdePlatformIds = [
    platformUsers.zonderCapability.userId,
    platformUsers.observability.userId,
  ];
  const { error: capabilityFout } = await admin.from("platform_capabilities").upsert(
    {
      capability: "platform.observability.read",
      actief: true,
      omschrijving: "Synthetische E2E-readcapability",
    },
    { onConflict: "capability" },
  );
  if (capabilityFout) throw new Error(`E2E platformcapability: ${capabilityFout.message}`);
  const { error: grantsOpschoonFout } = await admin
    .from("platform_identity_capabilities")
    .delete()
    .in("identity_id", begrensdePlatformIds);
  if (grantsOpschoonFout) throw new Error(`E2E platformgrants opschonen: ${grantsOpschoonFout.message}`);
  const { error: grantFout } = await admin.from("platform_identity_capabilities").insert({
    identity_id: platformUsers.observability.userId,
    capability: "platform.observability.read",
    toegekend_door: platformUsers.granter.userId,
  });
  if (grantFout) throw new Error(`E2E platformgrant schrijven: ${grantFout.message}`);

  return { omgeving, users, platformUsers };
}
