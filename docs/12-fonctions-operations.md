# HALO — Intégration des nouvelles fonctions (opérations quotidiennes)

Statut au 27/10/2026. Branche `feat/operations`, **non fusionnée dans `main`** : rien n'est en production. Vercel peut construire un aperçu (*preview*) de la branche, qui n'est pas la production.

## 0. État réel constaté avant les travaux

| Élément | Réel | Maquette ou absent |
|---|---|---|
| Données | Démo : tout est dans le navigateur (`halo-demo-v1`) | Base Supabase écrite et testée (lot 1.1), **pas branchée** |
| Connexion, rôles | — | Écran de connexion factice. Aucun compte. L'espace se choisit par l'URL |
| Contrôle côté serveur | Règles d'accès (RLS) et fonctions de la base, testées localement et en CI | Aucune session : la protection côté serveur des écrans dépend de l'étape 1.3 |
| Notifications | — | Aucun service d'envoi (e-mail, push, SMS) |
| Lien voyageur | Livret dans le lien (`#d=`), sans code d'accès | Ni révocation, ni expiration par séjour (il faut le serveur) |
| Itinéraire | Lien Google Maps uniquement | — |

**Défauts trouvés et corrigés**
- Le bouton « Terminer » de la carte mission contournait les photos obligatoires.
- Le motif de correction écrasait les consignes de la mission.
- Aucun historique de la mission.
- Toutes les missions exigeaient une validation par un responsable.
- La checklist de ménage s'appliquait aussi aux accueils.
- Une mission en correction après sa fenêtre s'affichait « mission non faite ».

## 1. Phase par phase

### Phase 2 — Fiches équipe ✅
- **Fichiers** : `src/components/views/team.tsx`, `src/lib/domain/types.ts` (`Collaboration`), `seed.ts`, migration `20261028000001` (colonne `memberships.collaboration`).
- **Comportement**
  - Une fiche existante s'ouvre en consultation. Il faut appuyer sur **Modifier** pour l'éditer, et **Annuler** ramène à la consultation.
  - Le téléphone est un lien `tel:`, uniquement si le numéro est plausible.
  - Le **type de collaboration** (salarié, indépendant, entreprise partenaire) est séparé du rôle et du poste. Il est indiqué qu'il ne donne aucun droit.
  - Aucune donnée contractuelle n'est collectée.
- **Vérifications (base)**
  - Un manager peut renseigner le type de collaboration d'un agent, pas celui du owner.
  - Un agent ne peut pas modifier le sien.
  - Le manager d'une autre organisation ne peut rien modifier.
- **Limite** : en démo, n'importe qui peut ouvrir la page Équipe (aucun compte).

### Phase 3 — Cycle de fin de mission ✅
Les statuts s'affichent ainsi :
- À faire
- En cours
- Terminée, à valider
- Validée
- Correction demandée

- **Fichiers**
  - `src/lib/engine/mission-cycle.ts` : les règles, testées.
  - `halo-store.ts` : `startTask`, `submitTask`, `validateTask`, `requestCorrection`.
  - `task-sheet.tsx`, `task-history.tsx`, `agent-task.tsx`, `agent-views.tsx`, `settings.tsx`.
  - Migration `20261028000001` :
    - tables `task_events` et `task_report_versions` ;
    - `finish_task` revu ;
    - nouvelles fonctions `validate_task` et `request_correction` ;
    - colonne `organizations.validation_task_types`.
- **Comportement**
  - Seul l'agent assigné peut démarrer sa mission et la soumettre.
  - Les photos obligatoires sont vérifiées par la règle elle-même (démo) et par la base (production), pas seulement par l'écran. Cela ne concerne que le ménage et le contrôle.
  - L'heure réelle de fin est enregistrée.
  - La validation par un responsable est **configurable par type de mission** (Réglages). Par défaut, seul le ménage la demande ; les autres types sont validés automatiquement, et c'est tracé.
  - Une demande de correction exige un motif. Le compte rendu soumis est **conservé** à part, et la mission revient à l'agent.
  - L'historique enregistre l'auteur et l'heure de chaque étape. En production, un déclencheur de la base le remplit pour toute modification, même faite directement par un manager.
  - L'agent ne peut modifier ni l'affectation, ni le logement, ni la fenêtre, ni la durée, ni l'organisation : il n'a aucune écriture directe (RLS).
- **Vérifications**
  - Cycle complet en base : photo manquante, puis rejeu de l'action, correction, reprise, validation.
  - Historique et auteurs vérifiés.
  - Personne ne peut écrire ou effacer l'historique.
  - Manager d'une autre organisation refusé.
  - Validation automatique pour un accueil.
  - 7 tests unitaires du magasin et des règles.
