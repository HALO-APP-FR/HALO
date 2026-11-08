# 16 — Environnement connecté : onboarding, espace voyageur, notifications

État au 28 octobre 2026, branche `feat/operations`. Aucune mise en production.

## Ce qui passe réellement par le backend

| Domaine | Connecté (base + règles d'accès) | Écran |
|---|---|---|
| Comptes | Connexion par e-mail (lien **et** code à 6 chiffres), session vérifiée côté serveur à chaque requête | `/[locale]/auth/sign-in` |
| Organisations | Création, organisation active, plusieurs organisations par compte | `/app` |
| Onboarding Manager | Étapes enregistrées une à une, passables, reprise à l'étape interrompue, propositions à confirmer | `/app/onboarding` |
| Logements | Création, livret voyageur, checklist issue de la configuration confirmée | `/app/properties` |
| Séjours | Création, missions générées par le moteur existant (`planTasks`) | `/app/stays` |
| Missions | Assignation (manager) ; agent : checklist, photos déposées dans le stockage privé, fin de mission refusée tant qu'une photo obligatoire manque ; manager : preuves, validation ou correction avec motif | `/app/missions`, `/app/missions/[id]` |
| Équipe | Lien d'invitation (7 jours), acceptation avec son propre compte | `/app/team`, `/invite/[token]` |
| Espace voyageur | Lien de séjour sans compte : livret, dates, demandes, réponses, messages | `/s/[token]` |
| Prestations | Reçue, précisions (question + réponse), acceptée, refusée (motif), modifiée, annulée, réalisée | `/app/services` |
| Logement prêt ? | Accueil manager : arrivées des 48 h avec état (bloquée, à surveiller, en préparation, prête), cause, qui agit et action ; même moteur que la démo, sur les données réelles ; « Créer le ménage » si aucun ménage avant l'arrivée | `/app` |
| Linge et maintenance | Étapes réellement suivies dans « logement prêt » : livraison de linge exigée si l'organisation a répondu « blanchisserie » à l'onboarding (sinon rien n'est exigé), intervention de maintenance planifiée depuis un incident et reliée à la prochaine arrivée, contrôle qualité s'il existe. Une étape en retard bloque l'arrivée ; non faite, elle l'empêche d'être « prête » | `/app`, `/app/incidents` |
| Incidents et blocages | Agent depuis sa mission (blocage, manque de matériel, dégât…), voyageur depuis son espace ; prise en charge et résolution par l'équipe ; note interne séparée du message au voyageur (e-mail s'il a une adresse) ; incidents ouverts pris en compte dans « logement prêt » | `/app/incidents`, mission, `/s/<lien>` |
| Notifications de l'équipe | Chaque demande, réponse, problème ou message d'un voyageur, et chaque blocage urgent d'un agent, prévient les responsables par e-mail (lien vers l'objet). Adresse fictive (comptes de test) : tracée « échec », jamais « envoyée ». Journal complet avec relance | `/app/notifications` |
| Notifications | Dans l'espace voyageur + e-mail si adresse connue **et** fournisseur configuré ; état réel, échec visible, relance | historique d'envoi |

Le reste de l'application (planning, linge, arrivées, alertes…) **reste la démo** (navigateur, badge « Démo »). Les deux ne se mélangent pas : la démo n'écrit jamais dans la base, l'environnement connecté n'utilise pas le stockage du navigateur.

## Base de données

Migrations (dans l'ordre) : socle lot 1, cycle de mission, liens voyageurs et invitations, puis
`20261030000001_onboarding_voyageur_notifications.sql` :

- colonnes d'onboarding sur `organizations` (activité, nombre de logements, ménage, linge, prestations, problèmes, canaux, checklist type, rotation du linge, état de l'onboarding) et `profiles.job_title` ;
- `reservations.guest_email`, `guest_locale` ;
- `service_requests` (statut modifiable **uniquement** par les fonctions), `service_events` (visibilité `guest` / `internal`), `stay_messages`, `notification_outbox` (pending / sent / failed / not_configured) ;
- fonctions voyageur (anonymes, chacune revérifie le lien) : `get_guest_stay`, `guest_request_service`, `guest_reply_service`, `guest_send_message` ;
- fonctions équipe : `decide_service`, `update_service`, `mark_service_seen`, `reply_stay_message`, `retry_notification`.

