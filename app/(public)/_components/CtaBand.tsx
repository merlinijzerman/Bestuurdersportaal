// Afsluitende CTA-band (server component), gedeeld door homepage + subpagina's.
// Primaire CTA is overal "Neem contact op" (of een expliciete variant zoals
// "Bespreek een pilot" op de pensioenpagina). Secundaire CTA's zijn optioneel.
type Cta = { href: string; label: string; extern?: boolean };

export default function CtaBand({
  label,
  kop,
  tekst,
  primair,
  secundair = [],
}: {
  label?: string;
  kop: string;
  tekst?: string;
  primair: Cta;
  secundair?: Cta[];
}) {
  return (
    <section className="cta-band">
      <div className="wrap inner">
        <div>
          {label && <div className="label">{label}</div>}
          <h2>{kop}</h2>
          {tekst && <p>{tekst}</p>}
        </div>
        <div className="btns">
          <a href={primair.href} className="btn btn-primary">
            {primair.label}
          </a>
          {secundair.map((s) => (
            <a
              key={s.href + s.label}
              href={s.href}
              className="btn btn-outline"
              {...(s.extern
                ? { target: "_blank", rel: "noopener" }
                : {})}
            >
              {s.label}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
