# 18 — Linge et blanchisseur externe

## Ce que l'écran Linge répond

En tête de l'écran, « Ce qui manque, où et quand agir » :

- **Quoi** : l'article en manque.
- **Pour quel logement et quand** : le premier séjour confirmé pour lequel le stock propre ne suffit plus, avec sa date.
- **Combien d'arrivées** sont concernées.
- **Ce qui est attendu du blanchisseur** avant cette date.

Le calcul ne retient que les séjours confirmés. Un séjour annulé ou déplacé est donc recalculé à l'ouverture de l'écran, sans rien laisser derrière lui.

Le linge chez le blanchisseur ne compte que si une commande en cours prévoit son retour **avant** l'arrivée. Une commande en retard n'est plus comptée et apparaît en alerte.

HALO ne dit jamais « prêt » dans trois cas : catalogue vide, article jamais compté, logement qui reçoit un voyageur sans kit.

## Stock

- **Mouvements** : propre, sale, chez le blanchisseur. L'historique ne se modifie pas.
- **Stock jamais négatif** : une sortie supérieure au stock est refusée (`insufficient_stock`).
- **Deux responsables sur le même article** (migration 31) : l'inventaire transmet la quantité qu'il affichait. Si un collègue a modifié ce stock entre-temps, rien n'est enregistré et le nouveau chiffre s'affiche. On recompte, ou on confirme explicitement son chiffre.

## Blanchisseur externe (migration 32)

1. **Partenaire** créé par un responsable.
2. **Invitation nominative** : nom et adresse. Le lien est valable 14 jours, utilisable une seule fois, et uniquement par le compte connecté avec cette adresse. Sinon, HALO affiche « réservée à … ».
3. **Commande** : articles, quantités, date de retour prévue, consigne. Le linge sale passe « chez le blanchisseur ». Si le stock sale ne suffit pas, la commande est refusée et rien n'est créé.
4. **Étapes déclarées par le blanchisseur** : reçu (quantités comptées), en traitement, prêt, en livraison (quantités livrées). Une seule étape à la fois, sans retour en arrière.
5. **Réceptionné** : réservé à la conciergerie. Elle indique les quantités réellement constatées, qui passent au propre. Un manque reste visible « chez le blanchisseur ».
6. **Écart** (déclaré ou constaté) : il apparaît dans l'historique et sur l'écran Linge. Une notification est préparée pour les responsables (`team_laundry_gap`). Un **retard** (date dépassée) apparaît en alerte.
7. **Annulation** : possible seulement avant réception par le blanchisseur. Le linge revient au sale.
8. **Historique** de chaque action, avec l'auteur côté conciergerie ou côté blanchisseur.

### Accès du blanchisseur

- **Aucune lecture directe de table.** Une seule fonction (`laundry_my_orders`) renvoie SES commandes : client, articles, quantités, dates, historique.
- **Rien d'autre n'est accessible** : ni logement, ni voyageur, ni mission, ni messagerie, ni stock global.
- **Un compte blanchisseur ne voit jamais l'application de la conciergerie** : il est redirigé vers `/laundry`.
- **Accès retiré** ou partenaire désactivé : plus rien n'est visible, immédiatement.

## Tests

| Niveau | Contenu |
|---|---|
| Isolation SQL (sections 31-32) | 2 conciergeries × 2 blanchisseurs : invitation nominative, usage unique, commandes cloisonnées, aucune lecture directe, étapes, écarts, stock, annulation, accès retiré, agent et autre conciergerie refusés, inventaire concurrent |
| Bout en bout 56 | Parcours complet à l'écran, conciergeries A et B, blanchisseurs 1 et 2, téléphone |
| Bout en bout 57 | Cas réels du linge : plusieurs logements, arrivées rapprochées, deux responsables, séjour déplacé puis annulé, retour du blanchisseur avant ou après l'arrivée, retard |
| Bout en bout 58 | Journée complète : départ, ménage, linge, incident, intervention, correction, validation, arrivée, absence |
| Autotest préproduction | `linen_count_never_overwrites_concurrent_change`, `laundry_invitation_is_nominative`, `laundry_partner_sees_only_own_orders`, `laundry_order_steps_gap_and_stock` |
