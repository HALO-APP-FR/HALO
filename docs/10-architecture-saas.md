# HALO — Architecture SaaS multi-organisation (proposition à valider)

Statut : **direction générale validée** (Next.js + Vercel + Postgres, une conciergerie = une organisation, cloisonnement dans la base et le stockage). Le plan d'exécution est **remplacé par `11-plan-saas-lot-1.md`** (socle / fonctions ultérieures / options chiffrées, lot 1 détaillé). Rédigé le 27/10/2026 après inspection du code (commit `51a57c2`).

## 0. État actuel constaté

| Élément | Aujourd'hui |
|---|---|
| Application | Next.js 16 (App Router), React 19, next-intl (6 langues), Tailwind 4 |
| Hébergement | Vercel, projet `halo`, région de fonctions `iad1` (États-Unis), déploiement auto depuis GitHub `HALO-APP-FR/HALO` (`main`) |
| Données | **100 % dans le navigateur** : magasin Zustand persisté en `localStorage` (`halo-demo-v1`, version 3) dans `src/lib/store/halo-store.ts` |
| Photos | IndexedDB du navigateur (`src/lib/store/photos.ts`, `idb-keyval`) |
| Serveur | Une seule route : `POST /api/ical` (téléchargement iCal sécurisé). Aucune autre logique serveur |
| Authentification | **Maquette** (écran de connexion, PIN) : aucune vérification, aucun compte |
| Variables d'environnement Vercel | **Aucune** ; aucune intégration installée |
| Logique métier | Fonctions pures testées (`src/lib/engine/*`, 74 tests) : génération des missions, conflits, linge, apprentissage, fenêtres |
| Conception précédente | `docs/03-modele-donnees.md` décrit déjà un schéma Supabase + RLS, **jamais exécuté** et en retard sur le modèle actuel |

## 1. Choix techniques

**On garde** Next.js, Vercel, next-intl, Tailwind et tout le moteur métier pur (`src/lib/engine`) : rien ne justifie de les remplacer.

