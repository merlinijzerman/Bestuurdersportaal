// Procestemplates — bron-van-waarheid voor de standaard procesflows.
// In iteratie 1 leven templates hier in code; bij het starten van een
// procedure wordt een snapshot in de database opgeslagen, zodat lopende
// procedures niet veranderen als de template later wordt aangepast.

export interface ProcessTemplateChecklistItem {
  volgorde: number;
  label: string;
  bewijs_vereist: boolean;
}

export interface ProcessTemplateStap {
  volgorde: number;
  naam: string;
  beschrijving: string;
  vereist_besluit: boolean;
  geschatte_dagen: number;
  checklist: ProcessTemplateChecklistItem[];
}

export interface ProcessTemplate {
  code: string;
  naam: string;
  korte_omschrijving: string;
  geschat_aantal_dagen: number;
  stappen: ProcessTemplateStap[];
}

export const TEMPLATES: ProcessTemplate[] = [
  {
    code: "uitbestedingsreview",
    naam: "Uitbestedingsreview",
    korte_omschrijving:
      "Periodieke beoordeling van een uitvoerder of vermogensbeheerder: KPI's → SLA → DD → review → bevindingen.",
    geschat_aantal_dagen: 60,
    stappen: [
      {
        volgorde: 1,
        naam: "KPI-rapportage opvragen",
        beschrijving:
          "Vraag de leverancier om de meest recente KPI- en SLA-rapportage en eventuele incidentlogboeken.",
        vereist_besluit: false,
        geschatte_dagen: 7,
        checklist: [
          {
            volgorde: 1,
            label: "Schriftelijk verzoek aan leverancier verstuurd",
            bewijs_vereist: false,
          },
          {
            volgorde: 2,
            label: "Rapportage ontvangen en compleet",
            bewijs_vereist: true,
          },
        ],
      },
      {
        volgorde: 2,
        naam: "SLA-check",
        beschrijving:
          "Vergelijk de feitelijke prestaties met de SLA-afspraken; markeer over- en onderprestaties.",
        vereist_besluit: false,
        geschatte_dagen: 7,
        checklist: [
          {
            volgorde: 1,
            label: "Per KPI scoring vastgelegd (groen/oranje/rood)",
            bewijs_vereist: true,
          },
          {
            volgorde: 2,
            label: "Afwijkingen voorzien van toelichting van leverancier",
            bewijs_vereist: false,
          },
        ],
      },
      {
        volgorde: 3,
        naam: "Due diligence-vragenlijst",
        beschrijving:
          "Doorloop de standaard DD-vragenlijst (governance, IT-security, business continuity, financiële stabiliteit).",
        vereist_besluit: false,
        geschatte_dagen: 14,
        checklist: [
          {
            volgorde: 1,
            label: "DD-vragenlijst volledig ingevuld door leverancier",
            bewijs_vereist: true,
          },
          {
            volgorde: 2,
            label: "Materiële wijzigingen sinds vorige review benoemd",
            bewijs_vereist: false,
          },
        ],
      },
      {
        volgorde: 4,
        naam: "Review-overleg",
        beschrijving:
          "Face-to-face overleg met de leverancier waarin bevindingen worden besproken en vragen geadresseerd.",
        vereist_besluit: false,
        geschatte_dagen: 14,
        checklist: [
          {
            volgorde: 1,
            label: "Overleg ingepland en gehouden",
            bewijs_vereist: false,
          },
          {
            volgorde: 2,
            label: "Verslag van overleg vastgelegd",
            bewijs_vereist: true,
          },
        ],
      },
      {
        volgorde: 5,
        naam: "Bevindingen en vervolgactie",
        beschrijving:
          "Bestuurlijk besluit over continuering, contractuele aanpassing of heroverweging van de uitbesteding.",
        vereist_besluit: true,
        geschatte_dagen: 18,
        checklist: [
          {
            volgorde: 1,
            label: "Bevindingenrapport afgerond",
            bewijs_vereist: true,
          },
          {
            volgorde: 2,
            label: "Vervolgactie geformuleerd (continueren / aanpassen / heroverweging)",
            bewijs_vereist: true,
          },
        ],
      },
    ],
  },
  {
    code: "incident_dnb",
    naam: "Incident-meldplicht DNB",
    korte_omschrijving:
      "Tijdkritisch traject bij een incident met mogelijke meldplicht — triage, melding binnen termijn, analyse, herstel.",
    geschat_aantal_dagen: 45,
    stappen: [
      {
        volgorde: 1,
        naam: "Incident geconstateerd en geregistreerd",
        beschrijving:
          "Eerste vastlegging van wat er is gebeurd, wanneer, en welke deelnemers/processen geraakt zijn.",
        vereist_besluit: false,
        geschatte_dagen: 1,
        checklist: [
          {
            volgorde: 1,
            label: "Incidentbeschrijving compleet (wat / wanneer / waar / impact)",
            bewijs_vereist: true,
          },
          {
            volgorde: 2,
            label: "Risk officer geïnformeerd",
            bewijs_vereist: false,
          },
        ],
      },
      {
        volgorde: 2,
        naam: "Triage meldplicht",
        beschrijving:
          "Bepaal of het incident onder de DNB-meldplicht valt. Tijdkritisch: meeste meldplichten lopen binnen 24-72 uur.",
        vereist_besluit: true,
        geschatte_dagen: 1,
        checklist: [
          {
            volgorde: 1,
            label: "Toetsing tegen meldplicht-criteria uitgevoerd",
            bewijs_vereist: true,
          },
          {
            volgorde: 2,
            label: "Conclusie meldplicht ja/nee gemotiveerd",
            bewijs_vereist: true,
          },
        ],
      },
      {
        volgorde: 3,
        naam: "Melding bij DNB",
        beschrijving:
          "Indien meldplichtig: melding doen via DNB-portaal binnen wettelijke termijn. Bevestiging van DNB bewaren.",
        vereist_besluit: false,
        geschatte_dagen: 1,
        checklist: [
          {
            volgorde: 1,
            label: "Melding ingediend bij DNB",
            bewijs_vereist: true,
          },
          {
            volgorde: 2,
            label: "Bevestiging van DNB ontvangen en gearchiveerd",
            bewijs_vereist: true,
          },
        ],
      },
      {
        volgorde: 4,
        naam: "Interne analyse (root cause)",
        beschrijving:
          "Onderzoek de onderliggende oorzaak. Betrek uitvoerder en/of vermogensbeheerder waar relevant.",
        vereist_besluit: false,
        geschatte_dagen: 14,
        checklist: [
          {
            volgorde: 1,
            label: "Root cause-analyse uitgevoerd",
            bewijs_vereist: true,
          },
          {
            volgorde: 2,
            label: "Impact op deelnemers gekwantificeerd",
            bewijs_vereist: true,
          },
        ],
      },
      {
        volgorde: 5,
        naam: "Herstelmaatregelen",
        beschrijving:
          "Implementeer korte- en lange-termijn herstelmaatregelen die voorkomen dat het incident zich herhaalt.",
        vereist_besluit: false,
        geschatte_dagen: 21,
        checklist: [
          {
            volgorde: 1,
            label: "Korte-termijn maatregelen geïmplementeerd",
            bewijs_vereist: true,
          },
          {
            volgorde: 2,
            label: "Lange-termijn maatregelen vastgesteld of in uitvoering",
            bewijs_vereist: true,
          },
        ],
      },
      {
        volgorde: 6,
        naam: "Lessons learned en afsluiting",
        beschrijving:
          "Vastleggen wat dit incident heeft geleerd voor toekomstige risicobeheersing. Evt. melding van afsluiting bij DNB.",
        vereist_besluit: false,
        geschatte_dagen: 7,
        checklist: [
          {
            volgorde: 1,
            label: "Lessons learned schriftelijk vastgelegd",
            bewijs_vereist: true,
          },
          {
            volgorde: 2,
            label: "Risico-update doorgevoerd in risicomatrix",
            bewijs_vereist: false,
          },
          {
            volgorde: 3,
            label: "Afsluiting gemeld bij DNB (indien van toepassing)",
            bewijs_vereist: false,
          },
        ],
      },
    ],
  },
  {
    code: "beleidswijziging",
    naam: "Beleidswijziging",
    korte_omschrijving:
      "Voorstel → impactanalyse → bestuursoverleg → besluit → implementatie → evaluatie.",
    geschat_aantal_dagen: 90,
    stappen: [
      {
        volgorde: 1,
        naam: "Voorstel opstellen",
        beschrijving:
          "Stel een conceptvoorstel op met aanleiding, alternatieven, gevraagd besluit en verwachte impact.",
        vereist_besluit: false,
        geschatte_dagen: 5,
        checklist: [
          {
            volgorde: 1,
            label: "Aanleiding en context beschreven",
            bewijs_vereist: true,
          },
          { volgorde: 2, label: "Alternatieven gewogen", bewijs_vereist: false },
          {
            volgorde: 3,
            label: "Gevraagd besluit expliciet geformuleerd",
            bewijs_vereist: true,
          },
        ],
      },
      {
        volgorde: 2,
        naam: "Impactanalyse",
        beschrijving:
          "Financiele, juridische en communicatie-impact in kaart, inclusief risicobeoordeling.",
        vereist_besluit: false,
        geschatte_dagen: 10,
        checklist: [
          {
            volgorde: 1,
            label: "Financiele impact gekwantificeerd",
            bewijs_vereist: true,
          },
          {
            volgorde: 2,
            label: "Juridische impact gecheckt",
            bewijs_vereist: false,
          },
          {
            volgorde: 3,
            label: "Communicatieplan opgesteld",
            bewijs_vereist: true,
          },
          {
            volgorde: 4,
            label: "Risicobeoordeling vastgelegd",
            bewijs_vereist: true,
          },
        ],
      },
      {
        volgorde: 3,
        naam: "Bestuursoverleg",
        beschrijving:
          "Bespreek het beleidsvoorstel in een bestuursvergadering, verzamel inbreng commissies, leg overwegingen vast.",
        vereist_besluit: false,
        geschatte_dagen: 14,
        checklist: [
          {
            volgorde: 1,
            label: "Vergadering ingepland waarin voorstel wordt besproken",
            bewijs_vereist: false,
          },
          {
            volgorde: 2,
            label: "Voorstel als agendapunt toegevoegd",
            bewijs_vereist: false,
          },
          {
            volgorde: 3,
            label: "Inbreng commissies ontvangen",
            bewijs_vereist: true,
          },
          {
            volgorde: 4,
            label: "Overwegingen schriftelijk vastgelegd",
            bewijs_vereist: true,
          },
        ],
      },
      {
        volgorde: 4,
        naam: "Bestuursbesluit",
        beschrijving:
          "Formele besluitvastlegging met motivering en stemverhouding.",
        vereist_besluit: true,
        geschatte_dagen: 7,
        checklist: [
          {
            volgorde: 1,
            label: "Besluit geformuleerd in concrete termen",
            bewijs_vereist: true,
          },
          { volgorde: 2, label: "Stemverhouding genoteerd", bewijs_vereist: false },
          {
            volgorde: 3,
            label: "Motivering opgeslagen voor audittrail",
            bewijs_vereist: true,
          },
        ],
      },
      {
        volgorde: 5,
        naam: "Implementatie",
        beschrijving:
          "Operationele uitvoering van het besluit door uitvoerder en/of vermogensbeheerder.",
        vereist_besluit: false,
        geschatte_dagen: 28,
        checklist: [
          {
            volgorde: 1,
            label: "Opdracht aan uitvoerder/vermogensbeheerder verstuurd",
            bewijs_vereist: true,
          },
          {
            volgorde: 2,
            label: "Bevestiging implementatie ontvangen",
            bewijs_vereist: true,
          },
        ],
      },
      {
        volgorde: 6,
        naam: "Evaluatie",
        beschrijving:
          "Korte terugblik na zes maanden: heeft de wijziging het beoogde effect gehad?",
        vereist_besluit: false,
        geschatte_dagen: 30,
        checklist: [
          { volgorde: 1, label: "Effect-meting uitgevoerd", bewijs_vereist: true },
          { volgorde: 2, label: "Conclusies vastgelegd", bewijs_vereist: true },
        ],
      },
    ],
  },
];

export function vindTemplate(code: string): ProcessTemplate | undefined {
  return TEMPLATES.find((t) => t.code === code);
}

export function templateLabel(code: string): string {
  return vindTemplate(code)?.naam ?? code;
}

// Status-labels voor procedures
export const PROCEDURE_STATUS_LABEL: Record<string, string> = {
  in_uitvoering: "In uitvoering",
  wacht_op_besluit: "Wacht op besluit",
  afgerond: "Afgerond",
};

export const STAP_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  actief: "Actief",
  afgerond: "Afgerond",
};
