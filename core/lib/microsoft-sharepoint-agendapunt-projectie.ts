// Browserveilige projectie van SharePoint-koppelingen bij een agendapunt.
//
// De private koppeltabel bevat weergavemetadata, maar die is NOOIT een
// autorisatiebron. Alleen een bron die in de actuele, delegated Graph-listing
// terugkomt krijgt naam/pad/type/links. Bij iedere fout blijft uitsluitend de
// neutrale placeholder over (B-6 van #462).

export type SharePointAgendakoppelingRuw = {
  koppeling_id: string;
  agendapunt_id: string;
  soort: "document" | "map";
  ref: string;
};

export type LiveSharePointDocument = {
  ref: string;
  naam: string;
  bestandstype: string | null;
  mappad: string;
  previewMogelijk: boolean;
  webUrl: string | null;
};

export type LiveSharePointMap = {
  ref: string;
  naam: string;
  mappad: string;
};

export type VeiligeSharePointAgendakoppeling =
  | {
      koppelingId: string;
      agendapuntId: string;
      toegankelijk: false;
      label: "Gekoppelde SharePoint-bron";
    }
  | {
      koppelingId: string;
      agendapuntId: string;
      toegankelijk: true;
      soort: "document" | "map";
      naam: string;
      mappad: string;
      bestandstype: string | null;
      previewHref: string | null;
      microsoft365Url: string | null;
    };

const AFGESCHERMD = "Gekoppelde SharePoint-bron" as const;

export function projecteerSharePointAgendakoppelingen(
  koppelingen: readonly SharePointAgendakoppelingRuw[],
  live?: {
    documenten: readonly LiveSharePointDocument[];
    mappen: readonly LiveSharePointMap[];
  }
): VeiligeSharePointAgendakoppeling[] {
  const documenten = new Map((live?.documenten ?? []).map((d) => [d.ref, d]));
  const mappen = new Map((live?.mappen ?? []).map((m) => [m.ref, m]));

  return koppelingen.map((koppeling) => {
    const basis = {
      koppelingId: koppeling.koppeling_id,
      agendapuntId: koppeling.agendapunt_id,
    };
    if (koppeling.soort === "document") {
      const document = documenten.get(koppeling.ref);
      if (document) {
        return {
          ...basis,
          toegankelijk: true as const,
          soort: "document" as const,
          naam: document.naam,
          mappad: document.mappad,
          bestandstype: document.bestandstype,
          previewHref: document.previewMogelijk
            ? `/bibliotheek/sharepoint/${encodeURIComponent(document.ref)}`
            : null,
          microsoft365Url: document.webUrl,
        };
      }
    } else {
      const map = mappen.get(koppeling.ref);
      if (map) {
        return {
          ...basis,
          toegankelijk: true as const,
          soort: "map" as const,
          naam: map.naam,
          mappad: map.mappad,
          bestandstype: null,
          previewHref: "/bibliotheek",
          microsoft365Url: null,
        };
      }
    }
    return { ...basis, toegankelijk: false as const, label: AFGESCHERMD };
  });
}

export function refsZijnLiveToegankelijk(
  bronnen: readonly { soort: "document" | "map"; ref: string }[],
  live: {
    documenten: readonly Pick<LiveSharePointDocument, "ref">[];
    mappen: readonly Pick<LiveSharePointMap, "ref">[];
  }
): boolean {
  const documenten = new Set(live.documenten.map((d) => d.ref));
  const mappen = new Set(live.mappen.map((m) => m.ref));
  return bronnen.every((bron) =>
    bron.soort === "document"
      ? documenten.has(bron.ref)
      : mappen.has(bron.ref)
  );
}