**On ajoute Supabase** (PostgreSQL + Auth + Storage), déjà prévu dans docs/03 et la feuille de route. Raisons :
- les règles d'accès sont dans la base (Row Level Security) : elles s'appliquent aussi en cas de bug dans le code de l'application ;
- l'authentification et le stockage des fichiers utilisent la même identité (`auth.uid()`) que la base, donc un seul système de règles ;
- hébergement possible à Paris (`eu-west-3`), sauvegardes gérées, PostgreSQL standard (pas d'enfermement : `pg_dump` fonctionne).

Ce qui est **remplacé** : uniquement la persistance `localStorage` / IndexedDB, par la base et le stockage Supabase. Les écrans continuent d'appeler les mêmes actions (même signature), qui deviennent des Server Actions.

Alternative écartée : base Postgres seule (Neon) + Clerk + S3. Trois fournisseurs, et le cloisonnement des fichiers et de l'auth ne serait pas garanti par la base.

## 2. Modèle multi-organisation

- Une **conciergerie = une organisation** (`organizations`).
- Un **utilisateur** (`auth.users` + `profiles`) peut appartenir à **plusieurs organisations** via `memberships`, avec **un rôle par organisation**.
- L'organisation active est choisie dans l'interface (sélecteur) et mémorisée dans un cookie. Le cookie ne donne **aucun droit** : chaque requête est revérifiée par la base.

### Rôles (par organisation)

| Rôle | Pour qui | Résumé |
|---|---|---|
| `owner` | Dirigeant de la conciergerie | Tout, y compris les rôles, la facturation et la suppression de l'organisation |
| `manager` | Responsable d'exploitation | Toutes les données métier ; gère les agents ; **ne peut pas** nommer d'owner/manager ni modifier un owner |
| `agent` | Personnel terrain (ménage, maintenance, concierge, chauffeur, chef…) | Ses missions, ses prestations, ses signalements ; lecture minimale de ce qui sert à ses missions |

Le **poste** (`position` : ménage, gouvernante, maintenance, linge, concierge, chauffeur, chef) reste une information métier, **pas un droit**.

Les voyageurs n'ont **pas de compte** : ils passent par des fonctions serveur limitées, liées à un jeton de séjour (voir §5).

### Matrice d'accès (L = lire, C = créer, M = modifier, S = supprimer)

| Données | owner | manager | agent |
|---|---|---|---|
| Organisation, paramètres | LCMS | L, M (sauf facturation/suppression) | L (nom, fuseau) |
| Membres, invitations | LCMS | LCMS pour les agents seulement | L (noms, couleurs, postes des collègues) |
| Logements, couchages, checklists, équipements | LCMS | LCMS | L des logements de ses missions |
| Accès logement (codes) | LCMS | LCMS | L **uniquement** pendant ses missions (−24 h / +12 h) |
| Livret voyageur | LCMS | LCMS | — |
| Réservations, calendriers iCal | LCMS | LCMS | L (voyageurs/notes) des séjours liés à ses missions |
| Missions | LCMS | LCMS | L des siennes ; M **par fonctions dédiées** (démarrer, terminer, rapport) |
| Rapports, photos de mission | LCMS | LCMS | LC sur ses missions ; pas de suppression après fin de mission |
| Linge : articles, stock, bons | LCMS | LCMS | L des kits de ses missions |
| Mouvements de linge (journal) | LC | LC | C via fin de mission (fonction serveur) ; **jamais M ni S** pour personne |
| Alertes | LCMS | LCMS | C ; L des siennes |
| Prestations | LCMS | LCMS | L et M (statut « réalisée ») des siennes |

## 3. Schéma de données

Toutes les tables métier ont `organization_id uuid not null`, `created_at`, `updated_at`, `created_by`. Tous les horaires en `timestamptz` (UTC), affichés au fuseau du logement.

**Cloisonnement renforcé par les clés étrangères :** chaque table qui référence une autre table de la même organisation utilise une **clé composite** `(organization_id, xxx_id) → (organization_id, id)`. Ainsi, même avec un identifiant connu, il est **impossible** de rattacher une réservation de l'organisation A à un logement de B : la base refuse l'écriture. (La conception de docs/03 ne le prévoyait pas.)

```
auth.users ─ profiles
organizations ─┬─ memberships (user_id, role, position, color, active)
               ├─ invitations (token haché, rôle, expiration)
               ├─ org_settings (fuseau, devise, blanchisserie, délai)
               ├─ properties ─┬─ property_access (codes, séparés pour un contrôle plus strict)
               │              ├─ beds
               │              ├─ checklist_rooms ─ checklist_items (photo exigée, photos de référence)
               │              ├─ property_amenities (catalogue + libres)
               │              ├─ guest_guides (contenu public du livret, sans codes)
               │              └─ calendar_feeds
               ├─ reservations (adultes, enfants, bébés, animaux, VIP, notes, départ signalé)
               │     └─ guest_links (jeton haché par séjour, valid_from/valid_until, revoked_at)
               ├─ tasks (fenêtre, durée, créneau, statut, pointage, reprise, validation)
               │     ├─ task_reports (cases cochées, état par pièce, commentaires)
               │     └─ files (photos : mission, pièce, alerte, référence)
               ├─ alerts ─ alert_events (historique : prise en charge, intervention, résolution)
               ├─ service_requests
               ├─ linen_types ─ linen_movements (journal immuable, source du stock)
               ├─ laundry_orders ─ laundry_order_lines
               └─ audit_log (qui a fait quoi, pour les actions sensibles)
```

Points clés :
- **Stock de linge** : pas de table de stock modifiable ; une vue calcule le stock à partir de `linen_movements`. Le journal n'a aucune politique UPDATE/DELETE.
- **Fichiers** : une ligne `files` par photo (`organization_id`, entité liée, chemin, auteur), le binaire dans un bucket **privé**.
- **Missions** : les champs modifiables par un agent ne passent que par des fonctions (`start_task`, `finish_task`, `save_task_report`), jamais par un UPDATE direct.

## 4. Règles d'accès (appliquées par la base)

1. **RLS activé sur toutes les tables**, sans exception. Aucun accès anonyme aux tables. (Pas de `force row level security` : voir les risques dans docs/11.)
2. Fonctions d'aide `security definer` avec `search_path` fixé : `has_role(org, roles[])`, `is_member(org)`, `my_task(task_id)`.
3. Chaque politique précise **SELECT, INSERT, UPDATE, DELETE séparément** ; `with check` reprend la condition d'organisation pour qu'aucune ligne ne puisse être « déplacée » vers une autre organisation. Un trigger interdit en plus toute modification de `organization_id`.
4. **Élévation de privilèges bloquée** : les rôles se changent uniquement par une fonction (`set_member_role`) : un manager ne peut ni nommer un owner/manager ni se promouvoir ; on ne peut pas retirer le dernier owner.
5. **Création d'organisation et acceptation d'invitation** : fonctions qui créent organisation + membership owner (ou membership invitée) dans la même transaction.
6. **Côté serveur Next.js** : toutes les lectures et écritures passent par des Server Actions et des routes qui utilisent la **session de l'utilisateur** (clé publique + cookie). La RLS s'applique donc aussi côté serveur. Chaque action revérifie l'organisation active et le rôle avant d'agir (double contrôle).
7. **Clé administrative (`service_role`)** : uniquement dans les variables d'environnement serveur Vercel, **jamais** préfixée `NEXT_PUBLIC_`, jamais envoyée au navigateur, utilisée seulement pour les tâches planifiées (synchro iCal) et l'administration. Un test de build vérifie qu'elle n'apparaît dans aucun fichier envoyé au navigateur.
8. **Fichiers (Storage)** : bucket privé `org-files`, chemin `{organization_id}/{type}/{id}/{uuid}.jpg`. Les politiques `storage.objects` vérifient que le premier segment du chemin est une organisation dont l'utilisateur est membre (et, pour un agent, que la mission est la sienne). Lecture uniquement par **URL signée de courte durée** (≤ 1 h).
9. **Voyageurs** : aucune lecture directe des tables. Fonctions `get_guest_guide(token)`, `report_issue(token, …)`, `request_service(token, …)` qui vérifient le jeton haché, la période de validité du séjour et `revoked_at`, renvoient uniquement les champs publics, et sont limitées en débit. Les codes d'accès ne sont renvoyés que pendant le séjour, si la conciergerie l'a choisi.

## 5. Sauvegardes

**Base de données**
- Plan Supabase **Pro** minimum : sauvegarde quotidienne automatique (7 jours de rétention).
- **Point-in-Time Recovery** (option payante) recommandé dès les premiers clients réels : restauration à la minute près.
- **Copie hors Supabase** : `pg_dump` chiffré chaque nuit (GitHub Actions planifié) vers un stockage S3 compatible en Europe, avec versionnage et rétention 30 jours. Protège contre une perte du compte ou du projet.

**Fichiers**
- Les sauvegardes de base Supabase **n'incluent pas les fichiers du Storage**. Il faut une copie nocturne du bucket vers un second stockage européen versionné (même tâche planifiée).

**Vérification**
- Test de restauration **trimestriel** dans un projet séparé, avec procédure écrite (temps de restauration mesuré).

## 6. Plan de migration depuis la démo locale

Étapes, chacune livrée, testée et déployée séparément :

1. **Fondations base (sans toucher à l'interface)** : migration SQL versionnée `supabase/migrations/`, politiques RLS, Storage, fonctions. **Suite de tests d'isolation** exécutée sur un PostgreSQL local et en CI : deux organisations, un owner, un manager et un agent dans chacune, un utilisateur membre des deux. Pour chaque table, on vérifie que lecture, création, modification et suppression croisées sont **refusées**, ainsi que les déplacements d'organisation et les élévations de rôle.
2. **Projet Supabase** (Paris) + variables d'environnement Vercel + région Vercel `cdg1`.
3. **Connexion réelle** : managers par lien e-mail ; agents par code SMS une première fois, puis le PIN ne fait que **déverrouiller** la session enregistrée sur le téléphone ; sélecteur d'organisation.
4. **Couche de données** : les actions du magasin deviennent des Server Actions Supabase, domaine par domaine (logements → séjours et missions → linge → alertes et prestations → équipe et paramètres). Le moteur métier pur est conservé et réutilisé côté serveur.
5. **Photos** vers le Storage privé.
6. **Voyageurs** : liens par séjour, fonctions publiques limitées ; suppression du livret intégré au lien (`#d=`).
7. **Synchro iCal automatique** côté serveur (tâche planifiée).
8. **Import de la démo** (facultatif) : export JSON depuis le navigateur, import par une fonction serveur qui valide tout et réattribue les identifiants. La démo locale reste disponible, séparée, pour les présentations.
9. **Sauvegardes** mises en place et **premier test de restauration** avant tout client réel.

## 7. Risques à connaître avant de commencer

| Risque | Conséquence | Mesure |
|---|---|---|
| Politique RLS oubliée ou trop large | Fuite entre conciergeries | RLS forcé partout + tests d'isolation automatiques table par table en CI ; aucun déploiement si un test échoue |
| Référence croisée (réservation A → logement B) | Mélange de données | Clés étrangères composites incluant `organization_id` |
| Agent qui modifie une mission (assignation, fenêtre, organisation) | Fraude, incohérence | Pas d'UPDATE direct pour les agents : fonctions dédiées |
| Manager qui se promeut owner | Prise de contrôle | Rôles modifiables seulement par fonction contrôlée |
| Clé `service_role` exposée | Contournement total de la RLS | Serveur uniquement, test anti-fuite au build, rotation documentée |
| Fichiers non cloisonnés | Photos visibles par d'autres | Bucket privé, politiques par chemin, URLs signées courtes |
| Connexion des agents par PIN | Un PIN à 6 chiffres seul est trop faible comme authentification | Première connexion par SMS ; le PIN ne fait que déverrouiller l'appareil ; verrouillage après échecs |
| Coût et délai des SMS | Dépendance à un fournisseur (Twilio…) | À valider ; alternative : lien de connexion par e-mail |
| Sauvegardes sans les fichiers | Photos perdues | Copie séparée du bucket |
| Région États-Unis actuelle | Données personnelles hors UE | Supabase Paris + Vercel `cdg1` |
| Migration du magasin local | Régressions sur des écrans qui marchent | Migration domaine par domaine, tests e2e à chaque étape, démo locale conservée |
| Données de démo importées | Fausses données dans une vraie organisation | Import réservé à une organisation de test |

## 8. Décisions nécessaires avant l'étape 2

1. Création du projet Supabase : par toi (supabase.com, région **Paris**), ou via l'intégration Supabase de Vercel. Dans les deux cas, la clé `service_role` doit être collée **directement dans Vercel**, jamais dans la conversation.
2. Plan Supabase (Pro recommandé pour les sauvegardes) et option PITR.
3. Connexion des agents : SMS (coût par message) ou lien e-mail.
4. Stockage de sauvegarde hors Supabase (fournisseur S3 européen).