Tests base : `supabase/tests/isolation.sql` — **1 286 vérifications, 0 échec** (organisations, rôles, voyageur, notes internes, file d'envoi, révocation).

## Préproduction locale (sans Docker)

```
node scripts/local-stack/stack.mjs setup   # binaires GoTrue + PostgREST (une fois)
node scripts/local-stack/stack.mjs reset   # base vierge + migrations, écrit .env.local
node scripts/local-stack/stack.mjs start   # API sur :54321, e-mails de test dans .local-stack/mails
npm run build && npx next start -p 3000
HALO_E2E_CONNECTED=1 npx playwright test connected --project=ordinateur
```

Les adresses `bounce…@` sont refusées par la boîte de test pour vérifier l'état « échec d'envoi ».

## Vérifications de bout en bout (`tests/e2e/connected.spec.ts`)

1. création d'organisation par un manager ;
2. onboarding passé partiellement, interrompu, repris à la bonne étape, réponses conservées ; rien enregistré avant confirmation ;
3. logement (checklist confirmée appliquée) et séjour (missions générées) ; erreur serveur affichée, pas de succès simulé ;
4. lien voyageur limité au séjour ;
5. demande de prestation par le voyageur ;
6. précisions (question + réponse), acceptation, modification, refus avec motif ;
7. historique et notifications des deux côtés ; e-mails réellement reçus ; échec d'envoi visible et relançable ;
8. voyageur A contre séjour B / organisation B, lien inventé, lecture directe des tables, manager B sur les URL de A (404), agent limité à ses missions ;
9. révocation, remplacement par un nouveau lien, expiration ;
10. reconnexion et « autre appareil » (nouveau navigateur) : données présentes.

Résultat : **7 scénarios / 10 vérifications réussis**, et la suite démo existante toujours verte.

## Démo et environnement connecté : règle de séparation (décidée le 28/10/2026)

- **Déploiement connecté** (préproduction, puis production) : l'accueil mène à la connexion ; c'est le parcours principal. La démo n'est qu'une entrée secondaire « Démo » vers `/demo`.
- Les pages de démo (`/today`, `/planning`, `/a/…`, `/g/…`, etc.) ne s'ouvrent qu'après l'entrée explicite `/demo` (marqueur `halo_demo`, 8 h). Sans ce marqueur, le serveur (proxy) renvoie à la connexion puis, une fois connecté, vers la page RÉELLE équivalente (`/today` → `/app`, `/a/…` → `/app/missions`…). Elles ne lisent jamais la base.
- Page connectée sans session : connexion, puis retour à la page demandée (`?next=`).
- **Comptes de test sans e-mail** (préproduction uniquement : environnement ≠ production ET `HALO_TEST_ACCOUNTS=1` en Preview) : sur la page de connexion, un nom (« manager », « agent »…) donne un compte fictif `test-<nom>@halo.invalid`. Même nom = même compte sur tout appareil. Données réellement enregistrées. Permet de vérifier tout le parcours sans transmettre d'adresse réelle.
- Pages connectées (`/app/…`) : session vérifiée côté serveur à chaque requête + règles d'accès en base. Voyageur : `/s/<lien>`, sans compte, par conception.
- **Déploiement sans backend** (production actuelle) : la démo publique, présentée comme telle.
- `/status` : état vérifié du backend (API, migrations, lecture anonyme refusée, authentification, clé serveur, SMTP), sans aucune valeur secrète. Le libellé « données enregistrées en ligne » n'apparaît que si ces vérifications passent ; sinon l'accueil affiche « Environnement connecté indisponible ».
- `/api/selftest?token=…` (préversion seulement, 404 en production) : parcours réel sur le backend du déploiement avec des comptes fictifs `@halo.invalid` (aucun e-mail envoyé) — organisation, logement, séjour, lien voyageur, persistance après nouvelle connexion, cloisonnement organisation / agent / voyageur, note interne invisible, révocation — puis suppression de toutes les données de test.

## Préproduction en ligne — état au 28/10/2026

- URL : https://halo-git-feat-operations-halo-65a7.vercel.app (branche `feat/operations`).
- Supabase : projet `yokcliujljlqdhkcncte`, 4 migrations appliquées (SQL Editor) et enregistrées dans `supabase_migrations.schema_migrations` pour que l'intégration GitHub ne les rejoue pas.
- Vercel : toutes les variables Supabase (y compris celles créées par l'intégration Supabase ↔ Vercel) sont en portée **Preview uniquement**. **Production : aucune variable Supabase → reste en démo** tant qu'une bascule n'est pas décidée (avec un projet Supabase de production distinct).
- Intégration Supabase ↔ Vercel : décocher « Production » côté Supabase, sinon elle peut recréer les variables en production à la prochaine synchronisation.
- E-mails : Brevo (offre gratuite) — SMTP personnalisé dans Supabase (connexion) et `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` en Preview (voyageurs). Expéditeur Gmail provisoire : risque de spam, à remplacer par une adresse sur un domaine vérifié (SPF/DKIM).
- Modèles d'e-mail Supabase : modifiables seulement avec SMTP personnalisé (règle des nouveaux projets gratuits) ; modèle Magic Link et Confirm signup avec `{{ .Token }}`.

Sans service d'envoi, aucun e-mail voyageur n'est envoyé et chaque envoi est marqué « Non envoyé : aucun service d'envoi configuré ». Pas de SMS.

## Limites connues

- L'import de calendriers (Airbnb, Booking…) n'est pas encore relié à la base : la question d'onboarding sert à le préparer, elle le dit.
- Les « propositions » de configuration sont des **règles explicites** (aucun modèle d'IA appelé) ; chaque proposition affiche sa raison.
- Un e-mail resté « en attente » (coupure pendant l'envoi) n'est retraité qu'à la prochaine action de l'organisation ; une tâche planifiée sera ajoutée.

## Règles confirmées le 29/10 (retour de test)

- **Codes de serrure** : HALO n'en gère aucun. Les fonctions de consultation et de saisie des codes sont fermées en base ; la démo n'affiche plus de code et le formulaire ne permet plus d'en saisir.
- **Correction avec preuve** : le responsable choisit les points à refaire ; leur ancienne photo est conservée en historique mais ne compte plus, le point est décoché et une nouvelle photo est exigée avant de terminer.
- **Affectation hors fenêtre** : jamais silencieuse. Connecté : refusée par le serveur sans nouvelle fin de fenêtre confirmée (avec l'heure d'arrivée du voyageur). Démo : confirmation explicite avec la nouvelle fin et l'heure d'arrivée.
- **Scénario de test complet** (préproduction) : depuis la page de connexion, un bouton crée manager, agent, logement avec livret et checklist, séjour d'arrivée demain, ménage assigné et lien voyageur, à travers les vraies fonctions de la base.
- **Auto-test** `/api/selftest?token=…&email=1` : en plus des droits, vérifie que chaque événement crée un envoi et que les e-mails voyageur partent réellement (adresse « +selftest » de l'expéditeur).

## Phase 1 du retour du 30/10 (migration 9 : `20261104000001_validation_creneaux_absences.sql`)

**Validation par type de mission.** Réglages → Validation des missions : chaque type (ménage, maintenance/intervention, livraison et collecte de linge, contrôle, accueil, départ, autre) est explicitement « Validation » ou « Clôture directe ». `finish_task` lit ce réglage en base : un type soumis à validation passe « À valider », jamais « Validée ». « Toutes les missions » choisi à l'onboarding couvre désormais tous les types ; les organisations concernées sont corrigées par la migration. Une intervention ne résout jamais l'incident : la fiche mission montre l'incident d'origine et son état, la page incidents montre l'état de l'intervention.

**Créneaux de ménage (règle).** Début = départ du voyageur (ou départ anticipé signalé). Fin = arrivée suivante dans le logement, le même jour ou plus tard. Sans arrivée suivante : départ + 3 jours. La durée estimée (durée du logement, + 30 min si animaux) est affichée à part de la fenêtre, et la date de fin est toujours affichée quand elle diffère du début. Écart plus court que la durée, séjours qui se chevauchent, durée ou départ invalides : aucune mission n'est créée, un conflit est signalé (accueil, missions, fiche séjour). La base refuse toute fenêtre plus courte que la durée et tout séjour confirmé qui en chevauche un autre dans le même logement. Le responsable corrige un créneau (`set_task_window`) : motif facultatif, trace « Créneau modifié » dans l'historique, et la synchronisation ne déplace plus ni ne recrée cette mission.

**Profil de l'agent.** L'acceptation d'une invitation demande le nom (obligatoire) et le téléphone (facultatif), contrôlés par `accept_invitation(token, nom, téléphone)`. Page « Mon profil » pour chacun, bandeau tant que le nom manque, champs à compléter visibles dans l'équipe. Aucun droit en plus.

**Absences et fermetures.** Tables `absences` et `absence_events`, écritures uniquement par fonctions :
- `save_absence` (idempotente) : un responsable crée une absence, acceptée d'office ; un agent la demande pour lui-même (en attente, les responsables sont prévenus par e-mail).
- `decide_absence` et `cancel_absence` : décision et annulation.
- Catégories neutres (congé, indisponible, fermeture d'équipe) et motif court facultatif, sans détail médical.
- Seules les absences acceptées bloquent. Le contrôle se fait en base, sur toute nouvelle affectation (`check_assignee_available`) : la mission doit tenir dans le plus long temps libre de sa fenêtre, donc une absence partielle ne bloque que ce qu'elle recouvre.
- Une absence ou une fermeture enregistrée après coup ne modifie aucune mission. Les missions à réorganiser et les séjours pendant une fermeture sont listés sur la page Équipe et comptés à l'accueil.
- Un agent ne voit que ses absences et les fermetures. Historique horodaté de chaque création, décision et annulation.
- Limite : pas de récurrence pour l'instant.

**Retour arrière** (sans perte de données métier) : supprimer les déclencheurs `tasks_window_check`, `tasks_assignee_available` et `reservations_overlap_check`, puis les fonctions et les tables ajoutées.

## Périmètre opérationnel du 29/10 au soir (migration 10 : `20261105000001_messagerie_lieux_preferences.sql`)

**Absences et affectation (règle durcie).** Une affectation est refusée, à l'écran comme dans la base, dès qu'une absence acceptée ou une fermeture d'équipe chevauche le créneau réel de la mission.
- Créneau réel : l'horaire planifié + durée s'il est fixé, sinon toute la fenêtre.
- Le même contrôle s'applique quand on déplace l'horaire ou qu'on corrige le créneau d'une mission déjà affectée.
- Les personnes absentes ne sont pas proposées dans le choix d'affectation ; un compteur indique combien ont été écartées.
- Avant cette migration, une mission avec une fenêtre de 3 jours restait attribuable si elle « tenait » en dehors d'un congé d'un jour. Ce n'est plus le cas.

**Missions à valider.**
- Compteur « Missions à valider » sur l'accueil, avec un lien direct vers `/app/missions?status=done`.
- E-mail aux responsables à la fin de chaque mission (`team_task_to_validate`). Le compteur disparaît après validation ou demande de correction.
- L'agent est prévenu quand une mission lui est attribuée (`agent_task_assigned`) ou qu'une correction est demandée (`agent_correction_requested`).

**Messages voyageur.**
- Les messages affichés sont marqués lus à l'ouverture de la conversation (`mark_stay_messages_read`), message par message, après confirmation du serveur.
- Les messages non lus à l'ouverture portent l'étiquette « Nouveau ».
- La liste des séjours indique le nombre de nouveaux messages, avec la même règle que le compteur de l'accueil.

**Messagerie interne Manager–Agent** (`team_threads`, `team_thread_members`, `team_messages`).
- Chaque conversation est obligatoirement liée à une mission, un logement ou un séjour.
- Le responsable écrit à une ou plusieurs personnes ; l'agent répond depuis la page Messages ou depuis la mission.
- Chaque message affiche l'auteur, l'heure et l'état « lu », « lu par n sur N » ou « non lu ».
- Un message urgent est toujours notifié.
- Sans réseau, le message reste « en attente » et repart au retour du réseau, sans doublon grâce à l'identifiant client.
- Accès réservé aux participants et aux responsables de l'organisation ; aucun accès anonyme ni voyageur. Écritures uniquement par fonctions.
- Pas de pièces jointes dans cette version.

**Itinéraires.** Bouton « Itinéraire » sur chaque mission (toutes se déroulent au logement) vers Apple Plans, Google Maps et Waze.
- Destination : les coordonnées du logement si elles existent, sinon son adresse.
- Le choix par défaut se règle dans Mon profil (`profiles.maps_app`) et reste conservé après reconnexion.
- L'adresse n'est transmise qu'au geste de l'agent.

**Préférences de notification** (`notification_prefs`). Chacun choisit les e-mails qu'il reçoit, par événement, dans Mon profil. La base applique ces choix (`queue_team_email` et `queue_member_email`).
- Canaux : « Dans HALO » est toujours actif. L'e-mail est indiqué disponible ou indisponible selon la configuration SMTP réelle. SMS et notifications push sont indiqués indisponibles (aucun fournisseur).
- Urgences toujours envoyées, quelle que soit la préférence : blocage d'agent ; problème voyageur urgent ou de catégorie accès, fuite, dégât ou blocage ; message urgent.

**Autour du logement (espace voyageur).**
- Le logement a des coordonnées : géocodage OpenStreetMap Nominatim de son adresse, ou saisie manuelle.
- Le responsable importe les lieux nommés dans un rayon de 1,2 km (OpenStreetMap Overpass), avec la date des données. Il peut aussi ajouter des lieux vérifiés par l'équipe, ou masquer un lieu.
- Le voyageur voit une carte OpenStreetMap (Leaflet), des filtres par catégorie, la distance, l'adresse, les horaires « publiés, à confirmer », la source et la date, et les liens Plans, Google Maps et Waze.
- Sa position n'est demandée que s'il clique « Distances depuis ma position » et reste sur son téléphone. Un refus ne bloque rien.
- `guest_places(token)` ne renvoie que les lieux du logement de ce séjour, à 3 km maximum.
- Recommandations distinctes des prestations réservables.
- Variables facultatives : `NOMINATIM_URL` et `OVERPASS_URL`, pour un fournisseur dédié en production. Les tuiles cartographiques viennent de `tile.openstreetmap.org` ; un fournisseur de tuiles sera à prévoir pour un fort trafic.

## Brief du 30/10 (migration 11 : `20261106000001_preferences_recommandations_absences.sql`)

**Recommandations voyageur.**
- Le manager ajoute, modifie, masque et supprime des recommandations pour un logement. Chacune a une origine (« équipe » ou « propriétaire »), une catégorie, une description courte et un conseil pratique.
- Les recommandations automatiques (OpenStreetMap) sont désactivables par logement (`properties.auto_places`).
- Le voyageur voit tout autour de l'adresse du logement, sans que sa position soit demandée. La distance est arrondie, à vol d'oiseau. Les horaires n'apparaissent que si la source les fournit, sinon la mention « non communiqués » s'affiche.
- Sans coordonnées : ni distance ni carte. Si le fond de carte est indisponible, un message l'indique et la liste reste complète.
- Fournisseur OpenStreetMap : gratuit, sans clé. Nominatim limite à 1 requête par seconde et Overpass demande un usage raisonnable (de l'ordre de 10 000 requêtes par jour, avec des erreurs 429 ou 504 aux heures chargées). Si l'instance principale échoue, HALO essaie deux miroirs publics. La couverture varie selon les zones et les horaires manquent souvent.
- Seules les coordonnées du logement sont transmises au fournisseur, jamais de données sur le voyageur.
- En cas de panne du fournisseur, les recommandations manuelles restent pleinement utilisables.
- Le voyageur ne lit que les recommandations de son logement.

**Notifications.**
- Page « Préférences » personnelle : chacun règle les siennes, et un bouton rétablit les réglages par défaut (tout par e-mail).
- Chaque événement indique où il reste visible dans HALO ; le canal interne est toujours actif.
- Nouveaux événements : conflit d'affectation, séjour modifié ou annulé, mission modifiée ou annulée (agent), réponse à une demande d'absence (agent).
- Un e-mail écarté par une préférence est journalisé « Non envoyé (préférence) » avec sa raison (`skipped`, `disabled_by_preference`).
- Urgences toujours envoyées.
- Les rappels programmés avant une arrivée ou un départ ne sont pas encore émis ; seuls les changements le sont.

**Itinéraire.** Préférence dans « Préférences ». Sans rue ni coordonnées, l'action est désactivée et expliquée.

**Absences.**
- Affectations et acceptations d'absence sont sérialisées par organisation (verrou transactionnel `lock_assignments`). Deux opérations simultanées ne produisent jamais une affectation interdite (`supabase/tests/concurrency.sh`).
- Les absences « journées entières » suivent le fuseau horaire de l'organisation.
- Dès qu'une absence est acceptée sur une mission déjà affectée, les responsables sont prévenus. La mission affiche le conflit et trois actions : changer de personne, modifier le créneau ou annuler.
- Le sélecteur montre les personnes indisponibles, désactivées, avec le motif.

**Messagerie.**
- Une conversation de mission suit l'affectation : le nouvel agent la rejoint, l'ancien perd l'accès. Un membre désactivé perd tout accès immédiatement.
- Pour chaque message, on voit qui l'a lu et qui ne l'a pas encore lu.

**Retour arrière** : supprimer les déclencheurs `absences_change` et `reservations_notify`, puis les fonctions `outbox_skip`, `reset_notification_prefs`, `lock_assignments`, `absence_conflicts`, `on_absence_change` et `notify_stay_change`, et enfin les colonnes `auto_places` et `description`. Restaurer ensuite les versions de la migration 10 des fonctions remplacées.

**Fournisseur de lieux, constat en ligne (30/10).** Depuis Vercel, le géocodage Nominatim fonctionne. En revanche, l'instance Overpass principale répond 406 et les deux miroirs dépassent le délai d'attente : le service public refuse ou ne sert pas ces requêtes. L'import automatique échoue donc proprement, avec un message, et les recommandations manuelles restent pleinement utilisables. Pour un import fiable, renseigner `GEOAPIFY_API_KEY` dans Vercel (Preview). Geoapify sert des données OpenStreetMap ; la clé est gratuite jusqu'à 3 000 requêtes par jour, sans carte bancaire. HALO l'utilise alors en premier, puis Overpass en secours.

## Préparation avant l'arrivée, VIP et fiabilisation (migration 12 : `20261107000001_preparation_vip_fiabilisation.sql`)

**Règles décidées**
- **Accès voyageur en deux temps** : dès sa création, le lien donne accès à la *préparation* (questionnaire, demandes, messages, recommandations publiées, demande VIP). Adresse, coordonnées, Wi-Fi, guide et signalement de problème : seulement dans la fenêtre habituelle (72 h avant l'arrivée → départ). Séjour annulé : lien révoqué et préparation « Annulé ». Dates modifiées : le lien suit. Expiration : au départ (prolongation 7 j max). Révocation : immédiate.
- **Invitation par e-mail** : crée un nouveau lien (l'ancien cesse) ; l'état affiché vient du journal réel (envoyé / en attente / échec / aucun service). Le lien brut n'est pas conservé : retiré du journal dès la fin de l'envoi, jamais stocké pour une adresse `.invalid`. Pour réessayer : nouvelle invitation.
- **Questionnaire** : toutes les questions sont facultatives, configurables par organisation (Réglages) ; valeurs filtrées côté serveur (aucune donnée de santé/paiement demandée) ; brouillon, envoi, modification, effacement ; verrouillé après l'arrivée ; rejouer un envoi identique ne renvoie pas d'alerte.
- **Préparation du séjour** (responsables uniquement, jamais les agents) : statuts À préparer / En préparation / En attente du voyageur / Prêt / Annulé ; « Prêt » refusé par le serveur tant qu'une action indispensable est ouverte ; l'arrivée n'apparaît pas « prête » non plus. Actions avec responsable, échéance, indispensable ; prestation ou mission créée depuis une action ; éléments pour le voyageur visibles seulement publiés ; historique automatique.
- **Statuts voyageur** : Demande reçue, À préciser, En cours d'étude, Confirmée, Refusée, Annulée. Une demande n'est jamais présentée comme réservée.
- **VIP** : trois notions séparées — demande du voyageur, statut VIP vérifié (table `stay_vip`), formule premium (prestation `premium_package` avec son propre statut). Validation humaine toujours obligatoire (contrainte en base) ; critère ou motif obligatoire ; échéance ; retrait ; note interne jamais visible du voyageur ; un critère « réservé au propriétaire » n'est modifiable que par lui. L'indice de fidélité (séjours passés même e-mail) n'est qu'une indication.
- **Lieux** : « vérifié » = date + personne ; toute modification de nom, adresse, catégorie, horaires, téléphone, site ou coordonnées retire la vérification ; à renouveler à chaque changement (pas de durée automatique). Import OpenStreetMap lancé depuis le navigateur du responsable (Overpass refuse les serveurs Vercel, erreur 406), données revalidées par le serveur (rayon, format, 200 max), sans doublon, lieux masqués conservés. Fournisseur serveur optionnel : `GEOAPIFY_API_KEY` (clé gratuite, non configurée).
- **Heures** : séjours, missions, prestations et espace voyageur dans le fuseau du logement ; l'écart 07:13 / 08:13 venait du journal qui utilisait le fuseau du navigateur.
- **E-mails** : voyageurs et équipe comptés séparément ; « non envoyé (préférence) » jamais compté en échec.
- **IA** : non configurée — fonctions manuelles uniquement.

**Tests** : isolation 1665/0, unitaires 146, e2e 39/39 (dont 20 · préparation et VIP, 21 · recommandations, 22 · navigation 1 280 px et page introuvable), concurrence d'affectation refusée.

## Corrections, import de données et calendriers (migration 13 : `20261108000001_corrections_import_sources.sql`)

**Corrections**
- Préparation : une action indispensable créée ou rouverte retire « Prêt » (historisé « Prêt retiré »). Une action liée à une mission ne se clôt que si la mission est terminée (validée, ou faite pour un type sans validation) ; sinon dérogation avec motif, historisée. Mission validée → action close ; mission « à refaire » → action rouverte.
- Mission issue d'une action : titre + consignes (champ « Consignes pour l'agent ») visibles dans la liste et le détail de l'agent.
- VIP : le message au voyageur s'affiche dans son espace (« Message de l'équipe ») ; état réel de l'e-mail côté responsable.
- Lieux : cause de l'échec Champ-de-Mars = overpass-api.de refuse aussi les requêtes du navigateur (échec immédiat, vérifié depuis un navigateur réel) et les miroirs ne répondent pas. Repli : Photon (komoot, OpenStreetMap, gratuit, sans clé) depuis le navigateur puis le serveur. Photon ne donne ni horaires ni téléphone (laissés vides, « non communiqués »).
- Avant l'arrivée : carte et adresse « affichées à partir du … » ; contact = numéro « urgence » du livret s'il existe, sinon message adapté.

**Import (fichier CSV / XLSX)**
- Types : logements, séjours, équipe (contacts, jamais de comptes ni d'invitations). Champs : voir `src/lib/engine/import.ts` (FIELDS). Non pris en charge : codes d'accès, mots de passe, pièces d'identité, données bancaires (colonnes écartées dans le navigateur avant envoi), tarifs/montants, checklists, linge, avis, paiements.
- Étapes : brouillon reprenable → fichiers + correspondance des colonnes → analyse (aucune écriture métier) → aperçu, doublons (ignorer / associer / créer), lignes à corriger (CSV) → validation explicite (« Importer N logements, M séjours… ») → rapport → annulation sûre (seulement ce qui est intact ; le reste est listé avec la raison).
- Exécution : `run_import` (une organisation, point de reprise par ligne, une ligne traitée ne l'est jamais deux fois). Aucun e-mail, invitation, message. Missions : seulement si l'option est cochée ; sinon créées à la prochaine mise à jour du planning du logement (règle existante).
- Stockage : le fichier n'est jamais conservé ; lignes lues effacées 30 jours après l'import (`purge_import_rows`, lancée à chaque nouvel import) ; rapport chiffré conservé. Aucun service externe.

**Calendriers iCal (par logement)** — même téléchargeur que la démo (`fetchFeed`) et même lecteur (`parseIcs`).
- Dates seulement (et parfois un nom), synchronisation à la demande (pas d'automatique), sens calendrier → HALO.
- Règle : HALO prioritaire. Séjour modifié dans HALO → conflit, jamais écrasé ; séjour absent du calendrier → conflit, jamais annulé seul ; chevauchement → conflit. Arbitrage : garder HALO, appliquer le calendrier, annuler le séjour.
- Adresse stockée à part (`data_source_secrets`, aucun accès direct), seul un indice est affiché.

**Connexions — état réel**
| Source | Données | Mode | Sens | État |
|---|---|---|---|---|
| Fichier CSV/XLSX (tout logiciel, exports Airbnb, Booking, PMS) | logements, séjours, contacts | ponctuel | entrant | opérationnel |
| iCal (Airbnb, Booking, Vrbo, PMS) | dates, blocages, parfois nom | à la demande | entrant | opérationnel (dates seulement) |
| API Lodgify, Smoobu, Hostaway, Guesty, Beds24, SuperHote | réservations complètes selon l'API | — | — | non implémenté, non vérifié |
| Airbnb / Booking API | réservées aux partenaires agréés | — | — | non disponible |

## Réservation directe, satisfaction et vitrine (migration 14 : `20261109000001_reservation_directe_satisfaction.sql`)

**Préparation et missions liées**
- Mission liée validée → action close ; mission « à refaire » → action rouverte, « Prêt » retiré si indispensable, historisé « Mission liée à refaire » ; mission annulée → historisé, action laissée ouverte (jamais close en silence).
- Fiche séjour : bandeau « Ce séjour n'est plus « Prêt » depuis le … : l'action indispensable « … » a été rouverte » tant qu'un responsable n'a pas repassé le statut.

**Réservation directe (ancien voyageur)**
- Lien dédié `/b/<jeton>` (jamais le lien de séjour), créé depuis la fiche d'un séjour confirmé : 60 jours, révocable, renouvelable (un nouveau lien remplace l'ancien), jeton haché.
- Le voyageur saisit dates, voyageurs, coordonnées, précisions ; mention « pas une réservation confirmée » ; périodes occupées connues affichées sans aucun nom ; calendriers externes non à jour signalés (« disponibilités indicatives »). 3 demandes ouvertes maximum ; double envoi = une seule demande (identifiant d'envoi).
- Responsable : « Demandes de séjour » (menu Plus + alerte d'accueil). Statuts : reçue, en étude, précision demandée, offre envoyée, acceptée (à confirmer), confirmée, refusée, annulée. Note interne jamais visible du voyageur. Offre : dates (autres dates possibles), prix, frais, total = prix + frais (contrôlé par la base), conditions, validité.
- Confirmation (`booking_confirm`) : uniquement après acceptation du voyageur ; verrou par logement ; dates revérifiées côté serveur ; calendrier externe non synchronisé depuis 24 h ou en erreur → confirmation seulement après « J'ai vérifié » (tracé en interne) ; un seul séjour (rejouer = sans effet), rattaché à l'ancien (`previous_reservation_id`), puis missions, nouvel accès voyageur et invitation à préparer, avec état réel de l'e-mail.
- Paiement : `payment_status = outside_halo`, jamais affiché comme reçu.

**Satisfaction**
- Avis voyageur : lien `/avis/<jeton>` après le départ (30 jours), un avis par séjour, note globale obligatoire, propreté / état et conformité / arrivée et départ / communication facultatifs, commentaire, « reviendriez-vous ? ». Modifiable 14 jours par l'auteur ; l'équipe ne peut jamais le modifier.
- Avis propriétaire : propriétaire enregistré **et** relié à un logement géré ; lien personnel 30 jours. Pas d'espace propriétaire authentifié (limite affichée).
- Écran « Satisfaction » : voyageurs et propriétaires séparés, période (3/6/12/24 mois), nombre d'avis, aucune moyenne sans avis, questions sans réponse comptées, avis vérifiés et importés séparés. Note ≤ 2 → « À traiter » + e-mail équipe ; suivi interne, incident éventuel sur le logement, sans désigner d'agent.
- Vitrine `/v/<adresse>` : publication explicite, retrait à tout moment ; scores sur tous les avis vérifiés de la période (aucune exclusion), avec leur nombre ; témoignages seulement avec consentement de l'auteur (retrait du consentement = retrait immédiat), mention « sélection » ; ni nom complet, ni adresse, ni logement ; aperçu dans l'application.

**E-mails ajoutés** : `booking_link`, `booking_update`, `review_request` (lien retiré du journal après l'envoi), `team_booking_requested`, `team_low_review` (préférences de notification).

**Tests** : isolation 1868/0 ; e2e 26 (réservation directe complète, dates prises, calendrier non à jour, confirmation unique, révocation), 27 (avis voyageur et propriétaire, note faible, avis importé, vitrine et retrait), 24b (import Excel + reprise après interruption), 23 (raison du retrait de « Prêt »).

## Scénario opérationnel et note du service (migration 15 : `20261110000001_scenario_operationnel_satisfaction_service.sql`)

**Scénario de référence (e2e 28, données fictives)** — ce que HALO permet, testé de bout en bout :
- Absence acceptée d'un agent affecté → l'arrivée passe « Bloqué » avec la cause « Ménage affecté à une personne absente » (plus de fausse couverture).
- Accueil : jusqu'à 5 causes réelles par arrivée (absence, ménage non attribué / irréalisable, incident avec catégorie et texte, demande en attente avec son type, action indispensable, étapes linge/maintenance), et l'action principale.
- Fiche mission : « À faire avant », « Possible à partir du », « Durée prévue (estimation) », « Créneau planifié » (ou « Aucun créneau attribué »), affectation. Liste : « À faire avant le … · durée prévue … · aucun créneau planifié ».
- Réaffectation : personnes sans absence connue sur le créneau, avec leurs autres missions sur la même plage ; temps de trajet et disponibilités non déclarées signalés comme inconnus. Après réaffectation, l'ancien agent ne voit plus la mission.
- Agent : signalements « Linge manquant ou abîmé » et « Retard » depuis la mission, rattachés au logement, à la mission, à l'arrivée suivante et à l'auteur ; suivi par le responsable (pris en charge → résolu).
- Voyageur : « Arrivée anticipée ou départ tardif » (jamais accepté automatiquement), réponse et statut dans son espace ; e-mail seulement si une adresse existe et que l'envoi réussit.
- Préparation : « Ce qui empêche « Prêt » » liste les actions indispensables ouvertes (lien direct, état de la mission liée).

**Règles « Prêt » (serveur)** : `set_prep_status` verrouille la préparation puis vérifie les actions ; la réouverture ou la création d'une action indispensable met à jour la même ligne (verrou) et retire « Prêt » : deux actions simultanées ne peuvent pas laisser un « Prêt » contradictoire. Clôture d'une action liée à une mission non terminée : seulement avec motif (auteur, date, motif historisés). Seules les actions marquées « indispensables » bloquent ; missions et incidents ne bloquent pas « Prêt » (ils apparaissent dans l'arrivée à risque).

**Satisfaction**
- Voyageur : note globale du séjour + note du service de l'équipe (facultative) + critères facultatifs + commentaire + accord de publication séparé. Anciens avis : note du service vide (jamais déduite).
- « À traiter » si note globale, service, propreté ou état (propriétaire : réactivité, qualité) ≤ 2/5 ; une alerte équipe par avis ; jamais d'attribution à un agent.
- Accueil : avis voyageurs et propriétaires à traiter comptés séparément, chacun vers sa liste filtrée ; la liste signale les avis à traiter de l'autre catégorie. Le suivi conserve l'état actuel par défaut.
- Vitrine : séjours, service de l'équipe et gestion (propriétaires) séparés, avec le nombre d'avis.

**Recommandations voyageur** : sélection de l'équipe et du propriétaire d'abord ; suggestions automatiques (OpenStreetMap, non vérifiées) ensuite, les 12 plus proches puis « Voir les N suggestions ».

**Hors périmètre / limites** : photo jointe à un incident (non disponible) ; stock de linge par logement (non suivi : « disponibilité non renseignée ») ; temps de trajet ; hors ligne non garanti ; SMS et push non disponibles ; e-mail du voyageur pour les demandes de séjour en français uniquement.

**Tests** : isolation 1883/0, unitaires 159, e2e 47/47 (dont 28 scénario de référence et 29 alertes d'avis).

## Arrivée anticipée, absences, confidentialité des lieux, concurrence (migration 16 : `20261111000001_arrivee_anticipee_absences_confidentialite.sql`)

**Arrivée anticipée / départ tardif — garanti côté serveur**
- La décision générique ne peut plus confirmer, annuler une confirmation ni changer l'heure d'une telle demande (`service_timing_guard`) : seule `timing_decide` le fait.
- `timing_check` (lecture) : heure demandée, heure actuelle du séjour, ménage concerné (statut, affectation, début possible, durée, créneau), actions indispensables ouvertes à échéance plus tardive ; risques (`cleaning_unassigned`, `cleaning_not_planned`, `cleaning_scheduled_after/before`, `prep_actions_open`, `no_cleaning`) ; blocages (`cleaning_cannot_fit`, `stay_overlap`) ; non vérifié : linge, accès/clés, règles du propriétaire.
- `timing_decide` : verrous sur la demande et le séjour ; refus si le séjour a changé depuis l'affichage (`stay_changed`) ; refus ferme si le ménage ne tient pas ; avec un risque, accord explicite obligatoire, noté en interne. À la confirmation : heure du séjour, fin de fenêtre du ménage et échéances d'actions fixées à l'ancienne heure mises à jour ensemble ; créneau planifié jamais déplacé (il apparaît irréalisable) ; agent affecté prévenu ; historique « Horaire du séjour modifié ». Annulation : horaire et échéances rétablis si le séjour n'a pas changé. Double confirmation : sans effet.

**Absences — conflit confirmé ou risque à examiner** (`task_absence_level`, même règle dans `src/lib/engine/availability.ts`)
- Horaire planifié chevauché → conflit (affectation refusée).
- Sans horaire : conflit seulement si le plus long temps libre de la fenêtre hors absences acceptées est plus court que la durée prévue ; sinon risque (affectation possible, signalé « à examiner »). Calcul sur 24 h : horaires de travail et trajets non connus. Mission commencée pendant une absence : « à vérifier ».
- Change la règle du 29/10 (toute absence chevauchant une fenêtre sans horaire bloquait l'affectation).

**Lieux avant l'ouverture des informations pratiques** : ni coordonnées du logement, ni distance exacte (tranches « moins de 1 km », « 1 à 2 km », « 2 à 3 km »), lieux à moins de 300 m retenus (seul leur nombre est indiqué), ordre alphabétique. Limite : la liste des lieux (publics) situe le quartier ; c'est voulu.

**Concurrence** : `check_stay_overlap` sous verrou par logement — défaut reproduit avant correction (deux séjours chevauchants créés simultanément), corrigé et testé (`supabase/tests/concurrency.sh`, avec `OLD_OVERLAP=1` pour rejouer le défaut). Demande de séjour envoyée deux fois simultanément : une seule demande, sans erreur.

**Tests** : isolation 1932/0 (dont matrice lecture/création/modification/suppression par rôle et organisation), concurrence 6/6 (+ reproduction), unitaires 159, e2e (30 arrivée anticipée, 31 absences, 32 confidentialité des lieux).

## Horaires cohérents et lieux protégés (migration 17 : `20261112000001_horaires_coherents_lieux_proteges.sql`)

**Cause de l'échec du 2/11 (« Le serveur n'a pas pu enregistrer »)** — vérifiée sur la vraie base de préproduction par l'auto-test (`timing_decide_with_prep_mission` → `22023:invalid_window`) : la confirmation avançait la fin de fenêtre de TOUTES les missions liées à l'arrivée, y compris une mission de préparation (créée depuis une action) qui commençait après l'heure demandée ; le contrôle des fenêtres refusait alors la mise à jour et toute la décision était annulée. Les tests locaux ne couvraient que le ménage.

**Correction** : `timing_effects` calcule l'effet prévu par mission (échéance avancée, début reculé, accueil/départ décalé, ou mission laissée telle quelle si elle ne tient pas ou si son créneau est planifié ; ménage qui ne tient pas = blocage). La vérification et la décision utilisent le même calcul ; l'effet est affiché pour chaque mission avant de décider. Garde-fou étendu à la création (une demande d'horaire ne naît jamais confirmée). Double clic : un seul envoi côté écran, une seule décision côté base.

**Horaires contradictoires** : `timing_inconsistencies` liste les demandes confirmées dont l'heure ne correspond pas au séjour (confirmées avant la décision dédiée, ou séjour modifié depuis). Rien n'est corrigé automatiquement : alerte d'accueil, bandeau sur la demande, message « horaire en cours de vérification » côté voyageur ; le responsable choisit « Appliquer l'horaire confirmé au séjour » (mêmes vérifications, décision tracée) ou « Retirer la confirmation » (voyageur prévenu).

**Messages** : une action réussie efface les messages d'échec devenus obsolètes ailleurs sur la page.

**Absences** : « mission en cours ; absence prévue à partir du … » si l'absence n'a pas commencé ; « temps libre calculé » = plus long temps libre continu d'après les absences enregistrées, sur 24 h, pas une disponibilité garantie.

**Lieux avant l'ouverture — niveau de protection retenu** : ni coordonnées du logement ni coordonnées des lieux ; aucune suggestion automatique (leur répartition centrée sur le logement et le « vide » laissé par les lieux proches masqués permettaient de le situer) ; seulement la sélection de l'équipe et du propriétaire, à plus de 300 m, distances par tranches de 1 km, ordre alphabétique. Vérifié sur la page réellement transmise au navigateur pour trois localisations (Paris, Toulouse, Chamonix). Limite : les adresses publiques des lieux choisis situent le quartier (de l'ordre du kilomètre) ; c'est le niveau voulu.

**Tests** : isolation 1953/0, concurrence 6/6, unitaires 160, e2e 52/52 (33 retest du 2/11, 34 données transmises).

## Horaires successifs, historique fidèle, e-mails à jour (migration 18 : `20261113000001_horaires_successifs_historique.sql`)

**Problème reproduit (test du 3/11)** : 14 h confirmée, puis 13 h/12 h confirmée → la confirmation 14 h restait « Confirmée » et le voyageur lisait « horaire en cours de vérification ». Cause : la règle « confirmée ≠ heure du séjour ⇒ contradiction » ne distinguait pas une confirmation remplacée par une décision plus récente. Le libellé « Demandée » côté voyageur venait d'un message de l'équipe (événement sans statut) affiché avec le libellé par défaut.

**Règle métier unique (`public.timing_state`)**, appliquée par la base et utilisée par toutes les vues :
- `applied` : confirmée et heure du séjour = heure confirmée → **l'heure applicable** ;
- `superseded` : confirmée puis remplacée par une confirmation ultérieure encore valable (lien `superseded_by`, posé uniquement par la décision) ;
- `covered` : séjour modifié autrement mais promesse tenue (arrivée encore plus tôt / départ encore plus tard) — pas d'alerte ;
- `contradiction` : promesse non tenue et rien ne l'a remplacée → alerte d'accueil, décision du responsable ;
- `pending`, `declined`, `cancelled`, `done`.

**Décisions** : confirmer applique l'heure et marque « remplacées » les autres confirmations du même séjour (événement visible du voyageur, historique conservé). Annuler l'horaire applicable rétablit l'heure précédente seulement si le séjour n'a pas changé depuis ; les confirmations qu'il avait remplacées redeviennent examinées selon l'heure réelle (« rétablie »). Retirer une confirmation déjà remplacée ne touche pas le séjour et corrige la chaîne (l'annulation suivante revient à l'heure d'avant). Appliquer une confirmation remplacée est refusé. Champs `superseded_by`, `timing_applied_at`, `timing_previous_at` non modifiables hors décision.

**Données existantes (migration)** : pour chaque séjour, si UNE confirmation est l'horaire applicable (appliquée par la décision dédiée) et a été décidée après une autre confirmation du même type, cette dernière est marquée « remplacée » (événement voyageur + note interne « Migration 18 »). Cas ambigus laissés tels quels et évalués par la règle : aucune ou plusieurs confirmations applicables, ou ordre des décisions inverse. Aucune suppression, aucun séjour modifié.

**Effets avant décision** : actions indispensables selon la donnée réelle — échéance à l'heure actuelle (avancée), plus tardive (laissée, risque), sans échéance (« aucune échéance renseignée », risque distinct), avant l'heure demandée (laissée) ; actions déjà terminées comptées ; incidents et problèmes de linge ouverts signalés ; mission commencée signalée ; inconnues listées (stock de linge, accès, règles du propriétaire, trajets). Confirmer ne marque rien comme fait : le logement n'est jamais rendu « prêt » par la décision.

**Historique voyageur** : libellés par type d'événement (demande reçue, décision, message de l'équipe, information d'horaire avec l'heure, message du voyageur) ; notes internes jamais transmises (vérifié sur les données renvoyées).

**E-mails** : modèles `timing_confirmed`, `timing_cancelled`, `timing_updated` avec l'heure applicable dans le fuseau du logement ; un e-mail d'horaire encore en attente devenu obsolète (décision plus récente sur le séjour) passe en « non envoyé » (`superseded_by_newer_decision`) ; envoi par réservation atomique (`outbox_claim`, `for update skip locked`) : deux traitements simultanés n'envoient jamais le même e-mail ; un e-mail réservé non terminé redevient disponible après 10 min. Les tests utilisent des adresses `.invalid` / `.test` : aucun envoi réel.

**Absences** : mission en cours — démarrée pendant une absence / avant une absence commencée depuis / avant une absence à venir / heure de démarrage inconnue. Temps libre : calculé de maintenant à la fin de fenêtre quand la fenêtre a commencé (sinon fenêtre entière), période affichée ; d'après les seules absences enregistrées (horaires de travail, autres missions, trajets non pris en compte).

**Lieux et recommandations avant l'ouverture** : adresse d'un lieu montrée seulement si sa distance au logement est connue et ≥ 300 m (lieu sans coordonnées ou logement sans position : nom et catégorie seulement) ; recommandations publiées : ni coordonnées ni adresse proche. Lien : un séjour raccourci dont la fin est passée ferme aussi le lien.

**Retour arrière** : restaurer les fonctions de la migration 17 (`timing_apply`, `timing_check`, `timing_decide`, `timing_inconsistencies`, `get_guest_stay` de la migration 13, `guest_places`, `service_timing_guard`, `guest_links_follow_stay` de la migration 12), supprimer `timing_state`, `timing_states`, `timing_email*`, `outbox_claim`, `guest_place_address_ok` ; les colonnes ajoutées peuvent rester.

**Tests** : isolation 2027/0 (section 18), concurrence 11/11 (deux responsables sur deux demandes du même séjour, deux envois simultanés), unitaires 163, e2e 54/54 (35 horaires successifs, 36 absences), auto-test local 60/62 (2 échecs = fournisseur de lieux non joignable en local).

## Règles de mission, linge préparé, correction complète, accueil par décisions (migration 19 : `20261114000001_regles_missions_linge_correction.sql`)

**Problèmes reproduits (test du 4/11)** : une livraison de linge affichée « possible à partir du 4/11 16 h » a pu être démarrée et terminée le 3/11 — `start_task` ne contrôlait aucune plage (l'écran non plus) ; « possible à partir du » de la livraison venait d'un calcul arbitraire (arrivée − 24 h), présenté comme une limite. La fin ne contrôlait que les photos obligatoires (ménage, contrôle) ; aucune checklist ni commentaire exigible. « Planifier la livraison » créait directement la mission. « Créneau fixé à la main » s'affichait pour toute mission créée manuellement (critère `is_auto_generated`), sans modification réelle. Une livraison terminée en attente de validation comptait comme faite dans « logement prêt ».

**Règle de démarrage (par type, réglable dans Réglages → Règles par type de mission)** :
- *ferme* (par défaut : ménage après départ, départ accompagné, reprise du linge — le logement doit être libéré) : démarrage refusé par la base avant le début de la plage, quel que soit le bouton (liste, fiche, appel direct), avec l'heure à partir de laquelle démarrer ; dérogation possible par un responsable (motif obligatoire, historique) ;
- *conseillé* (par défaut : accueil, contrôle, livraison de linge, maintenance, autre) : démarrer plus tôt demande une confirmation de l'agent, tracée « démarrée avant le début conseillé » ;
- la reprise après correction n'est jamais bloquée ; l'heure de référence est celle du serveur.

**Exigences de fin (`task_requirements`, même calcul pour l'écran et la base)** : photos obligatoires (par point de checklist, inchangé), checklist complète si exigée (ménage, contrôle), commentaire si exigé. Refus `missing:<liste>` : rien n'est perdu, la mission reste en cours, l'écran dit ce qui manque et y mène. La validation par un responsable applique les mêmes exigences. Par défaut checklist et commentaire **ne sont pas exigés** (comportement antérieur conservé) : à activer par type.

**Boucle de correction** : motif conservé jusqu'à la validation, événement « correction renvoyée », bandeau agent « correction envoyée au responsable », historique visible de l'agent avec l'auteur (vous / agent / un responsable / automatique), double validation sans effet, agent prévenu de la validation (`agent_task_validated`, selon ses préférences).

**Linge** : fiche courte préremplie (échéance = arrivée, début conseillé = recommandation, durée estimée, agent ou « attribuer plus tard », inconnues : quantités, stock, accès) ; `plan_linen_delivery` sous verrou : jamais deux livraisons pour un séjour (double clic, deux responsables). Accueil : absence → « rien de prévu » ; non attribuée → « personne n'est assigné » (lien vers la mission) ; attribuée/en cours → « encore à faire » ; terminée non validée → « à valider » (jamais prête) ; validée → plus rien ; annulée → de nouveau « rien de prévu ».

**Horaires voyageurs** : annuler une confirmation dont l'heure est passée ne rétablit plus l'horaire précédent automatiquement (`restore_unsafe`) ; le responsable peut retirer la confirmation sans toucher au séjour.

**Accueil** : « À traiter maintenant » (éléments actifs par urgence, avec explication, détail des missions à valider et incidents, action directe), arrivées des 48 h, « À surveiller », catégories vides regroupées dans « Sous contrôle » (repliable).

**Tests** : isolation 2090/0 (section 19), concurrence 13/13, unitaires 163, e2e 55/55 (8 dérogation, 12 correction, 15 linge, 37 parcours linge complet), auto-test local 62/64 (2 = fournisseur de lieux non joignable en local).

**Retour arrière** : restaurer `start_task` (4 paramètres), `finish_task`, `validate_task`, `log_task_change` (migration 9), `timing_decide` (migration 18) ; supprimer `task_type_rules`, `task_rule`, `task_requirements`, `allow_early_start`, `set_task_comment`, `plan_linen_delivery`, `timing_restore_allowed`, le déclencheur `tasks_notify_validated` ; les colonnes ajoutées peuvent rester.

## Anomalie de date des absences et fiabilisation des formulaires (lot du 4/11 soir — sans migration)

**Reproduit** (préprod locale, Chromium, fuseaux de l'appareil Paris / UTC / New York / Tokyo) : une valeur posée directement dans le champ date (comme le fait un outil de test automatisé ou une saisie automatique) affichait « 05/11 » mais l'absence était enregistrée au **4/11** — la date par défaut du formulaire (le jour du test). Saisie au clavier et `fill` : correctes. **Cause** : champ contrôlé par React ; une valeur posée sans passer par l'événement que React suit ne met pas à jour l'état du formulaire, et l'envoi utilisait l'état, pas la valeur affichée. Facteur aggravant : mises à jour d'état « `{ ...f, champ }` » qui, enchaînées, écrasaient le champ précédent.

**Correction** : composant `Input` — pour les champs date/heure, la valeur affichée resynchronise l'état (entrée, changement, sortie du champ, envoi) ; le formulaire d'absence relit les dates affichées au moment de l'envoi et montre « Sera enregistrée : jeudi 5 novembre 2026, journée entière » avant validation ; mises à jour d'état fonctionnelles dans les formulaires concernés. **Autre problème commun trouvé** : plusieurs champs « date et heure » étaient interprétés dans le fuseau de l'appareil (création de séjour, plage de mission, absence horaire, intervention, linge, affectation hors fenêtre) au lieu du fuseau du logement — corrigé (`localInputIn` / `fromLocalInput`). Les formulaires voyageur, préparation et prestation utilisaient déjà le fuseau du logement.

**Vérifié** : 36 combinaisons (clavier, `fill`, valeur posée, un seul champ ; 5 nov., 30 nov.→1er déc., 31 déc.→1er janv., 28 mars et 31 oct. 2027 — changements d'heure) : affiché = résumé = enregistré = liste après rechargement. Firefox et Safari (WebKit) non disponibles dans cet environnement ; sélecteur de calendrier natif non pilotable en automatique.

**Autres améliorations** : correction demandée affichée en haut de la fiche (motif, date, preuves désignées, prochaine action) jusqu'au renvoi ; carte d'arrivée : état du ménage et raison « pas encore prête » ; fiche séjour : position de chaque mission entre deux séjours ; « plage modifiée » seulement si une personne l'a modifiée ; adresses de test `.invalid` comptées à part (« non envoyé volontairement ») ; bouton de la page de connexion qui débordait sur téléphone.

**Tests** : unitaires 167 (dont dates/fuseaux/changements d'heure), isolation 2090/0, e2e 57/57 (38 dates, 39 corrections successives), captures téléphone simulé (iPhone 13) sans débordement.

## Origine des plages, missions incompatibles avec l'arrivée, absences sur l'arrivée (migration 20 : `20261115000001_origine_plages_conflits_arrivee.sql`)

**Contradiction du 5/11 (QA Carte : « modifiée par un responsable » sur la fiche mission, « calculée automatiquement » sur la fiche séjour)** — cause vérifiée dans le code : la fiche séjour lisait le bon indicateur (`is_auto_generated`, celui qu'utilise le recalcul) ; la fiche mission déduisait « modifiée » de l'historique, où le recalcul automatique et la décision d'horaire voyageur étaient enregistrés avec la session du responsable, donc comme une modification humaine. Erreur d'affichage + historique ambigu ; la logique de recalcul était correcte (elle ne touchait que les missions automatiques, mais par un filtre côté application seulement).

**Correction** : une seule source de vérité (`is_auto_generated`) sur toutes les fiches ; historique avec l'origine de chaque changement de plage (`sync` recalcul automatique sans auteur, `timing` décision d'horaire, `manual` responsable, `unknown` pour les anciens changements) ; recalcul via `apply_task_sync`, qui refuse côté base toute plage manuelle (`manual_kept`) ou mission terminée.

**Missions incompatibles avec l'arrivée confirmée** (`prep-conflicts.ts`, sans recalcul) : impossible / à vérifier / inconnu (mission en cours) / possible d'après les données connues — fiche séjour, fiche mission (arrivée, plage, durée estimée, plage manuelle) et carte d'arrivée (bloquée si impossible). Une plage manuelle n'est jamais modifiée : HALO signale et propose d'agir.

**Absences** : toute mission liée à l'arrivée ; absence couvrant la plage d'une mission non commencée → bloquée ; absence partielle ou mission déjà en cours → « à vérifier, avancement inconnu », jamais « impossible ».

**Voyageur** : suggestion « Allergies » retirée ; consigne commune « aucune information de santé ni de paiement » (demande, horaire, questionnaire). Le champ « précisions » est lisible par les responsables (pas les agents), n'est pas copié dans les e-mails d'équipe, et est conservé avec la demande (supprimé avec le séjour ou l'organisation) — aucune durée de conservation spécifique définie.

**Tests** : isolation 2112/0 (section 20), concurrence 13/13, unitaires 172, e2e 59/59 (40, 41), téléphone simulé sans débordement.

**Retour arrière** : restaurer `log_task_change` (migration 19), supprimer `apply_task_sync` (l'application revient à la mise à jour filtrée).

## Expérience manager en quatre espaces (migration 21 : `20261116000001_depassement_fin_incident_ouvert.sql`)

**Navigation (sans migration).** Le responsable navigue entre quatre espaces : **Tableau de bord** (`/app`), **Logistique** (Missions, Incidents, Logements), **Équipe** (Membres et absences, À valider, Messages) et **Guest** (Séjours, Prestations, Demandes de séjour, Satisfaction). Aucune adresse n'a changé : chaque page existante est rattachée à un espace d'après son adresse, ce qui garde valides les liens des e-mails et les favoris. « À valider » reste `/app/missions?status=done`. Les pages de compte (profil, préférences, réglages, configuration, import, journal des e-mails) sont dans le menu Compte, en haut à droite. Les messages sont toujours accessibles en haut, avec le nombre réel de conversations non lues. Sur téléphone, une barre inférieure propose les quatre espaces. La navigation de l'agent est inchangée.

**Tableau de bord.** Il est organisé en quatre blocs : « Urgent ou bloquant », « En attente de votre décision », « Aujourd'hui et demain » (arrivées sous 48 h et missions des 24 h) et « Synthèse ». Un sujet est classé urgent selon des règles explicites : incident marqué urgent, horaire promis qui contredit le séjour, ménage impossible entre deux séjours, ou mission empêchée par une absence. Le tableau de bord n'affiche pas « sous contrôle » : les catégories vides sont annoncées comme « rien en attente ».

**Incident → intervention → validation → résolution.** Valider une intervention ne résout pas l'incident. HALO pose ensuite la question « L'incident est-il résolu ? », sur la fiche de la mission, dans la liste des incidents et au tableau de bord. Le responsable choisit « Résoudre », avec un compte rendu, ou « Le laisser ouvert ». Ce second choix est enregistré par `keep_incident_open`, et la question revient si une nouvelle intervention est validée plus tard. Pour un incident signalé par un voyageur, la résolution se fait depuis la liste des incidents, ce qui permet de lui envoyer un message.

**Mission trop longue (migration 21).**
- À la durée estimée, comptée depuis le démarrage réel, l'agent voit un rappel **dans l'application** : sur la fiche de la mission et dans sa liste. Il peut répondre « Oui, je continue » (`task_overrun_continue`, la question revient 30 min plus tard) ou « J'ai terminé », qui le renvoie aux étapes de fin habituelles.
- S'il a oublié de terminer, l'agent propose une heure de fin antérieure (`propose_task_end`), comprise entre le démarrage et maintenant. Un responsable l'accepte ou la refuse (`decide_task_end`). L'historique garde tout. Le statut et `completed_at` ne changent pas ; l'heure acceptée va dans `reported_end_at`.
- Sans réponse après le délai choisi (`organizations.overrun_alert_min`, 30 min par défaut, réglable dans Réglages), la mission remonte au tableau de bord du responsable.
- Le temps n'est jamais arrêté automatiquement et HALO ne qualifie jamais un dépassement de faute.
- **Limite :** il n'y a pas de notification push. Le rappel n'apparaît que si l'agent ouvre l'application. Il est calculé sur l'appareil, donc il s'affiche aussi hors ligne, mais la réponse n'est envoyée qu'avec du réseau.

**Messagerie et fiche agent.**
- La liste des conversations met la personne en premier : initiales, aperçu du dernier message, date et non-lu. La conversation reprend la présentation habituelle des bulles, avec le contexte (mission, logement ou séjour) et un lien pour l'ouvrir. Sur téléphone, la zone de saisie reste visible.
- L'état « vu » est calculé à partir de la dernière ouverture de la conversation. HALO n'affiche ni accusé de remise ni présence en ligne.
- Règle d'accès affichée dans l'interface et appliquée par la base (`can_read_thread`) : les participants et les responsables de l'organisation peuvent lire une conversation ; les autres agents, les voyageurs et les autres organisations ne le peuvent pas.
- Nouvelle fiche membre `/app/team/[id]`, réservée aux responsables : appeler (si un numéro est renseigné), écrire, missions à valider, missions en cours et à venir, dernières validées, conversations, absences à venir (type et période seulement, jamais le motif). Le nom et le téléphone sont modifiés par la personne elle-même : la base n'autorise pas un responsable à les changer.

**Compatibilité.** Les pages lisent les colonnes de la migration 21 dans des requêtes séparées. Tant que la migration n'est pas appliquée, les fiches restent affichables et ces informations sont simplement absentes. Le réglage du délai indique qu'il sera disponible après la mise à jour de la base.

## Fiabilité, messagerie, carte « Découvrir les alentours » (migration 22 : `20261117000001_alentours_types_favoris.sql`)

**Absences (sans migration).** Le retour du 5/11 montrait une demande **en attente** parmi les « conflits confirmés ». C'est corrigé avec `conflictGroup`, qui applique une seule règle partout (Équipe et tableau de bord) :
- **confirmé** : une absence **acceptée** ou une fermeture rend la mission impossible ;
- **à examiner** : absence partielle, ou mission déjà en cours ;
- **potentiel** : la demande est encore en attente, rien n'est bloqué.

Une absence refusée ou annulée ne produit aucun conflit. Le tableau de bord ne compte en « urgent » que les conflits confirmés.

**Rappel de durée.**
- Une réponse au rappel donnée après la fin, l'annulation ou la réattribution de la mission renvoie « stale ». Rien n'est enregistré et l'agent voit un message clair.
- La migration 22 remplace `task_overrun_continue` et `propose_task_end` pour cela. Avant, ces cas renvoyaient une erreur de droits.
- L'heure à laquelle l'agent a déclaré la fin (« Déclarée le… ») s'affiche à côté de l'heure qu'il propose.
- Le responsable peut accepter ou refuser l'heure proposée. Un refus ne change pas l'heure retenue.

**Messagerie.** À l'ouverture, la conversation affiche les derniers messages. Sur téléphone, la barre inférieure s'efface pendant la saisie pour laisser la place à la zone de texte. Les accès ont été vérifiés : un second agent fictif ne voit ni la conversation ni la mission de l'autre agent (page 404), et une autre organisation non plus.

**Fiche membre.** Elle s'ouvre en lecture. Le bouton « Modifier la fiche » permet de changer le poste et le type de collaboration (salarié, indépendant, entreprise partenaire). La base applique les droits : un responsable modifie les agents, le propriétaire tous les membres. Le nom et le téléphone restent ceux saisis par la personne.

**Fiche logement.** Elle affiche d'abord les séjours, les missions et les incidents en cours. Le livret, les calendriers et les alentours sont dans des sections repliables, chacune avec un résumé. Une section s'ouvre directement depuis un lien qui la vise (par exemple `#places`).

**Découvrir les alentours (migration 22).**
- **Ce qui existait :** carte OpenStreetMap (Leaflet) centrée sur le logement sans demander la position du voyageur, 5 catégories larges, liste avec origine des lieux, distance arrondie, horaires seulement si la source les donne, itinéraire Plans / Google / Waze, adresse et lieux proches masqués avant l'ouverture, message si le fond de carte ne charge pas.
- **Ce qui est ajouté :**
  - une entrée « Découvrir les alentours » en haut de l'espace voyageur ;
  - le choix Carte / Liste ;
  - des filtres par envie : restaurants, cafés et bars, courses, commerces, activités, transports, pharmacies, services utiles ;
  - un choix de rayon : 500 m, 1 km, 2 km ou tout (3 km au plus) ;
  - une fiche lieu dépliable, qui s'ouvre aussi en touchant un marqueur sur la carte ;
  - l'indication quand une adresse ou des horaires manquent ;
  - pour les pharmacies et les lieux de santé, un avertissement : HALO ne sait pas s'ils sont ouverts ni s'ils prennent en charge une urgence, avec le rappel du 112 / 15.
- **Type précis des lieux :** nouvelle colonne `property_places.kind`, remplie à l'import depuis OpenStreetMap, Photon ou Geoapify. Tant que la migration n'est pas appliquée, l'import enregistre les lieux sans ce type.
- **Favoris du voyageur :** nouvelle table `stay_place_favorites`, rattachée au séjour (on les retrouve sur tout appareil qui ouvre le lien), et nouvelle fonction `guest_place_favorite(token, place, fav)`. Les favoris ne sont lisibles et modifiables qu'avec un lien valide : expiré ou révoqué, la réponse est « unavailable ». Un lieu qui n'est pas visible pour ce voyageur à ce moment ne peut pas être mis en favori. L'équipe peut les lire ; ni les agents ni les autres organisations.
- **Données envoyées à des fournisseurs :** les tuiles de carte viennent de tile.openstreetmap.org, appelé depuis le navigateur du voyageur (le fournisseur voit son adresse IP et la zone affichée). Les lieux sont importés par l'équipe, via Overpass, Photon ou Geoapify si une clé est configurée. Rien n'est envoyé sur le voyageur lui-même.
- **Pas encore fait :** recherche par envie en langage libre avec une IA (aucun fournisseur configuré, donc rien de simulé), et filtre « ouvert maintenant » (aucune donnée d'ouverture fiable).

**Notifications push : état réel.**
- Il n'existe ni service worker, ni manifeste d'application, ni enregistrement des abonnements, ni clés VAPID. Aucune notification push n'est donc envoyée.
- Ce qui fonctionne aujourd'hui : les informations affichées dans l'application et les e-mails.
- **Pour activer le Web Push**, il faut :
  1. générer une paire de clés VAPID (gratuit) et mettre la clé privée dans les variables Vercel, jamais dans le dépôt ;
  2. ajouter un service worker et un manifeste ;
  3. créer une table des abonnements par appareil, avec révocation ;
  4. ajouter l'envoi des notifications depuis la file existante ;
  5. ajouter un écran d'autorisation qui gère le refus.
- Sur iPhone, le push ne fonctionne que si HALO est ajouté à l'écran d'accueil (iOS 16.4 ou plus récent).
- Il faudra tester sur un vrai téléphone.

## Refonte visuelle (référence : la démo)

Cette refonte ne touche ni la base de données ni aucune adresse.

**Éléments repris de la démo** :
- la barre latérale sur ordinateur ;
- les pastilles de type de mission (`TaskTypeIcon`, avec la couleur du type) ;
- les statuts sous forme de point et de libellé (`StatusPill`) ;
- les indicateurs chiffrés (`KpiCard`) ;
- le sélecteur segmenté ;
- les états vides (`EmptyState`) ;
- les lignes courtes « À traiter » ;
- la carte de mission côté agent, avec une barre de couleur selon le type.

**Écrans modifiés**

- **Navigation** :
  - sur ordinateur, une barre latérale avec les quatre espaces, l'environnement et l'organisation ;
  - en haut, les messages, la langue et le compte ;
  - les rubriques de chaque espace en onglets ;
  - sur téléphone, une barre inférieure pour le responsable, et une nouvelle barre inférieure pour l'agent (Missions, Messages, Profil, Préférences).
- **Liste des missions (responsable)** :
  - chaque ligne montre le logement mis en avant, le type (et l'intitulé seulement s'il existe), le jour et le créneau ou l'heure limite, la personne et le statut ;
  - une alerte courte s'affiche si besoin : « Hors délai », « Personne absente », « Durée dépassée » ou « À assigner » ;
  - le sélecteur de personne n'apparaît que si l'affectation est modifiable, sous forme de pastille ; sinon on voit les initiales et le nom ;
  - les filtres agissent réellement sur la requête et sont conservés dans l'adresse : période, statut, type, logement, recherche.
- **Liste des missions (agent)** : des cartes terrain avec le logement, l'adresse, l'horaire, les consignes en aperçu et l'action (démarrer ou terminer).
- **Tableau de bord** :
  - quatre chiffres réels (arrivées et départs du jour dans le fuseau de l'organisation, missions du jour, missions sans agent), chacun menant à la liste filtrée ;
  - « À traiter » en lignes courtes, l'urgent d'abord ;
  - « Prochaines 24 heures » sous forme de tableau ;
  - les arrivées, puis la synthèse.
- **Fiche mission** : un en-tête avec le type, le statut, le logement et l'adresse, puis les horaires regroupés dans une carte.

**Carte « Découvrir les alentours »** : les tuiles « 403 Access blocked » venaient de la règle `no-referrer` de l'espace voyageur, qui protège le jeton du lien. Sans en-tête Referer, le serveur OpenStreetMap refuse les tuiles. Corrections :
- les tuiles, et elles seules, sont maintenant demandées avec `strict-origin-when-cross-origin` : seule l'origine du site est transmise, jamais le jeton ;
- une tuile est vérifiée avant l'affichage : si elle est refusée ou inaccessible, la carte est remplacée par le message « Carte indisponible pour le moment » et la liste reste complète.

## Retour à la navigation et à la présentation de la démo (sans migration)

La navigation en quatre espaces est abandonnée. Le responsable retrouve les **neuf entrées de la démo** : Aujourd'hui (`/app`), Planning (`/app/planning`), Tâches (`/app/missions`), Alertes (`/app/incidents`), Prestations, Logements (+ import), Linge (`/app/linen`), Équipe, Réglages (+ configuration, journal des e-mails). Un groupe « Séjours et voyageurs » donne accès aux Séjours (espace Guest), Messages (non-lus réels), Demandes de séjour et Satisfaction. Sur téléphone : barre basse de la démo (Aujourd'hui, Planning, Tâches, Alertes avec le nombre d'alertes ouvertes) et « Plus » pour le reste. Messages, langue et compte restent accessibles en haut. Aucune adresse n'a changé. Agent inchangé ; Planning et Linge le renvoient vers ses missions.

**Écrans**
- **Aujourd'hui** : titre et date comme la démo ; chiffres réels Arrivées, Départs, Ménages du jour, Sans agent ; « À traiter » ; « Journée » (24 h) avec lien vers Planning.
- **Planning** (nouveau, données réelles) : journée par agent sur une grille horaire 7 h–22 h (élargie si une mission en sort), missions à affecter en tête, arrivées et départs du jour, navigation jour par jour ; sur téléphone, puces par agent et liste horaire. L'affectation se fait depuis la mission (absences et conflits vérifiés) : pas de glisser-déposer.
- **Tâches / Alertes** : titres de la démo ; liste compacte inchangée (logement, horaire, agent, statut).
- **Linge** (nouveau) : uniquement du réel — livraisons et collectes des 7 prochains jours (vraies missions), missions linge sans agent, incidents linge ouverts, organisation du linge déclarée (modèle, délai de rotation, contrôle dans « logement prêt »).

**Linge : ce qui n'existe que dans la démo** (affiché tel quel dans la carte « Pas encore disponible ici », sans chiffre ni bouton) et ce qu'il faut construire :
1. Stocks par emplacement → catalogue d'articles et mouvements propre / sale / blanchisserie / logement.
2. Besoins et kits par logement → composition par logement, besoins calculés depuis les séjours réels.
3. Alertes de manque → stock disponible / besoins 7 jours (dépend de 1 et 2).
4. Commandes blanchisserie → commandes (pièces, retour prévu, coût), statuts, rapprochement à la livraison.
5. Accès blanchisseur externe → rôle partenaire limité à ses commandes, cloisonné par organisation, testé.
6. Journal et coûts → historique et coût par rotation alimentés par les commandes.

## Fiabilisation : planning, linge, mission oubliée (migration 23)

**Planning — causes et règle unique** (`src/lib/engine/placement.ts`, partagée par Planning, Aujourd'hui et Linge)
- Cause 1 : le planning plaçait toute mission à `scheduled_start ?? window_start` → une mission sans créneau (plage 10:41–16:00, 1 h 30) apparaissait comme un créneau 10:41–12:11.
- Cause 2 : sélection par recoupement de plage avec borne `>=` et placement « en haut de journée » des missions commencées la veille → une mission du 5 apparaissait le 6 (plage se terminant le 6, ou exactement à minuit).
- Cause 3 (liste des missions) : « Aujourd'hui / 7 jours » calculés sur le minuit du serveur (UTC sur Vercel), pas celui de l'organisation.
- Règle : plage autorisée, durée estimée et créneau planifié sont distincts. Sur la grille : uniquement un créneau fixé (« Planifié ») ou des heures réelles (« En cours depuis », « Réalisé », fin retenue prioritaire). Sans créneau ou sans agent : bandeau « À planifier » avec la plage et la durée. Appartenance à un jour : intervalle réel `[début, fin)` recoupant la journée du fuseau de l'organisation (bornes strictes, découpe à minuit, changement d'heure géré). HALO ne propose pas encore d'horaire suggéré.

**Linge — cause et correction** : « Missions linge sans agent » ouvrait `/app/missions?status=unassigned` sans filtre de type (et période/statut différents du compteur). Les compteurs Linge, Accueil et la liste partagent désormais `periodBounds` / `statusesOf` / `typesOf` (`src/lib/connected/mission-filters.ts`) ; filtre « Linge (livraisons et collectes) » ajouté ; liens : `period=week&status=all&type=linen_delivery|linen_pickup`, `period=week&status=unassigned&type=linen`, `/app/incidents?category=linen&open=1`. Zéro résultat : écran qui rappelle la période, le statut et le type.

**Mission oubliée (migration 23 `20261118000001_regularisation_annulation_en_cours.sql`)**
- Agent : « Êtes-vous toujours en mission ? » à la durée estimée (dans HALO uniquement, mention explicite : aucune notification téléphone) ; « Oui, je continue » ou heure de fin proposée.
- Responsable : heure de déclaration et heure proposée distinctes ; accepter / refuser (historique).
- `regularize_task_end(org, task, ended_at, reason)` : responsable, mission en cours, motif obligatoire ; statut « Terminée, à valider » (jamais validée, même si le type est clôturé sans validation) ; auteur, date, motif ; preuves manquantes figées (`regularized_missing`) et toujours exigées par la validation ; proposition en attente → « sans objet ».
- `cancel_task(org, task, reason)` : annulation y compris d'une mission en cours (motif obligatoire dans ce cas), jamais d'une mission terminée.
- Réponses tardives (rappel, heure proposée, décision, « Terminer ») : sans effet sur une mission régularisée, annulée ou réattribuée (`stale` / `already`).
- Historique : `end_regularized` et `cancelled` portent le motif.

**Notifications** : pas de push ni de SMS. Les textes « prévenu » indiquent désormais « dans HALO (et par e-mail selon les préférences, si l'envoi est configuré) ».

## Brief du 8/11 : régularisation, calcul automatique, alentours avant l'arrivée, linge opérationnel (migrations 24 à 26)

**Étape 1 — fiabilité (migration 24 `20261119000001_retour_calcul_automatique.sql`)**
- Fin régularisée : `placement()` / `whenLabel()` (`src/lib/engine/placement.ts`) distinguent « Réalisé » (fin déclarée par l'agent) de « Fin régularisée par un responsable … · preuves manquantes ». Planning, accueil (« Journée », « À valider »), Linge et liste (pastilles « Fin régularisée », « Preuves manquantes ») appliquent la même règle.
- « Revenir au calcul automatique » (fiche mission, plage fixée par un responsable, mission non démarrée liée à un séjour) : aperçu calculé par le même moteur que la synchronisation (`previewAutoWindow`), avertissements (mission impossible, agent absent — confirmation bloquée —, absence partielle ou demande en attente), confirmation recalculée côté serveur (`restoreAutoWindow` → `restore_auto_window`), historique `auto_restored` + `window_changed` d'origine `auto_restore`.
- Libellés d'urgence : « e-mail même si coupé, si l'envoi est configuré · pas de notification téléphone ».

**Étape 2 — alentours avant l'arrivée (migration 25 `20261120000001_alentours_avant_arrivee.sql`)**
- Avant l'échéance : zone = centre de la maille de 0,015° contenant le logement (`public.zone_center`, `src/lib/engine/zone.ts`), cercle sur la carte, aucun point « logement ». Lieux récupérés autour du centre de zone (`scope = 'zone'`, `src/lib/connected/zone-places.ts`, après la première ouverture du lien ou à l'actualisation des suggestions), distances depuis ce centre arrondies à 100 m. Test SQL : déplacer le logement dans sa maille ne change rien à la réponse.
- Recommandations de l'équipe avant l'échéance : comme avant (≥ 300 m, sans coordonnées), distance depuis la zone. Compromis signalé.
- Horaires transmis seulement s'ils sont vérifiés par l'équipe depuis moins de 6 mois.
- Après l'échéance : lieux du logement + lieux de zone non doublés ; favoris choisis avant l'arrivée retrouvés.

**Étape 3 — linge opérationnel (migration 26 `20261121000001_linge_operationnel.sql`)**
- Tables `linen_items`, `property_linen_kits`, `linen_movements` (responsables uniquement ; mouvements écrits seulement par fonctions). Fonctions `linen_stock`, `linen_count`, `linen_move` (jamais de stock négatif), `linen_apply_task` (kit sorti du propre / entré au sale, une fois par mission), `plan_linen_pickup`.
- Calcul `linenPlan` (`src/lib/engine/linen-plan.ts`) : besoins 14 jours = kits × arrivées confirmées ; alertes manque potentiel (date et logement), kit non défini, stock non renseigné, catalogue vide ; jamais « tout est prêt » sans données complètes.
- Page Linge : « Ce qui manque · où et quand agir » (alertes, livraisons et collectes à planifier avec la composition du kit, missions terminées à reporter au stock), missions, stock et besoins, inventaire, mouvements, kits, catalogue (liste de départ), historique.
- Étape 2 (blanchisseur externe) non construite.

## Recommandations avant l'arrivée et notifications push (migrations 27 et 28)

**Migration 27 — `20261122000001_recommandations_avant_arrivee.sql`** (prérequis : 25)
- `property_places.guest_visibility` : `access` (par défaut : à l'ouverture des informations pratiques) ou `booking` (dès la réservation). Rien ne devient visible plus tôt sans choix explicite de l'équipe.
- Avant l'ouverture, une recommandation `booking` est **listée** (nom, catégorie, adresse, conseil) **sans point sur la carte** : un ensemble de choix de l'équipe groupés autour du logement permettrait de le retrouver par recoupement. Les distances partent du centre de zone, arrondies à 100 m.
- Garde-fous automatiques : recommandation retenue jusqu'à l'ouverture si elle est à moins de 200 m du logement ou dans la même rue. Adresse masquée si la distance n'est pas vérifiable (lieu sans position).
- `guest_text_safe` masque les descriptions et conseils qui situent le logement (« en bas de l'immeuble », « à 50 m », « 5 min à pied », « next door »…). Même liste dans `src/lib/engine/privacy.ts`, pour avertir l'équipe pendant la saisie.
- Contenus publiés à l'avance (`get_guest_stay` → `prepared`) : adresse du lieu associé selon la même règle.
- Recommandations ajoutées par l'équipe : position calculée à partir de leur adresse (OpenStreetMap, ville du logement), retenue seulement si elle est plausible (moins de 5 km).
- Retour arrière : `drop function public.guest_pick_before_access, public.street_of, public.guest_text_safe` après avoir réappliqué les fonctions de la migration 25. Ensuite, `alter table public.property_places drop column guest_visibility`.

**Migration 28 — `20261123000001_notifications_push.sql`** : voir `docs/17-notifications-push.md`. Aucun envoi sans `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` et `VAPID_SUBJECT` côté serveur.
