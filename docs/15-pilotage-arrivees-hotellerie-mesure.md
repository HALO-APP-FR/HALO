# HALO — Pilotage des arrivées, étude hôtellerie, socle de mesure

Statut au 28/10/2026. Branche `feat/operations`. Production inchangée.

## 1. Classement des points du brief

Légende : **Opérationnel** (dans la démo, sur un seul appareil) · **Partiel** · **Maquette** · **Absent**.

Rappel : rien n'est partagé entre appareils tant que la base n'est pas branchée (lot 1, étapes 1.2 à 1.5).

| § | Point | État | Ce qui manque |
|---|---|---|---|
| 2 | Anticiper : arrivée à risque, mission absente, sans agent ou irréalisable, retard, validation, linge, prestation, incident | **Opérationnel** (nouveau poste « Arrivées ») | Trajet (§9) et équipements (§10) ; le linge est évalué sur le stock central (pas de stock par logement) |
| 2 | Signal = cause, séjour, délai restant, impact | **Opérationnel** | — |
| 2 | Coordonner (espaces par rôle, consignes) | Partiel | Comptes réels (étape 1.3), messagerie (§5) |
| 2 | Résoudre : responsable, prochaine action, suivi, confirmation | **Opérationnel** pour les missions (validation, preuves) et les incidents (note de résolution obligatoire) | Confirmation venant d'appareils réels : il faut la base |
| 3 | Même dossier opérationnel, sans ressaisie | Partiel | Historique unifié par séjour : il faut la base |
| 4 | « Arrivées à débloquer » actionnable | **Opérationnel** (voir §2 ci-dessous) | — |
| 5 | Messagerie interne | **Absent** | Conception prête (`docs/14`). Il faut des comptes et une base partagée pour « reçu » et « lu » |
| 6 | Cycle de mission, preuves, validation | **Opérationnel** (démo + base testée) | Les anciennes missions de démo terminées sans contrôles venaient **des données de démo, pas des règles** ; elles ont été corrigées le 27/10 |
| 7 | Centre de traitement, notifications | Opérationnel dans l'application | E-mail, push, SMS : non simulés, dépendent du serveur et d'un fournisseur ; équipements : absent |
| 8 | Lien invité par séjour | Partiel : en base et testé en local | À vérifier sur `halo-test`, écrans à brancher. Anciens liens refusés avec « lien remplacé » |
| 9 | Itinéraires | Opérationnel | Vrais appareils à tester |
| 9 | Trajet dans le planning | **Absent** | Choix du fournisseur et clé, coordonnées des logements |
| 10 | Équipements connectés | **Absent** | Inventaire des appareils réellement présents chez les clients pilotes |
| 11 | Hôtellerie | **Étude seulement** (§3) | Validation commerciale avec des établissements pilotes |
| 12 | Mesure de la promesse | **Absent** (socle proposé au §4) | Données réelles en base, plus une situation de référence |

## 2. « Arrivées » : poste de pilotage

**Fichiers**
- `src/lib/engine/arrival-control.ts` : règles pures, 8 tests ;
- `src/components/views/arrivals.tsx`, route `/arrivals`, entrée « Arrivées » dans le menu ;
- `manager-today.tsx` : ligne « À traiter » et carte « Arrivées » ;
- `stays-sheet.tsx` : badge d'état sur les arrivées ;
- `halo-store.ts` : action `createCleaningForStay`.

Le calcul provisoire de la veille, `readiness.ts`, est supprimé : **une seule logique** sert partout.

**Par arrivée**
- heure d'arrivée (fuseau du logement) et temps restant (ou dépassement) ;
- état ;
- chaque blocage avec sa cause, l'objet concerné (ménage, incident, prestation, linge), **qui agit**, et un bouton qui ouvre directement la bonne fiche.

| État | Règle |
|---|---|
| **Bloquée** | Ne sera pas prête sans action d'un responsable : aucun ménage relié, ménage sans agent, ménage irréalisable ou en retard, incident urgent ouvert, heure d'arrivée passée alors que le logement n'est pas prêt |
| **À surveiller** | En bonne voie mais un point demande un œil : ménage terminé à valider, correction en cours, créneau commencé sans démarrage (plus de 15 min), rupture de linge prévue ce jour, prestation en attente, incident non urgent |
| **En préparation** | Ménage planifié et faisable, ou en cours, sans autre point |
| **Prête** | Ménage **validé** et **aucun** point ouvert |

**Compteurs** : une arrivée a un seul état (le plus grave) et n'est comptée qu'une fois, même avec plusieurs blocages. Le filtre « À débloquer ou surveiller » affiche exactement les arrivées « Bloquée » et « À surveiller ».

**Actions directes**

