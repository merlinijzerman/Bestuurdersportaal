"use client";

// ============================================================================
//  AutoGrowTextarea — een textarea die met zijn inhoud meegroeit, zodat lange
//  tekst niet wordt afgekapt (het probleem van de single-line inputs op het
//  organisatieprofiel-scherm). Puur presentatie; geen extra dependency.
// ----------------------------------------------------------------------------
//  Herberekent de hoogte bij elke waarde-wijziging én bij mount (zodat vooraf
//  ingeladen inhoud meteen volledig zichtbaar is). `minRows` borgt een nette
//  minimumhoogte voor lege velden.
// ============================================================================

import { useLayoutEffect, useRef } from "react";

type Props = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Minimale zichtbare regels bij lege/korte inhoud (default 2). */
  minRows?: number;
};

export default function AutoGrowTextarea({ minRows = 2, value, className, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto"; // eerst resetten zodat krimpen ook werkt
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      className={className}
      // Auto-grow beheert de hoogte zelf: geen handmatige resize-greep, geen
      // interne scrollbar die tegen de gemeten scrollHeight vecht.
      style={{ overflow: "hidden", resize: "none" }}
      {...rest}
    />
  );
}
