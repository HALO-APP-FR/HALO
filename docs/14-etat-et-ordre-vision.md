# HALO — État réel et ordre de travail (vision produit)

Inventaire au 27/10/2026, branche `feat/operations`. La production reste la démo de `main`.

Légende :
- **Terminée** : fonctionne de bout en bout dans la démo, testée.
- **Partielle** : une partie existe ; ce qui manque est indiqué.
- **Maquette** : visible à l'écran, mais sans fonctionnement réel.
- **Absente**.

Point commun à toute la colonne « Terminée » : **les données restent dans le navigateur**. Rien n'est partagé entre appareils tant que la base n'est pas branchée (lot 1, étapes 1.2 à 1.5).

## 1. Flux opérationnel central

| Fonction | État | Détail |
|---|---|---|
| Réservations (saisie, iCal manuel) | Terminée (démo) | La synchronisation iCal automatique côté serveur est absente : elle exige la base |
| Génération des missions depuis les séjours | Terminée | Moteur pur, testé |
| Fenêtre, durée estimée, créneau planifié | Terminée | Affichés séparément partout |
| Temps de déplacement | **Absente** | Prérequis : fournisseur, clé côté serveur, coordonnées des logements (§6) |
| Mission irréalisable avant affectation | Terminée | Fenêtre trop courte, fenêtre passée, plus assez de temps, avec l'explication et les décisions possibles. Le trajet n'est pas encore pris en compte |
| Affectation (manuelle, automatique, glisser-déposer) | Terminée | Pas de modèle d'horaires de travail (limite connue) |
| Kit de linge par mission, prévision de rupture | Terminée (démo) | Coût par rotation : partiel. Migration du linge en base : après le socle |
| Exécution terrain, pointage, checklist, photos | Terminée (démo) | La file hors ligne avec conflits conservés est à faire à l'étape 1.4 |
| Cycle de mission, correction, validation configurable, historique | Terminée (démo + base testée) | — |
| Photos exigées : soumission et validation bloquées sans vraie photo | Terminée (démo + base testée) | — |
| **« Logement prêt pour le prochain voyageur »** | **Terminée (démo), ajoutée aujourd'hui** | Chaque arrivée affiche son état : prêt, ménage à valider, en cours, correction, sans agent, à risque, aucun ménage relié. Seuls les cas à débloquer remontent dans « À traiter » |
| Dossier opérationnel unique avec historique | Partielle | Les missions ont un historique ; les séjours, logements, alertes et prestations en ont un partiel. Dossier unifié par séjour : à faire avec la base |

## 2. Messagerie interne
**Absente.** C'est le principal chantier fonctionnel restant (voir §8).

## 3. Cycle de réalisation et validation
**Terminée** dans la démo, et en base avec ses tests. Les parcours de bout en bout tournent dans des navigateurs isolés, sans toucher aux données de démo partagées.

## 4. Centre de traitement et notifications

| Fonction | État |
|---|---|
| « À traiter » : incidents, prestations, missions à valider, retards ou missions irréalisables, linge, arrivées à débloquer | Terminée (démo) |
| Problèmes d'équipement connecté | Absente (dépend du §7) |
| Boîte de notifications dans l'application, préférences par type, incidents urgents impossibles à désactiver | Terminée (démo, sur un seul appareil) |
| E-mail, push | Absente : il faut le serveur et un fournisseur. Rien n'est simulé |
| Notifications par utilisateur, multi-appareils | Absente : il faut la connexion et la base |

## 5. Liens invités par séjour

| Fonction | État |
|---|---|
| Lien par séjour, haché, expirant au départ, révocable, renouvelable, prolongeable, sans code de porte | Partielle : **en base, testée en local** (35 vérifications). Pas encore vérifiée sur `halo-test`, écrans non branchés |
| Anciens liens permanents (`#d=`) | Signalés « ne pas partager » dans la démo. À la mise en service, ils sont refusés avec « lien remplacé ». Aucun n'a été remis à un vrai voyageur |

## 6. Itinéraires et trajets

| Fonction | État |
|---|---|
| Apple Plans, Google Maps, Waze ; application par défaut ; coordonnées utilisées si présentes ; repli si l'adresse est incomplète | Terminée (vrais appareils à tester) |
| Saisie des coordonnées d'un logement | Absente (prérequis du trajet) |
| Trajet entre missions dans le planning | Absente. Fournisseur à choisir : TomTom ou HERE recommandés, à comparer d'abord sur 50 trajets réels |

