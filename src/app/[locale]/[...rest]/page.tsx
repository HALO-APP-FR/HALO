import { notFound } from "next/navigation";

/** Toute adresse inconnue sous une langue : page introuvable localisée (et non la page générique en anglais). */
export default function CatchAll() {
  notFound();
}
