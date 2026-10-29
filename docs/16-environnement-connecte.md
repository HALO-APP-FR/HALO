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
| Incidents et blocages | Agent depuis sa mission (blocage, manque de matériel, dégât…), voyageur depuis son espace ; prise en charge et résolution par l'équipe ; note interne séparée du message au voyageur (e-mail s'il a une adresse) ; incidents ouverts pris en compte dans « logement prêt » | `/app/incidents`, mission, `/s/<lien>` |
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