- **Limite** : en démo, « qui agit » est la personne choisie dans le profil, pas un compte.

### Phase 4 — Demandes de prestation ✅
- **Fichiers** : `service-sheet.tsx`, `services.tsx`, `service-meta.tsx`, `manager-today.tsx`, `manager-shell.tsx`.
- **Comportement**
  - Les demandes en attente apparaissent dans la zone **À traiter** de l'accueil Manager, avec un compteur. Le même compteur figure sur l'onglet Prestations.
  - Le filtre s'appelle **Prestations demandées**.
  - Actions possibles : **Accepter**, **Demander des précisions** (note obligatoire), **Refuser** (motif obligatoire), affecter à l'équipe ou à un partenaire.
  - Chaque changement est tracé, avec son auteur.
  - Chaque action précise que **le voyageur n'est pas prévenu automatiquement**.
  - Une prestation n'est jamais une alerte ni un incident : la page Alertes ne traite que les incidents.
- **Limite** : pas encore en base. Les prestations font partie des fonctions prévues après le socle.

### Phase 7 — Itinéraires ✅
- **Fichiers** : `src/lib/engine/directions.ts` (testé), `directions-button.tsx`, sur l'écran mission, la carte mission et la fiche logement ; réglage dans le profil Agent et dans Réglages ; colonne `profiles.maps_app`.
- **Comportement**
  - Choix entre Apple Plans, Google Maps et Waze, avec une application par défaut et la possibilité d'en choisir une autre ponctuellement.
  - Les adresses sont correctement encodées.
  - Les coordonnées, si elles sont présentes et valides, sont utilisées en priorité.
  - Si l'adresse est incomplète, on se replie sur « nom du logement + ville », et c'est signalé comme approximatif.
  - Aucune localisation de l'agent n'est demandée.
- **Limites**
  - Vérifié dans Chromium (iPhone simulé et ordinateur). Les tests sur de vrais appareils iOS et Android restent à faire.
  - La saisie des coordonnées d'un logement n'est pas encore dans le formulaire.

### Phase 1 — Espaces Manager / Agent ✅ dans la démo, ⏳ côté serveur
- **Fichiers**
  - `src/lib/auth/spaces.ts` : `spacesFor`, `landingFor`, `canOpenSpace`, testés.
  - `src/app/[locale]/page.tsx` : page de choix.
  - `agent-task.tsx` : une mission non assignée à la personne n'est pas affichée.
- **Règle**
  - Un agent arrive directement dans l'espace Agent ; un manager dans l'espace Manager.
  - Une personne avec deux rôles (par exemple un gérant qui fait aussi le terrain, ou deux organisations) choisit son espace.
  - Le choix d'espace ne change aucun droit.
