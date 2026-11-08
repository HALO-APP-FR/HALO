# 17 — Notifications push : fiche d'activation

État : **préparées, non activées**. Aucun push ne part tant que les trois variables ci-dessous ne sont pas définies sur le serveur et que la migration 28 n'est pas appliquée.

## Ce qui déclenche un push

| Événement | Qui |
|---|---|
| Mission assignée ou modifiée | agent |
| Correction demandée | agent |
| Message urgent (ligne « messages » des préférences : seuls les urgents partent en push) | équipe |
| Incident (blocage d'un agent, problème signalé par un voyageur) | responsables |
| Demande voyageur à traiter (prestation, message, demande VIP, réservation directe) | responsables |

Contenu affiché sur l'écran verrouillé : type d'événement et nom du logement. Jamais le nom du voyageur ni le texte d'un message. Toucher la notification ouvre la page HALO concernée.

## Compatibilité

- **iPhone / iPad** : iOS ou iPadOS 16.4 minimum. HALO doit être **installé sur l'écran d'accueil** (Safari → Partager → « Sur l'écran d'accueil ») et ouvert depuis cette icône. Dans Safari seul, c'est impossible ; HALO l'explique à l'écran.
- **Android** : Chrome, Edge, Firefox ou Samsung Internet, installé ou non. Le mode économie d'énergie peut retarder l'affichage.
- **Ordinateur** : Chrome, Edge, Firefox, ou Safari sur macOS 13+, navigateur ouvert.

## Réglages de ton côté (une seule fois)

1. Générer une paire de clés VAPID sur ton ordinateur : `npx web-push generate-vapid-keys`.
2. Dans Vercel → projet HALO → Settings → Environment Variables, environnement **Preview** uniquement :
   - `VAPID_PUBLIC_KEY` = clé publique ;
   - `VAPID_PRIVATE_KEY` = clé privée (**secrète** : jamais dans le dépôt, jamais dans une conversation) ;
   - `VAPID_SUBJECT` = `mailto:` suivi d'une adresse de contact.
3. Appliquer `halo-migration-28.sql` sur la base de préproduction.
4. Redéployer la préproduction.

Coût : **aucun**. Web Push est une norme ouverte ; les services d'Apple, Google et Mozilla sont gratuits. Il ne faut pas de compte développeur Apple ni d'abonnement. Aucun SMS n'est concerné.

## Ce que choisit chaque utilisateur

- **Activer sur cet appareil** (Préférences → Notifications push) : le téléphone demande l'autorisation, et l'appareil est inscrit pour cette personne seulement. Personne ne peut inscrire l'appareil d'un autre.
- **Par événement** : deux cases, « E-mail » et « Push ». Elles sont indépendantes : on peut couper l'e-mail et garder le push. Les urgences critiques restent aussi envoyées par e-mail.
- **Désactiver sur cet appareil** à tout moment. Un appareil expiré est désactivé automatiquement et signalé.

## Comment HALO affiche l'état, sans promesse trompeuse

- **Bandeau d'état** : « Indisponible (migration 28) », « Pas encore activées pour HALO », « Aucun appareil inscrit » ou « Actives sur N appareils ».
- **Cet appareil** : compatible, à installer (iPhone), version trop ancienne, autorisation refusée (avec le chemin des réglages), ou navigateur non compatible.
- **Mes appareils** : pour chacun, le dernier résultat **réel** (« Dernier envoi accepté le… », « Dernier essai en échec le… (raison) », « Expiré »).
- **Essai** : envoi aux seuls appareils de la personne connectée. Le résultat affiché est **« Accepté par le service de notification du téléphone »**, jamais « reçu » : HALO ne peut pas savoir si la notification a été vue (mode Ne pas déranger, Concentration…).
- **Journal technique** (`push_deliveries`) : `accepted`, `failed`, `expired` ou `not_configured`. Un push n'est jamais envoyé deux fois pour la même notification, même si l'e-mail est relancé.

## Niveau de preuve

| Vérifié | Comment |
|---|---|
| Droits : appareil invisible pour les autres comptes ; clés illisibles ; désinscription par le seul propriétaire ; journal non modifiable ; préférences par canal | Tests d'isolation SQL, section 28 |
| États à l'écran, refus d'inscription affiché sans mensonge, préférences push, essai vers un appareil **simulé** affiché « Échec », iPhone non installé | Bout en bout 55 (**simulé**, navigateur de test) |
| Appareil fictif jamais compté « accepté » | Autotest en ligne `push_fake_device_never_accepted` |
| **Réception réelle sur un iPhone et un Android** | **Non vérifiée** : à faire par toi, après les réglages, avec ton propre téléphone et l'essai « Envoyer un essai à mes appareils ». Aucun envoi vers un agent ou un voyageur réel. |
