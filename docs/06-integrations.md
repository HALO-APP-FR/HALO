# HALO — Intégrations (décision stratégique du 26/10/2026)

## Positionnement
**HALO est la couche logistique qui se branche sur le logiciel de gestion (PMS) que la conciergerie utilise déjà.**
On ne remplace rien. On ne fait que la logistique, et on la fait mieux que tout le monde.

| Le PMS du client garde | HALO prend en charge |
|---|---|
| Réservations, calendrier, channel manager | Ménages et rotations |
| Messages voyageurs | Planning des équipes terrain |
| Prix, paiements, facturation | Check-in / check-out terrain |
| Comptabilité propriétaires | Linge (stock, besoins, blanchisserie) |
| Fiches annonces | Contrôle qualité photo, incidents |

Règle produit : **toute fonctionnalité qui existe déjà dans un PMS n'est pas construite dans HALO.**

## Ordre des connecteurs
1. **iCal** (fait en phase 4) — universel, solution de secours pour tout le monde.
2. **Smoobu** — très répandu chez les petites et moyennes conciergeries en Europe.
3. **Lodgify**
4. **Beds24**
5. **Hostaway**
6. **Guesty** — gros comptes, programme partenaire plus exigeant.

L'ordre définitif sera ajusté selon ce qu'utilisent les conciergeries interrogées sur le terrain.

## Ce qu'une intégration API apporte de plus que l'iCal
- Nombre de voyageurs réel → linge calculé juste.
- Heures réelles d'arrivée et de départ, arrivée anticipée / départ tardif.
- Mises à jour en temps réel par webhook (plus de délai de 15 min).
- Nom de l'annonce et adresse importés automatiquement → création des logements en un clic.
- **Retour vers le PMS** (si l'API le permet) : logement marqué « prêt », incident ajouté en note sur la réservation.

## Architecture (obligatoire pour Cursor)
Tous les connecteurs implémentent la même interface. Le moteur d'opérations (`src/lib/engine/`) ne connaît **jamais** le PMS d'origine.

```ts
// src/lib/integrations/types.ts
export interface ExternalListing {
  externalId: string;
  name: string;
  address?: string;
  city?: string;
  countryCode?: string;
  timezone?: string;
  maxGuests?: number;
}

export interface ExternalReservation {
  externalId: string;
  listingExternalId: string;
  status: "confirmed" | "cancelled" | "blocked";
  checkInAt: Date;   // UTC
  checkOutAt: Date;  // UTC
  guestsCount?: number;
  guestDisplayName?: string; // prénom ou initiale uniquement (RGPD)
}

export interface PmsConnector {
  id: "ical" | "smoobu" | "lodgify" | "beds24" | "hostaway" | "guesty";
  listListings(): Promise<ExternalListing[]>;
  listReservations(range: { from: Date; to: Date }): Promise<ExternalReservation[]>;
  /** Transforme un webhook reçu en événements normalisés (null si non pertinent). */
  parseWebhook?(headers: Headers, body: unknown): Promise<ExternalReservation[] | null>;
  /** Optionnel : signaler au PMS qu'un logement est prêt. */
  markListingReady?(listingExternalId: string, at: Date): Promise<void>;
}
```

Organisation :
```
src/lib/integrations/
  types.ts            interface commune
  registry.ts         connecteur par id
  ical/               connecteur iCal
  smoobu/ …           un dossier par PMS
src/app/api/webhooks/[provider]/route.ts   réception des webhooks (signature vérifiée)
```

## Modèle de données à ajouter (migration dédiée)
- `integrations` : `organization_id`, `provider`, `status`, identifiants **chiffrés** (jamais en clair, jamais renvoyés au navigateur), `last_synced_at`, `last_error`.
- `properties.external_ref` et `reservations.external_ref` : (`provider`, `external_id`) unique par organisation.
- `calendar_feeds` devient le cas particulier « provider = ical ».

## Règles
1. Une réservation venant d'un PMS est **en lecture seule** dans HALO : on ne la modifie jamais.
2. Si un logement est relié à une API ET à un iCal, l'API gagne, l'iCal est ignoré pour ce logement.
3. Webhook + resynchronisation complète toutes les heures en filet de sécurité (les webhooks se perdent).
4. Chaque connecteur a des tests avec des réponses d'API enregistrées (fixtures), sans appel réseau.
5. On n'utilise que les API officielles et documentées de chaque PMS, dans le respect de leurs conditions.

## Distribution
Chaque connecteur ouvre une porte commerciale : candidater aux **marketplaces / programmes partenaires** des PMS dès qu'un connecteur est stable. C'est le canal d'acquisition prioritaire.
