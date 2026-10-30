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
