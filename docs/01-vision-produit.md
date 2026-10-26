# HALO — Vision produit (nom de code provisoire)

> L'OS des opérations de conciergerie. Fini les groupes WhatsApp.

## 1. Le problème
Une conciergerie de 20 à 300 logements gère chaque jour :
- des rotations ménage entre un départ (check-out) et une arrivée (check-in), parfois le même jour ;
- des équipes terrain dispersées, souvent multilingues, rarement à l'aise avec les outils ;
- du linge qui circule entre stock, logements et blanchisserie, et qui se perd ;
- des incidents (casse, panne, objet manquant) signalés par message vocal à 22 h.

Aujourd'hui : Airbnb + Booking + Excel + WhatsApp + appels. Résultat : oublis, doublons, linge manquant, avis négatifs, managers épuisés.

## 2. La promesse
1. **Zéro saisie** : les réservations arrivent seules (iCal), les ménages se créent seuls.
2. **Zéro ambiguïté terrain** : l'agent ouvre l'app et sait quoi faire en 3 secondes.
3. **Zéro linge perdu** : chaque drap est compté, chaque commande blanchisserie est calculée.
4. **Une seule source de vérité** : chaque échange est rattaché à une tâche, plus aucun fil de discussion général.

## 3. Positionnement face à la concurrence
**HALO ne remplace pas le logiciel de gestion (PMS) de la conciergerie : il s'y branche et ne fait que la logistique** (voir `docs/06-integrations.md`). Réservations, messages voyageurs, prix et comptabilité restent dans le PMS.

Breezeway, Turno, Properly, Operto existent, et les PMS ont parfois un module ménage basique. Nos 3 angles d'attaque :
- **Vitesse terrain** : interface agent pensée pour être utilisée avec une main, des gants, en 4G faible, sans savoir lire la langue (icônes + photos + langue de l'agent).
- **Linge natif** : module de suivi et de prévision du linge intégré, pas un add-on.
- **Mondial dès le jour 1** : multi-langues, multi-fuseaux horaires, formats de date locaux, sans dépendance à un PMS américain.

## 4. Rôles utilisateurs
| Rôle | Qui | Ce qu'il fait | Support principal |
|---|---|---|---|
| **Owner** | Gérant de la conciergerie | Tout + abonnement + équipe | Ordinateur |
| **Manager** | Planificateur / responsable opérations | Logements, planning, affectations, contrôle qualité, linge | Ordinateur + mobile |
| **Agent** | Agent de ménage, agent d'accueil | Ses tâches du jour, checklists, photos, signalements | Mobile uniquement |

Phase 2 : **Propriétaire** (portail lecture seule), **Prestataire** (blanchisserie, technicien).

## 5. Périmètre MVP (v1 vendable)
### Inclus
- **Organisation** : création conciergerie, invitation des membres par lien/e-mail, rôles.
- **Logements** : fiche complète (adresse, fuseau horaire, accès, lits, consignes, photos de référence), checklists par pièce.
- **Réservations** : import automatique via lien iCal (Airbnb, Booking, Vrbo, tout PMS qui exporte de l'iCal), conçu dès le départ comme le premier « connecteur » d'une architecture d'intégrations PMS + saisie manuelle de secours.
- **Tâches** : génération automatique (ménage de rotation, check-in, check-out), création manuelle, statuts, priorités.
- **Planning** : vue jour/semaine par agent et par logement, affectation par glisser-déposer, alertes de conflit.
- **App agent** : écran « Aujourd'hui », exécution guidée de la checklist, photos obligatoires, signalement d'incident, commentaires.
- **Contrôle qualité** : validation ou refus de la tâche par le manager à partir des photos.
- **Linge** : types de linge, parures par logement, stock par emplacement, besoin calculé par rotation, bons de blanchisserie.
- **Notifications** : push web + e-mail (tâche assignée, modifiée, en retard, incident).
- **PWA** : installable sur iPhone/Android, fonctionne hors-ligne pour l'exécution d'une tâche.
- **Langues** : FR, EN, ES, PT, IT, DE au lancement.

### Exclus du MVP (phase 2+)
Maintenance avancée (tickets techniques, prestataires), stocks consommables (savon, café), paie des agents, portail propriétaire, connecteurs API PMS (Smoobu, Lodgify, Beds24, Hostaway, Guesty — priorité n°1 après le MVP), facturation, application native, IA (planning optimisé, détection de défauts sur photos).

## 6. Règles métier clés (non négociables)
1. **Fenêtre de ménage** = de l'heure de check-out de la réservation sortante à l'heure de check-in de la réservation entrante suivante. Si aucune réservation suivante : fenêtre ouverte jusqu'à J+3 par défaut.
2. **Rotation à J (« same-day turnover »)** : départ et arrivée le même jour → tâche marquée **Prioritaire** automatiquement.
3. **Tout horaire est stocké en UTC** et affiché dans le **fuseau du logement** (jamais celui du navigateur). Un manager à Paris qui gère un logement à Lisbonne voit l'heure de Lisbonne.
4. **Une réservation annulée** (disparue du flux iCal) annule les tâches associées non commencées et notifie l'agent affecté. Une tâche commencée n'est jamais supprimée automatiquement.
5. **Une réservation modifiée** (dates changées) recalcule la fenêtre et notifie.
6. **Codes d'accès** visibles par l'agent uniquement le jour de sa tâche, pour les logements qui lui sont affectés.
7. **Photos obligatoires** : définies par élément de checklist ; impossible de terminer la tâche sans elles.
8. **Besoin linge d'une rotation** = parure du logement (selon lits) × 1, + options (linge de bain par voyageur si le nombre de voyageurs est connu).
9. **Isolation totale** entre conciergeries : aucune donnée ne fuit d'une organisation à une autre (sécurité au niveau base de données).
10. **Données voyageurs minimales** : nom affiché, dates, nombre de voyageurs. Rien d'autre (RGPD).

## 7. Indicateurs de succès
- Temps de planification quotidien d'un manager : < 10 min pour 30 logements.
- 100 % des rotations créées sans saisie manuelle.
- Taux de tâches terminées avec toutes les photos : > 95 %.
- Activation : 1re tâche terminée par un agent dans les 48 h après inscription.

## 8. Modèle économique (pour orienter le produit)
Abonnement par logement actif / mois, palier gratuit jusqu'à 3 logements. Les agents sont illimités et gratuits (c'est ce qui tue les groupes WhatsApp).
