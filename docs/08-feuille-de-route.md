# HALO — Feuille de route « full logistique »

Principe : **HALO ne se contente pas d'enregistrer le travail, il le prévoit et le décide.**
Toutes les fonctions ci-dessous sont validées par le fondateur (26/10/2026). L'ordre peut évoluer selon les retours des conciergeries pilotes.

## Vague 1 — Lancement (MVP + 2 différenciants)
Le MVP (phases 1 à 11 de `01-PROMPTS.md`), plus :

### F2 — « Logement prêt » en temps réel → PMS
- Quand un ménage est **validé** (ou terminé si l'organisation désactive la validation), le logement passe au statut **Prêt** avec l'heure exacte.
- Envoi au PMS via `PmsConnector.markListingReady` quand l'API le permet ; sinon notification au manager.
- Indicateur « Arrivée anticipée possible dès 12:40 » sur l'écran Aujourd'hui et sur la fiche réservation.
- Réglage par logement : délai de sécurité avant d'annoncer « prêt » (par défaut 15 min).
- Mesure : nombre d'arrivées anticipées rendues possibles par mois (argument commercial).

### F4 — Suivi des clés physiques
- Chaque trousseau a une fiche : logement, nombre de clés, photo, **QR code imprimable** (planche A4 d'étiquettes).
- Scanner le QR avec l'appareil photo = prendre ou rendre la clé. Historique complet : qui, où, quand.
- Statuts : au bureau, chez un agent, dans la boîte à clés, chez le voyageur, perdue.
- Alertes : clé non rendue après la fin de la tâche, clé chez un agent qui n'a pas de tâche sur ce logement.
- Le planning tient compte de qui détient la clé.
- Tables : `keys`, `key_events` (immuable).

## Vague 2 — Le planning qui se fait seul
### F1 — Pilote automatique du planning
- Chaque soir (heure de l'organisation, réglable), HALO propose le planning du lendemain.
- Contraintes : fenêtres de ménage, durées réelles (F7), temps de trajet entre logements, compétences et zones des agents, indisponibilités, détention des clés (F4), équilibre de la charge.
- Le manager voit la proposition, la modifie par glisser-déposer, valide en 1 clic. Rien n'est envoyé aux agents avant validation.
- **Replanification en direct** : départ tardif, agent absent, ménage qui dure plus longtemps → nouvelle proposition et notification des seuls agents concernés.
- Temps de trajet : distance à vol d'oiseau × coefficient au début, puis service d'itinéraires.
- Logique pure dans `src/lib/engine/scheduler.ts`, testée sur des journées réelles anonymisées.

### F7 — Durées réelles apprises
- Durée mesurée de chaque ménage (début → fin), par logement et par agent.
- Durée prévue = médiane des 10 derniers ménages du logement (si au moins 3 mesures), sinon durée saisie.
- Affichage : « Durée prévue 2 h 10 (mesurée) » vs « 2 h (estimée) ».
- Les valeurs aberrantes (moins de 20 % ou plus de 300 % de la médiane) sont ignorées.

## Vague 3 — Stocks et blanchisserie automatiques
### F5 — Linge prédictif
- Proposition automatique du bon de blanchisserie selon les rotations des 7 prochains jours et le stock.
- QR code sur les sacs de linge : scan au départ et à la réception.
- **Accès blanchisserie** (nouveau rôle `laundry_partner`) : voit les bons qui la concernent, confirme réception et livraison, signale les écarts.

### F6 — Consommables
- Catalogue par organisation (papier toilette, café, savon, sacs poubelle…) et niveau cible par logement.
- En fin de ménage, l'agent indique le stock en 2 taps (plein / moitié / vide).
- HALO génère la **liste de réassort** et l'ajoute à la prochaine tournée passant par le stock central.
- Tables : `supplies`, `property_supply_targets`, `supply_counts`, `supply_movements`.

## Vague 4 — Intelligence
### F3 — Contrôle qualité par IA
- Comparaison des photos de fin de ménage avec les photos de référence du logement.
- Détections : lit non fait ou mal fait, linge manquant, poubelle pleine, objet oublié, saleté visible.
- Résultat : « Conforme » ou « À vérifier » avec la zone entourée. **La décision finale reste au manager.**
- Le manager ne vérifie que les « À vérifier » ; les autres sont validés en masse.
- Les photos ne servent qu'à ce contrôle, conformément aux conditions affichées aux clients.

### F8 — Traduction automatique
- Commentaires, consignes, signalements et notes vocales traduits dans la langue de chaque lecteur.
- Le texte original reste accessible (« Voir l'original »).
- Notes vocales transcrites puis traduites.

## F9 — Tableau de bord des coûts logistiques (à cadrer)
Objectif : coût logistique **par nuitée et par logement**, présentable aux propriétaires.

**À décider avec les conciergeries pilotes avant de développer :**
- Coût du ménage : tarif à la tâche, au logement, ou temps réel × taux horaire de l'agent ?
- Coût du linge : prix de blanchisserie par pièce ou par kilo ? Amortissement de l'achat ?
- Consommables : prix unitaire saisi une fois ?
- Incidents : coût de réparation saisi à la clôture ?
- Qui voit quoi : le manager seulement, ou un export PDF pour le propriétaire ?

Une fois cadré : vue par logement, par mois, par propriétaire ; comparaison entre logements ; export PDF.

## Exigence transversale : mobile
- **App agent : conçue d'abord pour le téléphone**, utilisable d'une main.
- **Toutes les pages manager doivent être pleinement utilisables sur téléphone** : planning en vue liste/jour, validation des photos au doigt, scan des QR codes.
- Chaque écran est vérifié à 375 px et à 1 440 px avant d'être considéré comme terminé.
