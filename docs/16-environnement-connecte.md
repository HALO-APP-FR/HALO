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
| Missions | Assignation (manager), démarrer / terminer (agent, ses missions seulement) | `/app/missions` |
| Équipe | Lien d'invitation (7 jours), acceptation avec son propre compte | `/app/team`, `/invite/[token]` |
| Espace voyageur | Lien de séjour sans compte : livret, dates, demandes, réponses, messages | `/s/[token]` |
| Prestations | Reçue, précisions (question + réponse), acceptée, refusée (motif), modifiée, annulée, réalisée | `/app/services` |
| Notifications | Dans l'espace voyageur + e-mail si adresse connue **et** fournisseur configuré ; état réel, échec visible, relance | historique d'envoi |

Le reste de l'application (planning, linge, arrivées, alertes, comptes rendus photo de l'agent…) **reste la démo** (navigateur, badge « Démo »). Les deux ne se mélangent pas : la démo n'écrit jamais dans la base, l'environnement connecté n'utilise pas le stockage du navigateur.

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

## Passer en préproduction Vercel (actions de Mathieu)

1. Supabase → nouveau projet **halo-test**, région **Paris (eu-west-3)**, offre gratuite.
2. SQL Editor → exécuter les 4 fichiers de `supabase/migrations/` dans l'ordre.
3. Authentication → URL Configuration : Site URL = l'URL de préproduction ; Redirect URLs : `https://<url-de-préproduction>/api/auth/callback`.
4. Authentication → Email Templates → « Magic Link » : ajouter `{{ .Token }}` (le code à 6 chiffres) à côté du lien.
5. Vercel → Settings → Environment Variables, **portée Preview uniquement** : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_HALO_ENV=preprod`, `SUPABASE_SERVICE_ROLE_KEY` (secret), et si un fournisseur est choisi `SMTP_URL`, `EMAIL_FROM`.
6. GitHub → secret `SUPABASE_TEST_DB_URL` (chaîne de connexion de halo-test) pour les tests d'isolation automatiques.
7. Redéployer la préproduction.

Sans `SMTP_URL`, aucun e-mail n'est envoyé et chaque envoi est marqué « Non envoyé : aucun service d'envoi configuré ». Pas de SMS.

## Limites connues

- L'import de calendriers (Airbnb, Booking…) n'est pas encore relié à la base : la question d'onboarding sert à le préparer, elle le dit.
- Les « propositions » de configuration sont des **règles explicites** (aucun modèle d'IA appelé) ; chaque proposition affiche sa raison.
- Le compte rendu photo de l'agent (checklist + photos) reste dans la démo ; « Terminer » est refusé côté base si des photos obligatoires manquent.
- Un e-mail resté « en attente » (coupure pendant l'envoi) n'est retraité qu'à la prochaine action de l'organisation ; une tâche planifiée sera ajoutée.
