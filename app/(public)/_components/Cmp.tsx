// Vergelijkingstabel voor het onderscheidingsblok (copy §10). Geen
// concurrentennamen — vergelijking op oplossingscategorieën, neutrale toon
// ("wat vaak buiten beeld blijft", "aanvullend onderscheidend"). Op ≤640px
// stapelt de tabel tot kaarten via data-label + ::before (public.css).
const KOLOMMEN = ["Primaire focus", "Wat vaak buiten beeld blijft", "Waar Bestuurdersportaal aanvullend onderscheidend is"];

const RIJEN: { cat: string; cellen: string[]; spec?: boolean }[] = [
  {
    cat: "Klassiek bestuurdersportaal",
    cellen: [
      "Vergaderstukken, agenda's, notulen, besluitregistratie",
      "De inhoudelijke totstandkoming van het besluit: bronnen, risico's, aannames, alternatieven, opvolging",
      "Ondersteunt de volledige besluitcyclus: voorbereiding, analyse, afweging, besluit, verantwoording, evaluatie",
    ],
  },
  {
    cat: "Documentportaal / DMS",
    cellen: [
      "Documenten opslaan, ordenen, delen, terugvinden",
      "De verbinding tussen documenten en het concrete bestuurlijke vraagstuk",
      "Verbindt documenten aan besluitdossiers, bronnen, risico's, aannames, besluiten en acties",
    ],
  },
  {
    cat: "GRC-tool",
    cellen: [
      "Risico's, controls, compliance en rapportages beheren",
      "De koppeling tussen governance-informatie en het feitelijke bestuurlijke besluit",
      "Brengt risico's, beheersing en verantwoordingsinformatie direct in de besluitcontext",
    ],
  },
  {
    cat: "Losse AI-chat",
    cellen: [
      "Vragen beantwoorden, samenvatten, documenten analyseren",
      "Governance, bronbinding, rollen, rechten, besluitdossier, logging, bestuurlijke context",
      "Werkt brongebonden binnen de eigen documentcontext, met dossiervorming binnen governancekaders",
    ],
  },
  {
    cat: "Bestuurdersportaal",
    cellen: [
      "Besluitvorming als proces én dossier",
      "— dit is de kern",
      "Eén omgeving waarin informatie, analyse, afweging, besluitvorming, verantwoording en evaluatie samenkomen",
    ],
    spec: true,
  },
];

export default function Cmp() {
  return (
    <div className="cmp">
      <table>
        <thead>
          <tr>
            <th scope="col">Oplossingscategorie</th>
            {KOLOMMEN.map((k) => (
              <th key={k} scope="col">
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {RIJEN.map((r) => (
            <tr key={r.cat} className={r.spec ? "spec" : undefined}>
              <th scope="row">{r.cat}</th>
              {r.cellen.map((c, i) => (
                <td key={i} data-label={KOLOMMEN[i]}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
