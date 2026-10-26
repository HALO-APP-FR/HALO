# HALO — Moteur d'opérations (algorithmes métier)

C'est le cœur de la valeur. Chaque fonction ici doit être **pure, testée unitairement** et vivre dans `src/lib/engine/`.

## 1. Synchronisation iCal — `syncFeed(feedId)`
Fréquence : toutes les 15 min (Vercel Cron → route `/api/cron/sync-ical`, protégée par `CRON_SECRET`) + bouton « Synchroniser maintenant ».

1. Télécharger l'URL (timeout 15 s, User-Agent explicite). En cas d'échec : écrire `last_error`, ne rien supprimer, sortir.
2. Parser avec `node-ical`. Pour chaque `VEVENT` :
   - `external_uid` = `UID`.
   - Dates : les flux Airbnb/Booking donnent des **dates sans heure** (`DTSTART;VALUE=DATE`). Convertir : `check_in_at` = date de début + `default_check_in_time` du logement **dans le fuseau du logement**, `check_out_at` = date de fin + `default_check_out_time`. Utiliser `date-fns-tz` (`fromZonedTime`). Si l'événement a une heure, la garder.
   - Statut : si le résumé contient « Not available », « Blocked », « Closed », « Indisponible » → `blocked` (pas de ménage généré). Sinon `confirmed`.
   - `guest_name` : extrait du résumé si présent, sinon « Réservation {source} ».
3. **Upsert** sur `(feed_id, external_uid)`.
4. Événements présents en base mais **absents du flux** et dont `check_out_at` est dans le futur → `status = 'cancelled'`.
5. Appeler `regenerateTasks(propertyId)`.
6. Écrire `last_synced_at = now()`, `last_error = null`.

**Doublons multi-plateformes** : un même séjour peut apparaître sur Airbnb ET comme blocage sur Booking. Règle : si deux réservations du même logement se chevauchent et que l'une est `blocked`, on ignore le blocage pour la génération de tâches.

## 2. Génération des tâches — `regenerateTasks(propertyId)`
Entrée : réservations `confirmed` du logement, triées par `check_in_at`, sur la période [aujourd'hui − 1 j ; aujourd'hui + 90 j].

Pour chaque réservation R (sortante) et la suivante N (entrante) :
1. **Ménage de rotation** (`turnover`) :
   - `window_start` = `R.check_out_at`
   - `window_end` = `N.check_in_at` si N existe, sinon `R.check_out_at + 3 jours`
   - `priority` = `high` si `R.check_out_at` et `N.check_in_at` tombent le même jour calendaire **dans le fuseau du logement** ; `urgent` si la fenêtre fait moins que `cleaning_duration_min`.
   - `duration_min` = `cleaning_duration_min` du logement.
   - `reservation_id` = R, `next_reservation_id` = N.
2. **Check-in** (si l'organisation a activé « Accueil physique » sur le logement) : fenêtre = `N.check_in_at − 30 min` → `N.check_in_at + 2 h`.
3. **Check-out** (si activé) : fenêtre = `R.check_out_at − 15 min` → `R.check_out_at + 1 h`.

Règles de mise à jour (idempotence, la fonction peut tourner 100 fois sans effet de bord) :
- Tâche auto existante pour `(reservation_id, type)` → **mettre à jour** fenêtre et priorité seulement si statut ∈ {`unassigned`,`assigned`}. Si l'agent est déjà assigné et que la fenêtre change → notification `task_changed`.
- Réservation passée à `cancelled` → tâches auto liées en {`unassigned`,`assigned`} → `cancelled` + notification `task_cancelled` à l'agent.
- Tâche `in_progress`, `done`, `validated` : **jamais touchée** automatiquement.
- À la création d'une tâche de ménage : copier la checklist du logement dans `task_checklist_items` et calculer `task_linen` (voir §4).

## 3. Planning — détection de conflits — `detectConflicts(tasks)`
Pour un agent et un jour donnés, une tâche occupe [`scheduled_start` ; `scheduled_start + duration_min`]. Si `scheduled_start` est vide, on prend `window_start`.
Conflits retournés :
- `overlap` : deux tâches du même agent se chevauchent.
- `outside_window` : l'occupation déborde de [`window_start` ; `window_end`].
- `unavailable` : chevauche une `agent_unavailability`.
- `travel_tight` (bonus, si coordonnées connues) : moins de 15 min entre la fin d'une tâche et le début de la suivante alors que les logements sont à plus de 3 km (distance à vol d'oiseau, formule de Haversine).

## 4. Linge — `computeLinenNeeds(task)`
Pour chaque règle `property_linen_rules` du logement :
`qty_planned = qty_fixed + qty_per_guest × guests_count(N)` (N = réservation entrante ; si `guests_count` inconnu → capacité du logement).

À la fin d'une tâche, pour chaque ligne `task_linen` :
- mouvement `qty_placed` : `central_stock` → emplacement du logement (`reason = 'turnover'`) ;
- mouvement `qty_removed` : emplacement du logement → `dirty`.

**Prévision 7 jours** — `forecastLinen(orgId)` : somme des `qty_planned` des tâches non terminées des 7 prochains jours, par type de linge, comparée au stock `central_stock`. Retourne pour chaque type : besoin, disponible, écart, et **date de rupture estimée** (premier jour où le cumul des besoins dépasse le disponible).

**Bon blanchisserie** : envoi = mouvement `dirty` → `laundry` ; réception = `laundry` → `central_stock` pour `qty_received`, et `laundry` → (sortie, `reason = 'damage'`) pour `qty_damaged`. Écart `qty_sent − qty_received − qty_damaged` > 0 → alerte « perdu ».

## 5. Notifications — `notify(userId, kind, payload)`
1. Insérer dans `notifications`.
2. Envoyer un push web (bibliothèque `web-push`, clés VAPID) à toutes les `push_subscriptions` de la personne ; supprimer celles qui renvoient 404/410.
3. Le texte est construit **dans la langue de la personne destinataire** (`profiles.locale`), pas de celui qui déclenche.

Déclencheurs MVP : tâche assignée, modifiée, annulée, en retard (cron toutes les 15 min : `window_end` dépassée et statut ≠ terminé → manager notifié), reprise demandée, incident créé (urgent → push immédiat aux managers).

## 6. Tests unitaires obligatoires (Vitest)
- Rotation à J à Paris vs à Bali (fuseaux différents, même instant UTC).
- Passage à l'heure d'été / d'hiver (dernier dimanche de mars et d'octobre en Europe).
- Réservation sans suivante → fenêtre J+3.
- Annulation d'une réservation avec tâche assignée → tâche annulée + notification.
- Annulation d'une réservation avec tâche en cours → tâche intacte.
- Relancer `regenerateTasks` deux fois → aucun doublon.
- Calcul linge avec voyageurs connus / inconnus.
- Conflit de chevauchement et hors fenêtre.
