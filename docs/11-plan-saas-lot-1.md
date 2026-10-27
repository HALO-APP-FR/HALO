# HALO — Plan SaaS révisé et lot 1

Statut au 27/10/2026 : **étape 1.1 réalisée** (schéma, règles et tests sur une base locale). Il n'y a **aucun projet Supabase**. L'application n'est **pas encore branchée** à la base : elle reste une démo locale.

**Règle ferme** : aucune vraie donnée client dans HALO avant que la connexion, le cloisonnement des organisations et l'accès aux photos soient en place et vérifiés sur l'environnement réel (fin de l'étape 1.5).

> **Révisé** : voir `13-revision-avant-etape-1-2.md` (liens invités avant tout voyageur, codes en ligne uniquement, conflits hors ligne conservés, projet de test dédié, réglages Vercel, connexion e-mail). Ce document-là fait foi en cas de différence.

Décisions déjà validées : on garde Next.js et Vercel ; la base est PostgreSQL (Supabase) ; une conciergerie = une organisation ; le cloisonnement est appliqué par la base et par le stockage. Ce document remplace le plan de migration du §6 de `10-architecture-saas.md`.

---

## 1. Ce qui est indispensable avant le premier client réel (le socle)

### Lot 1 (en cours)

| Étape | Contenu | Preuve attendue | État |
|---|---|---|---|
| 1.1 | Schéma, règles d'accès (RLS), fonctions, stockage privé. Tests d'isolation sur PostgreSQL local et en CI | `supabase/tests/run.sh` : 759 vérifications, 0 échec. Un test de mutation volontaire est bien détecté | ✅ fait |
| 1.2 | Projet Supabase **Paris** (sur ton compte), migration appliquée, mêmes tests rejoués sur le vrai projet avec des comptes fictifs. Région Vercel `cdg1`. Variables d'environnement (la clé `service_role` est collée par toi dans Vercel, jamais ici) | Rapport de tests sur le vrai projet ; test au build : aucune clé secrète dans les fichiers envoyés au navigateur | à faire |
| 1.3 | Connexion réelle : lien par e-mail (managers et agents), sélecteur d'organisation, création d'organisation, invitation d'un agent | Test de bout en bout : 2 organisations, 2 navigateurs, aucune donnée croisée visible | à faire |
| 1.4 | Logements, séjours et missions lus et écrits dans la base (Server Actions avec la session de l'utilisateur). Le moteur métier existant est réutilisé | Mêmes écrans, données en base ; tests e2e | à faire |
| 1.5 | Photos privées : réservation du chemin, envoi, URL signée courte, file d'attente hors ligne pour l'agent | Test : photo d'une organisation inaccessible depuis l'autre, même avec l'URL du fichier | à faire |

### Encore indispensable avant un client réel, mais après le lot 1
- **Sauvegardes** : plan Pro (sauvegarde quotidienne, 7 jours) et **un test de restauration** réalisé et chronométré.
- **SMTP professionnel** pour les e-mails de connexion (le service intégré de Supabase sert aux essais seulement).
- **Suivi des erreurs** sans données personnelles dans les journaux.
- Mentions légales, politique de confidentialité, contrat de sous-traitance (RGPD) avec la conciergerie cliente.

## 2. Fonctions à développer après validation du socle

Par ordre conseillé :
1. Alertes et prestations en base (historique, photos de preuve).
2. Synchronisation iCal automatique côté serveur (tâche planifiée).
3. **Liens voyageurs** par séjour (jeton haché, durée du séjour, révocables). Ils remplacent le livret intégré au lien (`#d=`).
4. Linge : migration complète (journal immuable des mouvements, stock calculé, bons de blanchisserie).
5. Import de la démo vers une organisation de test.
6. SMS (connexion des agents ou notifications), à décider selon le coût.
7. Facturation (abonnement par organisation).
8. Copie de sauvegarde externe (voir §3).

## 3. Sauvegarde et exploitation : options chiffrées

Prix publics relevés le 27/10/2026, hors taxes, à revérifier avant souscription.

| Option | Ce que ça couvre | Coût | Recommandation |
|---|---|---|---|
| Supabase **Pro** | Base 8 Go, fichiers 100 Go, sauvegarde quotidienne gardée **7 jours**, journaux 7 jours | **25 $/mois** (une petite instance de calcul incluse) | Indispensable avant le premier client |
| **PITR** Supabase (restauration à la minute, 7 jours) | Erreur humaine ou suppression massive : on revient juste avant | **+100 $/mois** | Dès qu'il y a plusieurs clients payants |
| Copie **externe** de la base (`pg_dump` chiffré chaque nuit) vers un stockage S3 européen (ex. Scaleway Paris) | Perte du compte ou du projet Supabase | Stockage ≈ 0,015 €/Go/mois : quelques euros par mois. Tâche planifiée GitHub Actions : incluse dans le quota gratuit | Lot « après socle » |
| Copie externe des **fichiers** (photos) | Les sauvegardes Supabase **n'incluent pas** les fichiers | Idem, selon le volume (100 Go ≈ 1,5 €/mois) | Même lot que la copie de la base |
| Vercel **Pro** | Choix de la région, protections, journaux plus longs | ≈ 20 $ par membre de l'équipe et par mois | Utile au passage en exploitation |
| Domaine personnalisé pour Supabase | Connexion sur `auth.halo…` plutôt que `*.supabase.co` | 10 $/mois | Facultatif |
| Test de restauration trimestriel | Prouver qu'on sait restaurer, et en combien de temps | Environ 1 h de travail | Indispensable |

---

## 4. Lot 1 en détail

### Périmètre
**Inclus** : profils, organisations, membres, invitations, logements, accès (codes), couchages, checklists (pièces et points), séjours, missions, rapports de mission, actions terrain hors ligne, fichiers (photos de mission et de référence), journal des consultations de codes.

**Exclus** : facturation, liens voyageurs, SMS, copie S3 externe, linge, alertes, prestations, iCal automatique, livret voyageur.

### Modèle de données (`supabase/migrations/20261027000001_lot1_socle.sql`)

```
auth.users ─ profiles
organizations ─┬─ memberships (user_id, rôle, poste, couleur, actif)
               ├─ invitations (empreinte du jeton, rôle, expiration)
               ├─ properties ─┬─ property_access (codes : aucun accès direct)
               │              ├─ access_reveals (journal : qui a vu quel code)
               │              ├─ beds
               │              └─ checklist_rooms ─ checklist_items
               ├─ reservations
               ├─ tasks ─┬─ task_reports
               │         └─ task_actions (actions terrain rejouables)
               └─ files (métadonnées ; binaire dans le bucket privé org-files)
```

- Chaque table métier porte `organization_id`. Toutes les références internes sont des **clés composites** `(organization_id, id)`. Même un manager légitime de A **ne peut pas** relier un séjour de A à un logement de B, ni assigner une mission de A à un agent de B : la base refuse (testé).
- `organization_id` ne peut jamais être modifié, même par le super-utilisateur (déclencheur, testé).
- Horaires en `timestamptz` ; affichage au fuseau du logement, comme aujourd'hui.

### Règles d'accès

| Table | Lire | Créer | Modifier | Supprimer |
|---|---|---|---|---|
| organizations | membres | via `create_organization()` | owner, manager | personne (lot 1) |
| memberships | membres de l'organisation | via `create_organization()` / `accept_invitation()` | owner : tous ; manager : agents ; uniquement poste, couleur, actif ; le **rôle** seulement via `set_member_role()` (owner) | owner ; manager (agents) ; soi-même (quitter). Dernier owner protégé |
| invitations | managers (sans l'empreinte du jeton) | via `create_invitation()` (manager → agents ; owner → tous) | personne | managers |
| properties, beds, checklists | managers ; agent : logements de ses missions récentes | managers | managers | owner (logements), managers (reste) |
| property_access | **personne** (même pas le owner) : uniquement `reveal_access()` | via `set_property_access()` (managers) | idem | cascade du logement |
| access_reveals | managers | automatique | personne | personne |
| reservations | managers ; agent : séjours liés à ses missions récentes | managers | managers | managers |
| tasks | managers ; agent : **les siennes** (actif, non annulées) | managers | managers ; agent **uniquement** via `start_task()` / `finish_task()` | managers |
| task_reports | managers ; agent de la mission | managers ; agent via `save_task_report()` | idem | managers |
| task_actions | managers ; l'auteur | fonctions terrain | personne | personne |
| files + stockage | voir ci-dessous | via `begin_upload()` | jamais | managers ; l'agent tant que sa mission n'est pas terminée |
| *anonyme* | **rien** : aucun droit sur aucune table ni fonction (testé) | | | |

« Mission récente » : mission assignée à l'agent, membre actif, non annulée, dont la fenêtre se termine il y a moins de 30 jours ou plus tard.

### Comment un agent accède aux fichiers de ses missions (pas seulement parce qu'il est membre)
Être membre de l'organisation **ne suffit pas**. Un fichier n'est lisible par un agent que si :
- c'est une **photo de mission** et la mission lui est **assignée aujourd'hui**, il est actif, elle n'est pas annulée et elle est récente ;
- ou c'est une **photo de référence** d'un logement où il a une mission récente.

Cette règle est dans la base, à deux endroits : la table `files`, et les politiques du stockage (`storage.objects`), qui appellent la même fonction `can_read_file()`.

Conséquences testées :
- un collègue de la même organisation ne voit pas les photos de l'agent ;
- **réassigner** une mission retire l'accès immédiatement à l'ancien agent et le donne au nouveau ;
- un agent **désactivé** ne voit plus rien.

L'envoi suit la même logique. `begin_upload()` vérifie les droits et **construit lui-même** le chemin `{organisation}/task/{mission}/{uuid}.jpg`. Le stockage n'accepte un fichier qu'à un chemin réservé ainsi, par la même personne, dans l'heure. Un chemin inventé ou visant une autre organisation est refusé (testé).

L'affichage passe par des URL signées de courte durée (≤ 10 min prévu à l'étape 1.5), créées avec la session de l'agent. Elles sont donc soumises aux mêmes règles.

### Comment les codes d'accès sont protégés
1. **Table à part, sans aucun accès direct**, même pour le owner. Aucune liste, aucun écran, aucun export ne peut lire un code par erreur. Le code ne voyage jamais avec le logement.
2. **Lecture explicite** par la fonction `reveal_access()`, déclenchée par un bouton « Afficher le code » (pas d'affichage automatique).
   - Agent : seulement pour **sa** mission assignée, en cours ou à reprendre, de **12 h avant** le début de la fenêtre à **2 h après** sa fin. Plus rien une fois la mission terminée, annulée ou réassignée.
   - Manager : pour les logements de son organisation.
3. **Chaque consultation est journalisée** (qui, quand, quelle mission), et le journal est visible des managers.
4. Écriture uniquement par `set_property_access()`, qui ne renvoie jamais le code.
5. Le code n'est jamais dans le livret voyageur, ni dans les liens, ni dans les journaux de l'application.

Point à surveiller : les appels de fonction peuvent figurer dans les journaux de la base selon leur configuration. On vérifiera à l'étape 1.2 que les paramètres des requêtes ne sont pas journalisés.

### Hors ligne : ce qui marche sans réseau, la synchronisation, les conflits
**Sans réseau**, avec les missions du jour déjà téléchargées :
- consulter ses missions, adresses, consignes, checklist et photos de référence ;
- démarrer et terminer une mission ;
- cocher la checklist, noter l'état des pièces et commenter ;
- prendre des photos (gardées sur le téléphone jusqu'à l'envoi).
- Code d'accès : uniquement s'il a été affiché alors que le réseau était là, dans la fenêtre autorisée. Il reste alors sur le téléphone **jusqu'à la fin de la fenêtre + 2 h**, puis il est effacé.

**Nécessite le réseau** : afficher un code pour la première fois, recevoir une nouvelle mission, envoyer les photos, toutes les actions manager.

**Synchronisation** :
- chaque action est mise dans une file d'attente sur le téléphone, avec un identifiant unique et l'heure de l'appareil ;
- au retour du réseau, elles sont envoyées **dans l'ordre** : photos, puis rapport, puis fin de mission ;
- les fonctions serveur sont **rejouables** : la même action envoyée deux fois n'a d'effet qu'une fois (testé).

**Conflits** (règles dans la base, testées) :
- **Statut de mission : le serveur a raison.** Si la mission a été terminée, validée, annulée ou réassignée entre-temps, l'action renvoie `conflict:<statut>` ou un refus. Rien n'est écrasé. Le téléphone garde la saisie et prévient l'agent.
- **Rapport** : un seul rédacteur (l'agent assigné). La version la plus récente selon l'heure de l'appareil l'emporte, et une version plus ancienne renvoie `stale`. Le rapport est verrouillé une fois la mission terminée.
- **Heures de pointage** : l'heure de l'appareil est acceptée si elle est plausible (moins de 48 h dans le passé, au plus 5 min dans le futur). Sinon on prend l'heure du serveur.

### Où sont réellement les données

| Fournisseur | Région | Données | Remarques |
|---|---|---|---|
| Supabase (base, connexion, fichiers) | **Paris** (`eu-west-3`, infrastructure AWS), à choisir à la création du projet | Toutes les données métier, comptes (e-mail), photos, sauvegardes quotidiennes | La région ne se change pas après coup. Sauvegardes et journaux sont gérés par Supabase : leur lieu exact est à confirmer dans son contrat de sous-traitance (DPA) |
| Vercel (application) | Fonctions à **Paris** (`cdg1`) après réglage ; **aujourd'hui `iad1` (États-Unis)** | Les requêtes y sont traitées en transit (rien n'y est stocké). Réseau de diffusion mondial pour les fichiers statiques | Journaux d'exécution conservés par Vercel : on n'y écrit **aucune** donnée personnelle ni aucun code. Lieu des journaux à confirmer dans le DPA Vercel |
| Fournisseur SMTP (à choisir, idéalement européen) | — | E-mail du destinataire, lien de connexion | Avant le premier client |
| GitHub | États-Unis | Code source uniquement ; les tests CI utilisent des données fictives | Aucune donnée client |
| Téléphone / navigateur de l'utilisateur | Local | Cache hors ligne du jour : missions, photos en attente, code affiché (effacé à la fin de la fenêtre) | Perte du téléphone : session révocable par le manager (désactivation) |
| Services de cartes (Google, Apple) | Leurs régions | Adresse du logement, envoyée **par le téléphone** quand l'agent appuie sur « Itinéraire » | Hors HALO |

### Risques du lot 1

| Risque | Mesure |
|---|---|
| Politique trop large ajoutée plus tard | Tests d'isolation en CI à chaque modification de `supabase/` ; test de mutation (une politique affaiblie fait bien échouer 15 tests) |
| Le stub local diffère de Supabase | Les mêmes tests sont rejoués sur le vrai projet à l'étape 1.2 avant toute donnée |
| Pas de `force row level security` | Volontaire : les fonctions de contrôle tournent sous le rôle propriétaire. L'application ne se connecte jamais avec ce rôle ; anon et authenticated n'ont aucun contournement possible (testé) |
| Clé `service_role` | Jamais dans le navigateur ni dans le code ; collée par toi dans Vercel ; test au build à l'étape 1.2 |
| Code d'accès gardé sur un téléphone hors ligne | Seulement dans la fenêtre de la mission, effacé ensuite ; journalisé à l'affichage |
| Connexion par e-mail pour des agents sans e-mail | À trancher avant l'étape 1.3 (SMS en option payante, plus tard) |
| Agent qui change l'heure de son téléphone | Heure bornée à 48 h, et heure serveur gardée dans `task_actions.applied_at` |

### Lancer les tests
```bash
DATABASE_URL=postgres://user:mdp@localhost:5432/postgres supabase/tests/run.sh
```
Le script crée une base jetable, applique `supabase/tests/supabase-stub.sql` (reproduction minimale de Supabase) puis les migrations et `supabase/tests/isolation.sql`, et supprime la base. Il ne doit **jamais** viser la production.

## 5. Décisions nécessaires pour l'étape 1.2
1. Tu crées le projet Supabase (région **Paris**, plan Pro) ou tu passes par l'intégration Supabase de Vercel.
2. Tu confirmes le passage des fonctions Vercel en `cdg1`.
3. Connexion des agents : lien par e-mail pour commencer ? (SMS plus tard.)
