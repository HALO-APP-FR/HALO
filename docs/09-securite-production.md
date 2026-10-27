# HALO — Sécurité du livret voyageur et prérequis de mise en production

État au 27/10/2026. Ce document décrit ce que le code fait réellement, pas une cible.

## 1. Livret voyageur : état actuel

| Point | Comportement réel |
|---|---|
| Portée du lien | **Par logement**, pas par séjour. Le jeton (`guide.token`, ~64 bits aléatoires via `crypto.getRandomValues`) est le même pour tous les voyageurs du logement. |
| Durée | **Permanent.** Aucune expiration n'existe. |
| Lien « en ligne » (`/g/<jeton>`) | Lu dans les données locales du navigateur. Révocable sur l'appareil du gestionnaire : « Nouveau lien » change le jeton, « Livret désactivé » coupe l'accès. |
| Lien « autonome » (`/g/<jeton>#d=…`, celui du QR) | Le contenu public est compressé dans le fragment `#` (jamais envoyé au serveur ni journalisé par Vercel). **Non révocable** : un lien/QR déjà diffusé reste lisible après changement de jeton ou désactivation. |
| Secrets | Les **informations d'accès** (`guide.accessInfo` : digicode, boîte à clés…) ne sont **jamais** intégrées au lien autonome (`NEVER_IN_LINK`, testé). Le code d'accès agent (`property.access.code`) n'est jamais montré aux voyageurs. Le Wi-Fi, lui, est intégré. |
| Journaux | Aucun `console.*` dans l'application. La route `/api/ical` ne reçoit et ne journalise jamais le contenu du livret. |

**Conséquence :** en mode démo, un ancien voyageur qui a gardé le QR conserve l'adresse, le Wi-Fi, les règles et les recommandations, mais pas les codes d'accès. Changer le mot de passe Wi-Fi est la seule « révocation » possible du Wi-Fi.

## 2. Cible : liens limités au séjour (nécessite la base de données)

1. Table `guest_links` : `id`, `reservation_id`, `token_hash` (SHA-256, jamais le jeton en clair), `valid_from` (arrivée − 48 h), `valid_until` (départ + 24 h), `revoked_at`, `created_by`.
2. Un lien est créé **par séjour** (à la confirmation de la réservation) ; le lien du logement ne sert plus qu'aux infos génériques sans secret.
3. La page `/g/<jeton>` appelle une fonction serveur (RPC Supabase `security definer`) qui :
   - vérifie le hachage, `revoked_at is null` et `now()` dans `[valid_from, valid_until]` ;
   - renvoie le livret **sans** `access_info` tant que `now() < arrivée − 2 h`, et plus du tout après `valid_until` ;
   - est limitée en débit (anti-énumération).
4. Révocation : `revoked_at = now()` (bouton dans la fiche séjour), effet immédiat car tout passe par le serveur.
5. Supprimer le mode « contenu dans le lien » (`#d=`) dès que le serveur répond, ou le restreindre aux champs non sensibles.
6. Signalements et demandes de prestation du voyageur : insertion via RPC liée au jeton de séjour (pas d'accès direct aux tables), limitée en débit, avec photos dans un bucket privé.

## 3. Ce qui manque avant toute donnée opérationnelle réelle

- **Base de données et comptes** (Supabase prévu, docs/03) : aujourd'hui tout est en `localStorage` + IndexedDB d'un seul navigateur ; aucune sauvegarde, aucun partage entre manager, agents et voyageurs.
- **Authentification réelle** : l'écran de connexion (PIN agent, lien magique) est une maquette ; aucune vérification côté serveur, aucun contrôle de rôle (RLS).
- **Synchronisation iCal automatique** : la récupération et la lecture iCal fonctionnent (route serveur sécurisée : HTTPS seul, pas d'adresses internes, 15 s, 2 Mo), mais la synchro se lance à la main et le résultat reste dans le navigateur. Il faut une tâche planifiée côté serveur.
- **Photos** : stockées en local (IndexedDB) ; non visibles par le manager depuis un autre appareil.
- **Notifications** (agents, voyageurs) : inexistantes.
- **Temps de trajet** : non pris en compte par la répartition automatique (signalé dans l'interface).
- **Région d'hébergement** : Vercel `iad1` (États-Unis) ; à passer en `cdg1` avec la base pour des données européennes (RGPD).
