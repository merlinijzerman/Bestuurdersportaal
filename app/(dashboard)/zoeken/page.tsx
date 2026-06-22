// ============================================================================
//  /zoeken — verplaatst naar de Documentbibliotheek (Increment F-vervolg).
// ----------------------------------------------------------------------------
//  Het uitgebreide (semantische) zoeken leeft nu binnen /bibliotheek (knop
//  "Uitgebreid zoeken"); de zoeklogica staat in
//  app/(dashboard)/bibliotheek/_components/ZoekenPaneel.tsx. Deze route blijft
//  bestaan als wegwijzer: oude links/bookmarks naar /zoeken landen netjes op de
//  bibliotheek met het zoekpaneel direct geopend (geen 404, geen dubbele UI).
// ============================================================================

import { redirect } from "next/navigation";

export default function ZoekenRedirect() {
  redirect("/bibliotheek?weergave=zoeken");
}
