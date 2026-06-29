// Decoratieve dossierkaart (server component) voor de marketingssecties.
// Puur illustratief — aria-hidden zodat screenreaders de losse rijen niet
// als inhoud voorlezen (FO §9). Geen echte data, geen interactie.
export default function DossierKaart({
  titel,
  status,
  rijen,
}: {
  titel: string;
  status: string;
  rijen: { label: string; waarde: string }[];
}) {
  return (
    <div className="dossier" aria-hidden="true">
      <div className="dh">
        <span>{titel}</span>
        <span>{status}</span>
      </div>
      {rijen.map((r) => (
        <div className="row" key={r.label}>
          <span>
            <span className="dot" />
            {r.label}
          </span>
          <span className="v">{r.waarde}</span>
        </div>
      ))}
    </div>
  );
}