- **Déjà vrai en base** : un agent ne peut appeler aucune fonction manager (créer ou modifier une mission, valider, inviter, changer un rôle, modifier un code d'accès). C'est testé.
- **Reste pour l'étape 1.3 (connexion)** : vérification de la session dans les écrans Manager et redirection côté serveur par `landingFor()`. Sans compte, la démo laisse les deux espaces ouverts et l'écrit sur la page d'accueil.

### Phase 6 — Notifications ✅ dans l'application, ⏳ e-mail et push
- **Fichiers** : `src/lib/engine/notifications.ts` (testé), `src/components/halo/inbox.tsx` (cloche dans les deux espaces), Réglages.
- **Comportement**
  - Les notifications sont **calculées depuis les données réelles** :
    - nouvelle prestation ;
    - mission à valider ;
    - correction (pour l'agent concerné) ;
    - mission en retard ou irréalisable ;
    - mission non attribuée dans les 24 h ;
    - incident urgent ;
    - rupture de linge.
  - Compteur de non-lues, et ouverture directe de la mission ou de la prestation concernée.
  - Chaque notification a une clé stable : pas de doublon si la même opération est rejouée.
  - Les incidents urgents sont **critiques** : rouges, en tête, impossibles à désactiver.
  - L'écran affiche « Dans l'application uniquement », et aucun « envoyé » n'est jamais annoncé.
- **Prérequis pour l'e-mail et le push** (non commencés)
  1. Connexion réelle et une table `notifications` en base, par destinataire, avec règles d'accès et une clé unique par événement.
  2. Une file d'envoi côté serveur, avec un statut par canal, qui ne passe à « envoyé » que sur accusé du fournisseur.
  3. E-mail : un fournisseur, européen de préférence. Le même que celui des e-mails de connexion.
  4. Push : Web Push (clés VAPID), accord explicite sur l'appareil, et sur iPhone l'app ajoutée à l'écran d'accueil.
  5. SMS : décision séparée (fournisseur, coût, consentement).

### Phase 5 — Liens voyageurs par séjour ⏳ (après le socle)
Ce n'est pas lancé, pour deux raisons :
- une expiration ou une révocation réelle exige le serveur ;
- les liens voyageurs ont été exclus du lot 1.

Afficher « expiré » ou « révoqué » sans serveur serait une simulation. Conception prévue :
- **Table `guest_links`** : `organization_id`, `reservation_id` (clé composite), `token_hash` (le jeton fait au moins 32 octets aléatoires, stocké haché), `valid_until`, `revoked_at`, `revoked_by`, `created_by`.
  - `valid_until` vaut par défaut l'heure de départ du séjour (`check_out_at`), qui est déjà en UTC.
  - Un manager peut la prolonger en cas de départ tardif.
- **Fonction publique `get_guest_stay(token)`**, seule porte d'entrée des voyageurs :
  - elle vérifie l'empreinte, l'expiration et la révocation ;
  - elle ne renvoie que le contenu public du séjour concerné ;
  - jeton absent, invalide, expiré ou révoqué : même réponse neutre, aucune donnée d'un autre séjour ;
  - aucun droit sur les tables internes, et un nombre de requêtes limité.
- Le lien reste utilisable plusieurs fois pendant le séjour.
- Il ne contient jamais de code de porte, et l'interface ne le présente jamais comme une serrure.
- Statut visible par le manager : actif, expiré ou révoqué.
- Tests d'isolation sur le même modèle que le lot 1.

### Phase 8 — Temps de trajet ⏳ (choix du fournisseur à valider)
Rien n'est intégré. Il faut une **clé et un service payant** : décision attendue.

Prix publics relevés le 27/10/2026, à confirmer sur les pages des fournisseurs avant tout engagement :

| Fournisseur | Trafic | Gratuit | Au-delà | Points d'attention |
|---|---|---|---|---|
| Google Routes API | Oui (prévision selon l'heure de départ) | 5 000 calculs par mois en niveau « Pro » (celui du trafic) | ≈ 10 $ les 1 000 | Couverture mondiale. Conditions d'utilisation strictes : mise en cache limitée, à vérifier pour l'affichage hors carte Google |
| Mapbox Directions (`driving-traffic`) | Oui | ≈ 100 000 requêtes par mois | Selon la grille Mapbox | Bon rapport qualité-prix ; trafic moins dense hors grandes villes |
| TomTom Routing | Oui (`departAt`) | ≈ 2 500 requêtes par jour | Selon la grille TomTom | Européen (Pays-Bas), trafic de bonne qualité en Europe |
| HERE Routing v8 | Oui | ≈ 30 000 par mois | Selon la grille HERE | Européen (Pays-Bas), bonne couverture mondiale |
| OSRM / OpenRouteService | Non | Hébergement propre ou quotas | — | Pas de trafic : insuffisant pour la demande |

**Ordre de grandeur** : 20 agents × 6 missions par jour ≈ 2 500 trajets par mois. Avec les recalculs quand le planning change, comptons environ 10 000 par mois. Cela reste dans ou proche des quotas gratuits.

**Recommandation** : TomTom ou HERE (européens, trafic, quotas adaptés), avec un essai comparatif sur 50 trajets réels à Paris et Lisbonne avant de choisir.

**Intégration prévue**
- Clé uniquement côté serveur.
- Calcul entre deux missions successives d'un agent, à l'heure de départ planifiée.
- Marge de sécurité affichée.
- Signal « trajet irréaliste » dans le planning, sans jamais modifier la durée de travail ni masquer un conflit de créneau.
- Aucune position en temps réel.

## 2. Critères de validation

| # | Critère | État |
|---|---|---|
| 1 | Un agent n'accède pas aux écrans ou actions manager, même par une URL directe | **Actions** : refusées par la base (testé). **Écrans** : à faire à l'étape 1.3 (pas de session en démo) |
| 2 | Un agent ne soumet que sa propre mission | ✅ base + règle de la démo |
| 3 | Une mission soumise arrive au manager ; la validation et la correction sont enregistrées | ✅ |
| 4 | Une prestation apparaît dans « À traiter », sans être confondue avec un incident | ✅ |
| 5–6 | Lien voyageur : expiration, révocation, cloisonnement | ⏳ Phase 5 (serveur requis) |
| 7 | Fiche équipe en consultation, téléphone cliquable, modification explicite | ✅ |
| 8 | Itinéraires pour chaque service, avec repli si l'adresse est incomplète | ✅ (vrais appareils à tester) |
| 9 | Le trajet ne masque jamais un conflit et reste indicatif | ⏳ Phase 8 |
| 10 | Cloisonnement par organisation de chaque ajout en base | ✅ 900 vérifications, 0 échec |