| Bouton | Ce qu'il fait |
|---|---|
| Attribuer | Fiche mission, liste des agents avec leur charge |
| Valider ou corriger | Fiche mission, avec les preuves |
| Ouvrir la mission | Fiche mission |
| Créer le ménage | Crée un ménage relié au séjour, de la fin du séjour précédent jusqu'à l'arrivée, sans doublon, puis ouvre sa fiche pour l'attribuer |
| Traiter l'incident | Fiche de l'incident |
| Traiter la demande | Fiche de la prestation |
| Voir le linge | Écran Linge |

**Vérifications**
- 8 tests des règles, plus un test de la création de ménage dans le magasin de données.
- 3 parcours dans un navigateur vierge, sur ordinateur et iPhone :
  - compteurs égaux au nombre de lignes de chaque état ;
  - chaque arrivée non prête montre sa cause et qui agit ;
  - valider un ménage depuis l'arrivée fait disparaître le blocage ;
  - attribuer un ménage sans agent depuis l'arrivée fait disparaître le blocage, et la mission passe à « À faire » avec l'agent.
- 13 écrans vérifiés en largeur iPhone, sans débordement.

**Limites**
- Démo sur un seul appareil.
- Le linge est évalué sur le stock central : une rupture ce jour-là est signalée sur toutes les arrivées du jour, sans préciser le logement.
- « Qui agit » pour un incident est encore un nom saisi : les comptes réels viendront à l'étape 1.3.
- Le trajet n'est pas pris en compte (§9).

## 3. Extension hôtellerie : étude (pas de développement)

**Cibles** : appart'hôtels, résidences de tourisme, petits hôtels indépendants à fort renouvellement.

**Modèle de données nécessaire**, extension du modèle actuel sans le casser :
```
organization ─ establishment (adresse, fuseau, réception, horaires)
                 ├─ room_type (lits, linge type, durée de ménage par type de service)
                 ├─ room (numéro, étage, type, statut : propre / sale / à inspecter / hors service)
                 └─ stay (chambre, dates, voyageurs, source PMS) ─ task (départ, recouche, inspection, maintenance)
```
- Un logement de conciergerie correspond à un « établissement d'une chambre ». La mission reste la même entité.
- Nouveaux types de mission : **recouche** (ménage pendant le séjour), **inspection de chambre**, **ouverture de couverture**.

**Différences de processus**
- Volumes par jour et par étage, plutôt que par adresse.
- Gouvernante qui inspecte et libère les chambres.
- **Statut de chambre** synchronisé avec la réception.
- Recouches quotidiennes ou à la demande ; préférences « ne pas déranger ».
- Linge en volume, avec des chariots par étage.
- Échanges en direct avec la réception : chambre prête, arrivée anticipée, chambre bloquée.

**Intégrations PMS** à confirmer avec les pilotes. Candidats fréquents :
- Mews, Apaleo, Cloudbeds : API ouvertes ;
- Opera Cloud : API, mais accès partenaire coûteux ;
- solutions locales pour les petits hôtels.

**Répartition des responsabilités**

| HALO | PMS |
|---|---|
| Missions et attribution | Réservations, tarifs, facturation |
| Preuves et validation | Affectation des chambres |
| Linge et incidents | Check-in et check-out |
| **Statut opérationnel de la chambre**, renvoyé au PMS si celui-ci le permet | Communication commerciale avec le voyageur |

HALO ne devient pas un PMS.

**Avant tout développement**
- 3 à 5 entretiens avec des établissements pilotes : processus réels, PMS utilisé, volumes, qui valide une chambre.
- Puis une validation commerciale.

## 4. Socle de mesure pour les pilotes

**Principe** : d'abord une **situation de référence** mesurée pendant 2 à 4 semaines chez chaque pilote, puis des comparaisons. Aucun chiffre promis sans cette base. Chaque indicateur indique sa source et sa méthode.

| Indicateur | Calcul | Source dans HALO |
|---|---|---|
| Séjours prêts à l'heure | Arrivées dont le ménage est validé avant l'heure d'arrivée, divisées par les arrivées | Ménages, historique de validation, séjours |
| Délai entre détection et résolution d'un blocage | Moment où un blocage d'arrivée apparaît → moment où il disparaît | Il faudra **journaliser les blocages** (table d'événements côté serveur) : à prévoir avec la base |
| Missions manquées, retardées, réattribuées | Fenêtre dépassée sans démarrage ; démarrage après le créneau ; changements d'agent | Historique des missions (base) |
| Ruptures de linge et achats urgents | Jours en rupture prévue ; achats hors réassort | Journal des mouvements de linge |
| Corrections et qualité | Corrections par mission validée ; motifs | `task_events` |
| Temps de coordination évité | **Déclaratif** au départ (questionnaire avant/après), signalé comme tel | Pas de mesure automatique honnête possible au début |
| Énergie | Mesurée si un équipement remonte sa consommation ; sinon estimée, avec la méthode affichée | Dépend du §10 |
