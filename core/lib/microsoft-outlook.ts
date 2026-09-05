import "server-only";
import { MicrosoftConnectorError, microsoftTestFoutcategorie } from "@/core/lib/microsoft-connector-error-core";
import { outlookAccessToken, type ConnectorContext } from "@/core/lib/microsoft-connector";
import * as vault from "@/core/lib/microsoft-vault";
import {
  berekenVastOutlookVenster,
  bouwStandaardAgendaDeltaUrl,
  OutlookGraphError,
  graphGet,
  normaliseerGraphUtc,
  normaliseerSensitivity,
  projecteerDeelnemers,
  veiligeTeamsLink,
} from "@/core/lib/microsoft-outlook-graph-core";

type GraphCalendar = { id?: string; name?: string; canEdit?: boolean; canShare?: boolean; isDefaultCalendar?: boolean; owner?: unknown };
type GraphEvent = {
  id?: string; iCalUId?: string; changeKey?: string; seriesMasterId?: string; subject?: string;
  start?: { dateTime?: string; timeZone?: string }; end?: { dateTime?: string; timeZone?: string };
  location?: { displayName?: string | null }; onlineMeeting?: { joinUrl?: string | null } | null;
  onlineMeetingUrl?: string | null; sensitivity?: string; isCancelled?: boolean;
  attendees?: Array<{ emailAddress?: { address?: string | null } | null }>;
  "@removed"?: unknown;
};
type GraphDelta = { value?: GraphEvent[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };

const GRAPH = "https://graph.microsoft.com/v1.0";

export async function outlookAgendaLijst(ctx: ConnectorContext) {
  const { accessToken, tenantId, mailboxId } = await outlookAccessToken(ctx);
  const agendas = new Map<string, { naam: string; standaard: boolean }>();
  const bezocht = new Set<string>();
  let volgende = `${GRAPH}/me/calendars?$select=id,name,canEdit,canShare,isDefaultCalendar`;
  for (let pagina = 0; volgende; pagina += 1) {
    if (pagina >= 100 || bezocht.has(volgende)) throw new OutlookGraphError("graph_paginering");
    bezocht.add(volgende);
    const response = await graphGet(accessToken, volgende);
    const body = await response.json() as { value?: GraphCalendar[]; "@odata.nextLink"?: string };
    for (const agenda of body.value ?? []) {
      if (agenda.id && agenda.name) agendas.set(agenda.id, {
        naam: agenda.name.slice(0, 160),
        standaard: agenda.isDefaultCalendar === true,
      });
    }
    volgende = body["@odata.nextLink"] ?? "";
  }
  return {
    tenantId, mailboxId,
    agendas: [...agendas].map(([id, agenda]) => ({ id, ...agenda })),
  };
}

export async function kiesOutlookAgenda(ctx: ConnectorContext, calendarId: string) {
  const lijst = await outlookAgendaLijst(ctx);
  const agenda = lijst.agendas.find((x) => x.id === calendarId);
  if (!agenda) throw new OutlookGraphError("agenda_niet_toegankelijk");
  // Microsoft documenteert calendarView/delta in Graph v1.0 alleen voor de
  // standaardagenda. Een specifieke agenda vereist momenteel het beta-pad;
  // dat gebruiken we niet voor productiegegevens.
  if (!agenda.standaard) throw new OutlookGraphError("agenda_delta_niet_ondersteund");
  const { start, eind } = berekenVastOutlookVenster();
  await vault.configureerOutlookAgenda({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId, tenantId: lijst.tenantId, mailboxId: lijst.mailboxId, calendarId: agenda.id, naam: agenda.naam, vensterStart: start, vensterEind: eind });
}

export async function outlookStatus(ctx: ConnectorContext) {
  const [verbinding, configuratie] = await Promise.all([vault.leesVerbinding(ctx.fondsId, ctx.gebruikerId), vault.leesOutlookConfiguratie(ctx.fondsId, ctx.gebruikerId)]);
  return {
    toestemmingVereist: verbinding?.status !== "gekoppeld" || !verbinding.scopes.includes("Calendars.Read.Shared"),
    configuratie: configuratie ? { agenda: configuratie.calendar_naam, status: configuratie.status, laatstGeluktOp: configuratie.laatst_gelukt_op, foutcategorie: configuratie.laatst_foutcategorie } : null,
  };
}

export async function synchroniseerOutlookAgenda(ctx: ConnectorContext & { correlationId: string }) {
  const { accessToken } = await outlookAccessToken(ctx);
  const run = await vault.startOutlookRun(ctx.fondsId, ctx.gebruikerId, ctx.correlationId);
  if (!run) throw new OutlookGraphError("agenda_niet_geconfigureerd");
  let gelezen = 0, aangemaakt = 0, bijgewerkt = 0, overgeslagen = 0;
  try {
    const [me, standaardAgendaResponse] = await Promise.all([
      graphGet(accessToken, `${GRAPH}/me?$select=userPrincipalName`),
      graphGet(accessToken, `${GRAPH}/me/calendar?$select=id,isDefaultCalendar`),
    ]);
    const [meBody, standaardAgenda] = await Promise.all([
      me.json() as Promise<{ userPrincipalName?: string }>,
      standaardAgendaResponse.json() as Promise<GraphCalendar>,
    ]);
    const userPrincipalName = meBody.userPrincipalName ?? null;
    if (
      !standaardAgenda.id
      || standaardAgenda.isDefaultCalendar !== true
      || standaardAgenda.id !== run.calendar_id
    ) throw new OutlookGraphError("agenda_delta_niet_ondersteund");
    let volgende = run.delta_link
      ?? bouwStandaardAgendaDeltaUrl(run.venster_start, run.venster_eind).toString();
    let definitieveDeltaLink: string | undefined;
    const bezocht = new Set<string>();
    for (let paginaNummer = 0; volgende; paginaNummer += 1) {
      if (paginaNummer >= 1_000 || bezocht.has(volgende)) throw new OutlookGraphError("graph_paginering");
      bezocht.add(volgende);
      let response: Response;
      try {
        response = await graphGet(accessToken, volgende);
      } catch (fout) {
        if (fout instanceof OutlookGraphError) {
          const fase = paginaNummer === 0 ? "delta_start" : "delta_vervolg";
          throw new OutlookGraphError(`${fase}_${fout.categorie}`, fout);
        }
        throw fout;
      }
      const pagina = await response.json() as GraphDelta;
      for (const event of pagina.value ?? []) {
        gelezen += 1;
        if (!event.id) { overgeslagen += 1; continue; }
        // @removed bewijst niet of het event echt is verwijderd of buiten het
        // vaste venster is verplaatst. We tonen daarom één veilige gecombineerde
        // status en verwijderen nooit portaalinhoud.
        if (event["@removed"]) {
          const gemarkeerd = await vault.markeerOutlookEventExternGewijzigd(run.run_id, event.id);
          if (gemarkeerd) bijgewerkt += 1;
          else overgeslagen += 1;
          continue;
        }
        const start = normaliseerGraphUtc(event.start), eind = normaliseerGraphUtc(event.end);
        if (!start || !eind) { overgeslagen += 1; continue; }
        const deelnemers = projecteerDeelnemers(event.attendees, userPrincipalName);
        const resultaat = await vault.verwerkOutlookEvent({
          runId: run.run_id, eventId: event.id, iCalUId: event.iCalUId ?? null, changeKey: event.changeKey ?? null, serieMasterId: event.seriesMasterId ?? null,
          titel: event.subject?.slice(0, 240) ?? "", start: start.iso, eind: eind.iso, tijdzone: start.tijdzone,
          locatie: event.location?.displayName?.slice(0, 240) ?? "",
          teamsLink: veiligeTeamsLink(event.onlineMeeting?.joinUrl ?? event.onlineMeetingUrl),
          sensitivity: normaliseerSensitivity(event.sensitivity), geannuleerd: event.isCancelled === true,
          lokaleDeelnemers: deelnemers.huidigeGebruikerIsDeelnemer ? [ctx.gebruikerId] : [],
          onbekendeDeelnemers: deelnemers.onbekend,
        });
        if (resultaat === "aangemaakt") aangemaakt += 1;
        else if (resultaat === "bijgewerkt" || resultaat === "afgeschermd") bijgewerkt += 1;
        else overgeslagen += 1;
      }
      if (pagina["@odata.deltaLink"]) definitieveDeltaLink = pagina["@odata.deltaLink"];
      volgende = pagina["@odata.nextLink"] ?? "";
    }
    if (!definitieveDeltaLink) throw new OutlookGraphError("delta_onvolledig");
    await vault.voltooiOutlookRun(run.run_id, definitieveDeltaLink, { gelezen, aangemaakt, bijgewerkt, overgeslagen });
    return { gelezen, aangemaakt, bijgewerkt, overgeslagen };
  } catch (fout) {
    const categorie = fout instanceof OutlookGraphError ? fout.categorie : microsoftTestFoutcategorie(fout);
    await vault.mislukOutlookRun(run.run_id, categorie).catch(() => undefined);
    throw fout;
  }
}
