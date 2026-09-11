import { permanentRedirect } from "next/navigation";

// v0.8: /sectoren/pensioenfondsen is samengevoegd met /voor-wie. Permanente redirect, zodat
// bestaande links en zoekresultaten op de nieuwe pagina uitkomen.
export default function Pagina() {
  permanentRedirect("/voor-wie");
}