## 7. Équipements connectés
**Absente.** Aucune intégration ni aucun écran. Prérequis :
- savoir quels appareils les conciergeries pilotes possèdent réellement (marques et modèles) ;
- accès aux API des fabricants (OAuth, conditions d'utilisation) ;
- serveur pour les commandes et le journal.

## 8. Bilan propriétaire
**Absente.** Il dépend de données réelles accumulées en base : coûts, incidents, temps. La consommation d'énergie dépend du §7. Aucun chiffre ne sera affiché sans méthode ni source.

---

## Dépendances, fournisseurs et coûts

| Besoin | Fournisseur | Coût indicatif | Bloque |
|---|---|---|---|
| Base, connexion, fichiers | Supabase (Paris) | Gratuit en test ; Pro 25 $/mois en production | Tout ce qui est réel ou partagé |
| E-mails (connexion, notifications) | SMTP européen, à choisir | Gratuit à faible volume | Connexion des agents, notifications par e-mail |
| Push | Web Push (VAPID), sans fournisseur payant | 0 € | Notifications push (accord de l'utilisateur, application installée sur iPhone) |
| Messagerie temps réel | Supabase Realtime (inclus) | Inclus dans le plan | Chat avec états « reçu » et « lu » |
| Calcul d'itinéraire | TomTom ou HERE | Quotas gratuits probablement suffisants au début | Trajets dans le planning |
| Équipements | API des fabricants | Variable (parfois sur abonnement) | Pilote d'équipement |
| SMS (option) | À décider | Payé par message | Agents sans e-mail, si cette option est retenue |

## Ordre d'implémentation (inchangé, avec les prérequis)

| # | Étape | Peut avancer maintenant ? | Bloqué par |
|---|---|---|---|
| 1 | Fiabilité du flux (mission, photos, validation, corrections, logement prêt) | ✅ fait dans la démo et en base | Vérification sur `halo-test` |
| 2 | Lien invité par séjour | Base ✅ ; écrans ⏳ | `halo-test` (projet Supabase à créer par toi) |
| 3 | Messagerie contextualisée | **Conception ci-dessous, à valider.** Je peux écrire la base et ses tests en local | Les états « reçu » et « lu » et le multi-appareils exigent `halo-test` et la connexion (étape 1.3) |
| 4 | Trajets dans le planning | Non | Choix du fournisseur et clé |
| 5 | Pilote d'équipement | Non | Liste des appareils réellement présents chez les clients pilotes |
| 6 | Bilan propriétaire | Non | Données réelles accumulées en base |

**Préproduction séparée de la production**

| | Préproduction | Production |
|---|---|---|
| Hébergement | Aperçus Vercel des branches | `main`, qui ne bouge pas sans ton accord |
| Base | Projet `halo-test`, données fictives uniquement | Projet `halo-prod`, créé après validation du lot 1 |
| Tests de bout en bout | Navigateurs isolés, dans des contextes vierges | — |

---

## Messagerie interne : conception proposée (étape 3)

**Ce qui est honnête sans serveur** : rien. Une démo locale ne peut afficher ni « reçu » ni « lu », puisque tout se passe sur le même appareil. Je propose donc d'écrire **d'abord la base et ses tests**. L'interface arrive quand `halo-test` et la connexion existent. Pas de fausse messagerie dans la démo.

**Modèle**
- `threads` :
  - organisation ;
  - contexte : `task`, `property` ou `reservation` (clé composite), ou fil général, plus tard et si le besoin est confirmé ;
  - titre, créateur, date.
- `thread_members` : qui participe. Les managers de l'organisation voient tous les fils ; un agent ne voit que les fils où il est membre, **et** seulement s'il a accès au contexte (sa mission, un logement où il a une mission récente).
- `messages` :
  - fil, auteur, texte, horodatage serveur ;
  - `client_id` (identifiant créé par l'appareil, pour l'envoi hors ligne sans doublon) ;
  - type : message, consigne, demande de précision, blocage ;
  - photo jointe : rattachée à la mission, par le même circuit que les photos de mission.
- `message_receipts` : `delivered_at` (l'appareil du destinataire a reçu le message), `read_at` (le destinataire l'a affiché). Écrits **uniquement** par l'appareil du destinataire, via une fonction.
- États affichés :
  - **en attente d'envoi** : sur le téléphone, pas encore accepté par le serveur ;
  - **envoyé** : enregistré par le serveur ;
  - **reçu** : accusé de l'appareil du destinataire ;
  - **lu** ;
  - pour les blocages et les consignes : **pris en charge** et **résolu**, avec leur auteur.
- **Règle de source de vérité** : une consigne qui modifie le travail (horaire, consigne d'accès, point à ajouter) crée une **instruction versionnée** sur la mission, avec auteur et date. La mission reste la référence ; le message renvoie vers l'instruction.
- **Cloisonnement** : la même suite de tests que le reste. Pour chaque table, dans les deux sens entre organisations, et entre agents d'une même organisation (pas d'accès aux fils des autres), plus les accusés impossibles à falsifier.
- **Notifications** : un message important crée une notification dans l'application qui ouvre la mission concernée. E-mail et push selon leurs prérequis.
- La messagerie interne est distincte des échanges avec les voyageurs et des canaux de réservation.

**Critères de validation de l'étape 3**
1. Le manager envoie une consigne à 2 agents.
2. Chaque appareil d'agent fait passer le message à « reçu », puis « lu ».
3. Un troisième agent ne voit ni le fil ni son existence.
4. Un manager d'une autre organisation ne voit rien.
5. Un message rédigé hors ligne apparaît « en attente », puis « envoyé », sans doublon.
6. Une consigne qui change l'horaire met à jour la mission, et l'historique de la mission le montre.
