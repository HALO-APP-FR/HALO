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

### F10 — Bouton voyageur (QR code dans le logement)
Validé le 26/10/2026. **Pas de chat libre** (la messagerie voyageur reste dans le PMS) : uniquement des demandes structurées qui créent de la logistique.
- QR code imprimable par logement → page web légère, sans application, dans la langue du téléphone du voyageur, aux couleurs HALO (ou de la conciergerie plus tard).
- 4 boutons :
  1. **Je pars** → départ signalé : la tâche de ménage passe « prête à démarrer », l'agent est prévenu, alimente F2 (logement prêt plus tôt).
  2. **Un problème** → photo + catégorie (panne, casse, fuite, nuisible, autre) → incident ; urgent = alerte immédiate au manager.
  3. **Il me manque quelque chose** → linge, papier, café, autre → tâche de livraison créée pour un agent.
  4. **Je n'arrive pas à entrer** → alerte urgente au manager + rappel des instructions d'accès générales (jamais le code s'il n'est pas déjà donné par la plateforme).
- Suivi visible par le voyageur : « Demande reçue » → « Un agent arrive vers 15:00 » → « Résolu ».
- Lien « Écrire à votre hôte » vers la messagerie de la plateforme de réservation pour tout le reste.
- Sécurité : jeton QR propre au logement, actif seulement pendant une réservation en cours ; limitation du nombre de demandes ; aucune donnée personnelle affichée ; pas de compte à créer.
- Tables : `guest_access_tokens`, `guest_requests` (type, statut, photos via `attachments`, tâche ou incident créé).
- Placement conseillé : vague 1 (lancement), car il nourrit directement F2.

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
> **Livré en démo (26/10/2026)** : module Linge complet. Kits calculés par logement (lits × tailles, voyageurs, bébés), stock par emplacement (propre / logement / sale / blanchisserie), mouvements automatiques à la fin de chaque rotation, prévision de rupture sur 7 jours (retour blanchisserie inclus), bons de blanchisserie pré-remplis (brouillon → envoyé → reçu avec manquants et abîmés), inventaire, achats, journal immuable, coût par rotation, niveau de stock cible par logement (jeux de linge). Reste : QR sur les sacs et rôle `laundry_partner` (phase base de données).
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
