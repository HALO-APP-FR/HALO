# HALO — Révision du plan avant l'étape 1.2

Statut au 27/10/2026 : **proposition à valider**. Aucun projet Supabase n'est créé. Aucun réglage Vercel n'a été modifié. Rien n'est déployé en production, aucune vraie donnée.

Ce document corrige `11-plan-saas-lot-1.md`. Quand ils divergent, c'est celui-ci qui fait foi.

## Résumé des changements de plan

| # | Avant | Maintenant |
|---|---|---|
| 1 | Liens voyageurs prévus « après le socle » | **Lien invité par séjour, expirant et révocable, obligatoire avant de remettre le livret à un seul vrai voyageur.** Il devient l'étape 1.6 |
| 2 | Code d'accès gardé sur le téléphone hors ligne jusqu'à la fin de la fenêtre | **Consultation en ligne uniquement**, jamais stockée sur le téléphone |
| 3 | Rapport hors ligne : « la version la plus récente gagne » | **Aucune saisie écrasée en silence** : les conflits sont conservés, montrés et résolus par une personne |
| 4 | Tests rejoués « sur le vrai projet » | **Projet de test dédié** `halo-test`, distinct de la future production. Liste exacte des vérifications ci-dessous |
| 5 | Création du projet Supabase non attribuée | **Tu crées le projet sur ton compte, à Paris.** Les clés ne transitent jamais par la conversation |
| 6 | « Région Vercel `cdg1` » | Réglages précis pour la production et pour les déploiements de test, avec leur vérification |
| 7 | E-mail ou SMS à décider | **Lien par e-mail individuel.** Ni compte partagé, ni PIN seul. Cas des agents sans e-mail traité à part |

---

## 1. Lien invité par séjour (étape 1.6, obligatoire avant tout vrai voyageur)

**Ce que c'est** : un lien vers le livret **d'un séjour**. Il est valable jusqu'à l'heure de départ prévue et révocable à tout moment par un responsable.

**Ce que ce n'est pas** : ce lien ne commande aucune serrure et ne change aucun code de porte. L'interface ne le présentera jamais comme une désactivation d'accès physique. Le lien ne révèle aucun code d'accès : la table des codes reste fermée.

