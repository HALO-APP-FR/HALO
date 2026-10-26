/**
 * Modèles de checklists proposés à la création d'un logement.
 * Ce sont des données de départ : la conciergerie les modifie librement ensuite.
 */
import type { BedSize, ChecklistRoom } from "./types";

type Lang = "fr" | "en";
type Template = { key: string; rooms: { name: Record<Lang, string>; items: { label: Record<Lang, string>; photo?: boolean }[] }[] };

const KITCHEN = {
  name: { fr: "Cuisine", en: "Kitchen" },
  items: [
    { label: { fr: "Vaisselle propre et rangée", en: "Dishes clean and put away" } },
    { label: { fr: "Plan de travail et plaques nettoyés", en: "Counters and hob cleaned" } },
    { label: { fr: "Réfrigérateur vidé et propre", en: "Fridge emptied and clean" } },
    { label: { fr: "Poubelles vidées, sacs neufs", en: "Bins emptied, new bags" } },
    { label: { fr: "Photo de la cuisine terminée", en: "Photo of the finished kitchen" }, photo: true },
  ],
};
const BATHROOM = {
  name: { fr: "Salle de bain", en: "Bathroom" },
  items: [
    { label: { fr: "Douche / baignoire détartrée", en: "Shower / bath descaled" } },
    { label: { fr: "WC désinfectés", en: "Toilet disinfected" } },
    { label: { fr: "Serviettes propres posées", en: "Clean towels laid out" } },
    { label: { fr: "Papier toilette réapprovisionné", en: "Toilet paper restocked" } },
    { label: { fr: "Photo de la salle de bain terminée", en: "Photo of the finished bathroom" }, photo: true },
  ],
};
const LIVING = {
  name: { fr: "Séjour", en: "Living room" },
  items: [
    { label: { fr: "Sols aspirés et lavés", en: "Floors vacuumed and mopped" } },
    { label: { fr: "Surfaces dépoussiérées", en: "Surfaces dusted" } },
    { label: { fr: "Objets oubliés vérifiés", en: "Checked for forgotten items" } },
    { label: { fr: "Photo du séjour terminé", en: "Photo of the finished living room" }, photo: true },
  ],
};
const bedroom = (n: number) => ({
  name: { fr: n > 1 ? `Chambre ${n}` : "Chambre", en: n > 1 ? `Bedroom ${n}` : "Bedroom" },
  items: [
    { label: { fr: "Draps changés, lit fait", en: "Sheets changed, bed made" } },
    { label: { fr: "Sous le lit vérifié", en: "Under the bed checked" } },
    { label: { fr: "Photo du lit fait", en: "Photo of the made bed" }, photo: true },
  ],
});

export const CHECKLIST_TEMPLATES: Template[] = [
  { key: "studio", rooms: [LIVING, KITCHEN, BATHROOM] },
  { key: "apartment", rooms: [LIVING, KITCHEN, bedroom(1), bedroom(2), BATHROOM] },
  { key: "house", rooms: [LIVING, KITCHEN, bedroom(1), bedroom(2), bedroom(3), BATHROOM] },
];

let idSeq = 0;
export function newId(prefix = "id"): string {
  try {
    return `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
  } catch {
    idSeq += 1;
    return `${prefix}_${Date.now().toString(36)}${idSeq}`;
  }
}

/** Construit une checklist à partir d'un modèle, dans la langue de l'utilisateur. */
export function buildChecklist(templateKey: string, locale: string): ChecklistRoom[] {
  const lang: Lang = locale === "fr" ? "fr" : "en";
  const tpl = CHECKLIST_TEMPLATES.find((t) => t.key === templateKey) ?? CHECKLIST_TEMPLATES[0];
  return tpl.rooms.map((room) => ({
    id: newId("room"),
    name: room.name[lang],
    items: room.items.map((it) => ({ id: newId("item"), label: it.label[lang], photoRequired: Boolean(it.photo) })),
  }));
}

/** Modèle conseillé selon le nombre de lits (hors canapé-lit). */
export function suggestedTemplate(beds: { size: BedSize }[]): string {
  const realBeds = beds.filter((b) => b.size !== "sofa_bed").length;
  if (realBeds <= 1) return "studio";
  if (realBeds <= 2) return "apartment";
  return "house";
}

/** Durée de ménage conseillée (minutes), arrondie au quart d'heure. */
export function suggestedCleaningDuration(capacity: number, beds: number): number {
  const minutes = 60 + beds * 25 + Math.max(0, capacity - 2) * 10;
  return Math.max(60, Math.round(minutes / 15) * 15);
}