**Conception**
- Table `guest_links` :
  - `organization_id` ;
  - `reservation_id` (clé composite, donc lié à un séjour de la même organisation) ;
  - `token_hash` (jeton de 32 octets aléatoires, seul son haché est stocké) ;
  - `valid_from` et `valid_until` (par défaut l'arrivée et le départ du séjour, en UTC) ;
  - `revoked_at`, `revoked_by`, `created_by`.
- Une seule porte d'entrée publique : la fonction `get_guest_stay(token)`.
  - Elle vérifie le haché, la période et la révocation.
  - Elle renvoie uniquement les champs publics du livret de **ce** séjour.
  - Jeton absent, faux, expiré ou révoqué : **même réponse neutre**, qui ne dit pas si le séjour existe.
- Le lien reste réutilisable pendant le séjour : il ne s'invalide pas à la première ouverture.
- Les responsables peuvent :
  - **révoquer** le lien (effet immédiat) ;
  - **prolonger** sa validité en cas de départ tardif (tracé) ;
  - **en générer un nouveau**, ce qui révoque l'ancien.
- Statut affiché : actif, à venir, expiré ou révoqué.
- Le livret actuel de la démo (lien `#d=`, non révocable) **ne doit pas être remis à de vrais voyageurs**. Il sera remplacé.
- Le nombre de requêtes sera limité, et vérifié en conditions réelles à l'étape 1.6.

## 2. Codes d'accès : en ligne uniquement (version 1)

- `reveal_access()` reste la seule façon de lire un code. Elle exige le réseau, c'est-à-dire une requête authentifiée.
- Le code n'est **jamais** écrit sur le téléphone :
  - ni dans le stockage du navigateur (localStorage, IndexedDB) ;
  - ni dans le cache hors ligne ;
  - ni dans la file d'attente.
- La réponse du serveur porte `Cache-Control: no-store`.
- Le code est gardé en mémoire tant que l'écran est ouvert. Il est **masqué automatiquement après 60 secondes** et quand l'agent quitte l'écran.
- Sans réseau, l'écran le dit (« Code disponible uniquement en ligne ») et propose d'**appeler le responsable**. Le responsable consulte le code de son côté, et sa consultation est journalisée.
- À réexaminer seulement quand une protection des données sur le téléphone sera définie et vérifiée (chiffrement lié à l'appareil, effacement à distance).
- Test automatique prévu : après consultation d'un code, aucune trace du code dans le stockage du navigateur ni dans le cache hors ligne.

## 3. Rapports hors ligne : aucune saisie écrasée en silence

**Principe** : le téléphone n'envoie pas un rapport entier. Il envoie des **opérations** élémentaires. Chacune porte :
- un identifiant unique ;
- l'heure de l'appareil ;
- la **version de départ** du champ concerné.

| Type de saisie | Règle |
|---|---|
| Photos | Toujours ajoutées, jamais en conflit |
| Commentaires | **Ajoutés à la suite** (historique daté), jamais remplacés |
| Case cochée ou décochée, état d'une pièce | Appliqué si personne n'a modifié ce champ depuis la version de départ. Sinon : **conflit** |
| Démarrer / terminer | Le statut connu du serveur fait foi. Une action refusée est **conservée** avec son contenu, pas jetée |

**En cas de conflit**
1. Le serveur garde **les deux valeurs** dans `task_report_conflicts` : valeur actuelle, valeur reçue, qui, quand, depuis quel appareil. Il n'applique pas la valeur reçue.
2. L'agent voit sur le point concerné : « Deux saisies différentes : *Salle de bain : RAS* (14:02, ce téléphone) / *Salle de bain : dégât* (13:55, autre appareil). Laquelle garder ? »
3. La mission ne peut pas être soumise tant qu'un conflit reste ouvert. Le responsable voit un badge « Conflit à résoudre » dans le rapport.
4. La résolution, par l'agent ou par le responsable, est tracée. La valeur écartée reste consultable dans l'historique.

**Action refusée** (mission annulée, réassignée ou déjà validée entre-temps)
- Le contenu est conservé côté serveur dans `task_actions` (statut `rejected`, avec son contenu).
- Le téléphone affiche : « Cette saisie n'a pas pu être appliquée : mission réassignée. Votre responsable la voit. »
- Le responsable la retrouve dans la fiche de la mission.

**À corriger dans la base** : la fonction actuelle `save_task_report` applique « le plus récent gagne » (réponse `stale`). Elle sera remplacée à l'étape 1.4 par `apply_report_ops()`, accompagnée des tables `task_report_conflicts` et de l'historique des commentaires, et de leurs tests d'isolation.

## 4. Étape 1.2 : projet de test et vérifications exactes

### Environnements

| | Test (étape 1.2) | Production (plus tard) |
|---|---|---|
| Projet Supabase | `halo-test`, Paris, données **fictives uniquement** | `halo-prod`, Paris, Pro, créé **seulement** après validation du lot 1 |
| Déploiements Vercel | Aperçus de branches (Preview), protégés par connexion Vercel | Production, inchangée tant que le lot 1 n'est pas validé |
| Variables Vercel | Uniquement dans l'environnement **Preview** | **Aucune** variable Supabase tant que la production n'est pas décidée |

### Comment les tests tournent sur le vrai Supabase, sans clé dans la conversation
- Tu ajoutes toi-même, dans GitHub (Settings → Secrets → Actions), un secret `SUPABASE_TEST_DB_URL` : la chaîne de connexion du projet de test.
- Un workflow à **déclenchement manuel** (`Isolation — projet de test`) :
  1. applique les migrations sur `halo-test` ;
  2. exécute les trois suites ci-dessous ;
  3. publie le rapport ;
  4. nettoie les données fictives.
- Il refuse de s'exécuter si l'adresse ne correspond pas au projet de test déclaré (garde anti-production).

### Suite A — base de données (la même que la CI, sans la reproduction locale de Supabase)
Elle utilise les vrais `auth.uid()`, rôles `anon` / `authenticated`, schéma `storage` et privilèges par défaut de Supabase.
- **RLS** activée sur chaque table ; bucket `org-files` privé ; `anon` sans aucun droit sur les tables ; aucune fonction exécutable par `anon`, **sauf `get_guest_stay`** (étape 1.6) ; fonctions privilégiées avec `search_path` fixé.
- **Pour chaque table métier, dans les deux sens** (owner, manager, agent et personne extérieure de A contre B, et l'inverse, plus anonyme) : lecture, création, modification et suppression croisées refusées.
- Clés composites :
  - un séjour de A ne peut pas pointer vers un logement de B ;
  - une mission de A ne peut pas être assignée à un agent de B, ni liée à un séjour de B ;
  - un point de checklist de A ne peut pas être rangé dans une pièce de B.
- `organization_id` ne peut pas être modifié.
- **Agent** :
  - il ne voit que ses missions et ce qui leur sert ;
  - il n'a aucune écriture directe ;
  - il ne peut ni valider ni demander de correction ;
  - la réassignation ou la désactivation lui retire l'accès immédiatement.
- **Codes** :
  - aucune lecture directe, même par le owner ;
  - un agent ne lit que le code de **sa** mission, dans la fenêtre prévue ;
  - chaque consultation est journalisée.
- **Fichiers** :
  - un agent ne voit que les photos de ses missions et les photos de référence de ses logements ;
  - un fichier ne peut être déposé qu'à un emplacement réservé par la base ;
  - un fichier ne peut pas être déposé dans une autre organisation.
- **Rôles** : aucune élévation de rôle ; dernier owner protégé ; invitations à usage unique, expirantes, jamais stockées en clair.
- **Cycle de mission** : photos obligatoires, correction motivée, historique et auteurs, validation automatique selon le réglage.

### Suite B — par l'API réelle, comme le ferait l'application
Elle utilise de vrais comptes de test, de vrais jetons de session, la clé publique, l'API REST, les fonctions et le Storage.
- Les mêmes refus croisés, vus à travers PostgREST (et pas seulement en SQL).
- **Storage** :
  - téléchargement direct d'un fichier de B refusé avec une session de A ;
  - URL signée créée par A pour son fichier : accessible pendant sa durée, refusée ensuite ;
  - A ne peut pas créer d'URL signée pour un fichier de B ;
  - aucun accès sans session.
- **Sans session (`anon`)** : aucune table lisible, aucune fonction appelable sauf l'exception invité.
- **Exceptions d'accès prévues pour les liens invités** (étape 1.6, testées dès qu'elles existent) :
  1. `anon` peut appeler `get_guest_stay(token)`, et **rien d'autre** : aucune lecture de `guest_links`, des séjours ou des logements.
  2. Jeton valide pendant le séjour : contenu public de **ce** séjour seulement. Jamais de code d'accès, jamais de données d'un autre séjour, même de la même organisation.
  3. Jeton avant `valid_from`, après `valid_until`, révoqué, faux ou vide : même réponse neutre.
  4. Le lien reste lisible plusieurs fois pendant la période.
  5. Révocation et prolongation réservées aux responsables de l'organisation du séjour. Un responsable de B ne peut ni révoquer, ni prolonger, ni créer un lien pour un séjour de A.
  6. Le jeton n'est stocké que sous forme hachée.
- **Clé secrète** : vérification que la construction de l'application ne contient ni la clé `service_role` / secrète, ni la chaîne de connexion à la base, dans aucun fichier envoyé au navigateur.

### Suite C — réglages du projet
- Région du projet : `eu-west-3` (Paris).
- Inscription libre désactivée : on n'entre que sur invitation.
- Adresses de redirection : seulement celles prévues pour les déploiements de test et pour le poste de développement.
- Durée du lien de connexion et limites d'envoi relevées dans le rapport.

## 5. Création du projet Supabase par toi (aucune clé dans la conversation)
1. supabase.com → ton organisation → **New project** : nom `halo-test`, région **West EU (Paris)**, mot de passe de base fort, gardé dans ton gestionnaire de mots de passe. Le plan gratuit suffit pour le test : le projet se met en pause après une période d'inactivité.
2. **Authentication → Sign In / Providers** :
   - Email activé ;
   - « Allow new users to sign up » **désactivé** ;
   - confirmation par e-mail activée.
3. **Authentication → URL Configuration** :
   - Site URL : l'adresse d'aperçu Vercel que je t'indiquerai ;
   - Redirect URLs : `http://localhost:3000/**` et l'adresse des aperçus de branche.
4. **Authentication → Emails** : je te fournirai le modèle d'e-mail, qui contient le lien **et** un code à 6 chiffres (voir §7). Pour le test, l'envoi intégré de Supabase suffit (débit très limité). Un fournisseur SMTP est nécessaire avant la production.
5. **Clés**
   - Clé publique (`anon` / *publishable*) et URL : à coller **par toi** dans Vercel, environnement **Preview** uniquement.
   - Clé secrète (`service_role` / *secret*) : collée par toi dans Vercel, environnement **Preview** uniquement, marquée *Sensitive*. Elle ne servira qu'aux tâches serveur ; les tests de la suite B l'utilisent seulement pour créer et supprimer les comptes fictifs.
   - Chaîne de connexion à la base : à coller **par toi** dans le secret GitHub `SUPABASE_TEST_DB_URL`.
   - Tu me dis seulement « c'est fait ». Je vérifie la présence des variables sans jamais lire leur valeur.
6. Je n'applique rien au projet sans ton feu vert. Les migrations passent par le workflow manuel.

## 6. Vercel : région Paris et réglages des déploiements

**Constaté le 27/10/2026** sur le projet `halo` :
- les fonctions tournent en `iad1` (États-Unis) ;
- aucune protection : les aperçus de branche sont **publics** ;
- aucune variable d'environnement ;
- production = démo actuelle.

**Changements proposés**

| Réglage | Production | Preview (test) | Comment |
|---|---|---|---|
| Région des fonctions | `cdg1` Paris | `cdg1` Paris | Fichier `vercel.json` (`"regions": ["cdg1"]`), versionné, plus le réglage du projet (Settings → Functions → Region) mis à Paris pour cohérence |
| Protection d'accès | Inchangée (démo publique, sans données réelles) | **Vercel Authentication activée** : seuls les membres de ton équipe Vercel ouvrent les aperçus | Settings → Deployment Protection → Standard Protection |
| Variables Supabase | **Aucune** | Clés de `halo-test` uniquement | Collées par toi |
| Branche de production | `main`, non modifiée sans ton accord | Branches `feat/*` | Rien n'est fusionné dans `main` sans ta validation |

**Vérifications après le changement**
- Une requête sur une fonction serveur de l'aperçu doit indiquer `cdg1` dans l'en-tête `x-vercel-id`.
- Le détail du déploiement dans Vercel doit indiquer la région Paris.
- Un aperçu ouvert sans être connecté à Vercel doit être refusé.
- La production doit garder la même adresse et la même démo, sans aucune variable Supabase.
- Le passage de la région en production se fera **au moment de la fusion validée**. Le `vercel.json` sur la branche ne touche que les aperçus.

Remarque : ce qui s'exécute dans le *proxy* Next.js (choix de langue) ne lit ni n'écrit aucune donnée. Les données ne sont traitées que dans les fonctions en région Paris.

## 7. Connexion : lien e-mail individuel

- **Une adresse e-mail par personne**, managers comme agents, sur invitation uniquement.
- L'e-mail contient un **lien** et un **code à 6 chiffres**. Sur téléphone, le lien s'ouvre souvent dans un autre navigateur que l'application installée ; le code permet de se connecter là où l'on est.
- **Interdits** : compte partagé, identifiants communs, PIN seul comme authentification. Le PIN reste au plus un **déverrouillage local** d'une session déjà ouverte par lien e-mail. Ce n'est pas prévu en version 1.
- Sessions révocables : désactiver un membre coupe ses accès à la requête suivante (testé).

**Agents sans adresse e-mail individuelle : un autre mode est nécessaire.** Options, à décider selon leur nombre :

| Option | Pour | Contre |
|---|---|---|
| Créer une adresse par agent (par ex. sur le domaine de la conciergerie) | Aucun développement, même sécurité | Gestion des boîtes par la conciergerie |
| Code par SMS (connexion par téléphone de Supabase) | Simple pour l'agent | Coût par SMS, fournisseur à choisir, consentement : décision séparée |
| Lien d'activation à usage unique remis en personne par le responsable (QR affiché sur son écran, valable quelques minutes, lié à un seul compte) | Pas de SMS, identité individuelle | Le responsable doit être présent ; à développer et tester |

Question à poser à la conciergerie pilote : combien d'agents n'ont pas d'adresse e-mail personnelle ?

## 8. Ordre révisé du lot 1

| Étape | Contenu |
|---|---|
| 1.1 ✅ | Schéma, RLS, tests (900 vérifications) |
| 1.2 | Projet `halo-test` (toi), réglages Vercel (Paris, aperçus protégés), workflow manuel, suites A, B et C sur le vrai Supabase |
| 1.3 | Connexion par lien et code e-mail, invitations, sélecteur d'organisation, redirection serveur selon l'espace |
| 1.4 | Logements, séjours, missions en base ; opérations de rapport et conflits (§3) |
| 1.5 | Photos privées, URL signées, file d'attente hors ligne (sans codes) |
| 1.6 | **Liens invités par séjour** (§1) : condition pour remettre le livret à un voyageur |

**Règle inchangée** : aucune vraie donnée avant la fin de 1.5 vérifiée. Aucun livret remis à un vrai voyageur avant la fin de 1.6.

## 9. Ce dont j'ai besoin pour démarrer l'étape 1.2
1. Ta validation de ce document.
2. Ton accord pour : ajouter `vercel.json` (Paris) sur la branche ; activer la protection des aperçus ; mettre le réglage de région du projet sur Paris. La production reste inchangée jusqu'à la fusion.
3. Le projet `halo-test` créé de ton côté (§5), puis « c'est fait ».

---

## 10. Suite aux retours sur la préversion (27/10/2026, soir)

| # | Point | Fait | Critère vérifié | Reste |
|---|---|---|---|---|
| 1 | Lien voyageur par séjour | Migration `20261029000001_liens_invites.sql` : tables `guest_guides` et `guest_links`, fonctions `create_guest_link`, `revoke_guest_link`, `extend_guest_link`, `get_guest_stay`. Révocation automatique si le séjour est annulé. Avertissement rouge « ne pas partager » sur le livret de démo | 35 vérifications en base locale : valable pendant le séjour et réutilisable ; à venir, expiré, révoqué, faux ou vide donnent la même réponse neutre ; contenu de ce séjour seulement ; aucun code ; renouveler révoque l'ancien lien ; prolongation plafonnée ; aucun droit croisé ; `anon` n'a que `get_guest_stay` | **Non prêt** tant que ce n'est pas vérifié sur `halo-test`. Écrans manager (statut, révoquer, renouveler, prolonger) et page voyageur branchés à la base : étape 1.6 |
| 1b | Anciens liens permanents (`/g/…#d=`) | Politique arrêtée : à la mise en service, la page voyageur **ignore le contenu intégré au lien** et affiche « Ce lien a été remplacé : demandez le lien de votre séjour à votre conciergerie ». Aucune migration de ces liens, ils n'ont jamais été remis à de vrais voyageurs | — | À coder avec l'étape 1.6 |
| 2 | Photos obligatoires | Cause : donnée de démo créée « terminée » **sans rapport**. Corrigé : les missions terminées de la démo ont un rapport complet avec des photos marquées « DEMO ». **Faille réelle corrigée dans la base** : une simple réservation d'emplacement suffisait ; il faut désormais le fichier déposé. **La validation est refusée** si une preuve manque (démo et base) | Test isolé dans un navigateur vierge (ordinateur et iPhone) : bouton bloqué, les 3 photos manquantes nommées (pièce et point), cocher ne suffit pas, 3 vraies photos nécessaires, le manager voit « 3/3 reçues » avec les vignettes. Base : réservé sans dépôt = refusé ; validation sans preuve = `missing_photos` | — |
| 3 | Correction Manager → Agent | — | Test isolé de bout en bout (ordinateur et iPhone) : motif obligatoire ; notification chez le bon agent avec la mention « Dans l'application uniquement » ; motif visible ; reprise ; nouvelle soumission ; le manager voit le nouveau rapport, le compte rendu n° 1 conservé et l'historique complet ; validation | — |
| 4 | Temps de trajet | — | — | **Pas dans le prochain lot.** Prérequis : choix du fournisseur et clé côté serveur, coordonnées des logements. Plan : durée estimée entre deux missions avec une marge, alerte « planning irréalisable », jamais présentée comme de l'IA, aucune position suivie |
| 5 | Fiche prestation | S'ouvre en lecture. « Modifier les détails » est explicite et ne change jamais le statut. Accepter, Demander des précisions et Refuser sont trois actions séparées | Test : aucun champ ni « Enregistrer » en lecture ; les trois décisions sont visibles ; l'édition s'annule | — |
| — | Mobile | Défaut trouvé et corrigé : un sélecteur d'onglets élargissait la page sur téléphone, et la feuille de détail débordait de l'écran | 13 écrans vérifiés en largeur iPhone, sans débordement horizontal ; bandeau Démo présent | Tests sur de vrais appareils |

Tests au 27/10/2026 : 1 040 vérifications en base (0 échec), 92 tests unitaires, 14 parcours navigateur (ordinateur et iPhone).
