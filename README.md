# HALO

L'OS des opérations de conciergerie : ménages, planning, arrivées/départs, linge.

## Lancer l'application sur ton ordinateur
1. Installer Node.js (version LTS) : https://nodejs.org
2. Ouvrir ce dossier dans Cursor, puis le terminal (`Ctrl + ù` ou menu *Terminal > New Terminal*).
3. Taper, une seule fois : `npm install`
4. Puis à chaque fois : `npm run dev`
5. Ouvrir http://localhost:3000/fr/today dans le navigateur.

Pages utiles :
- Manager : http://localhost:3000/fr/today
- Agent (format téléphone) : http://localhost:3000/fr/a/today
- Connexion : http://localhost:3000/fr/login
- Vitrine du design : http://localhost:3000/fr/design

## Commandes
| Commande | Rôle |
|---|---|
| `npm run dev` | Lance l'app en local |
| `npm run check` | Vérifie tout (style du code, types, tests) |
| `npm run build` | Construit la version de production |
| `npm run test:e2e` | Tests dans un vrai navigateur |

## Documentation
Tout est dans `docs/` (vision, parcours, données, moteur, design). Les règles pour Cursor sont dans `.cursor/rules/halo.mdc`.

## Avancement
- [x] Phase 1 — Socle technique, design system, navigation, 6 langues
- [x] Écran de connexion (interface et logo animé ; branchement à Supabase en phase 2)
- [x] Logements : création en 3 étapes, fiche complète (calendrier, infos, accès, couchages, checklist)
- [x] Réservations : saisie manuelle + synchronisation iCal (Airbnb, Booking, Vrbo) → ménages générés automatiquement
- [x] Planning jour/semaine par agent, répartition automatique, alertes de conflit
- [x] Tâches (filtres, détail, assignation, validation/reprise), Équipe, Réglages
- [x] App agent branchée : démarrer / terminer, code d'accès visible pendant la mission
- [x] Équipements et extérieurs par logement (terrasse, balcon, piscine, four, TV…)
- [x] Livret voyageur : lien + QR code + affiche A5 (wifi, accès, règles, départ), signalement voyageur, bouton « Je pars »
- [x] Alertes : signalements équipes / voyageurs / manager, localisés (pièce ou équipement), photos, intervention planifiée
- [x] Module Linge : stock par emplacement, kits auto par logement, prévision de rupture 7 jours, bons de blanchisserie (envoi, réception, écarts), journal, coûts
- [x] Voyageurs : noms, adultes/enfants/bébés/animaux (kit bébé, +30 min si animaux)
- [x] Planning mois, tuiles du tableau de bord cliquables, photo exigée + photo de référence dans la checklist
- [x] Écran de mission agent : chrono (pointage), checklist par pièce, photos, état de chaque pièce (RAS / casse / manquant / très sale) + commentaire → alertes automatiques
- [x] Durées apprises : chaque ménage pointé ajuste la durée des suivants (par logement, désactivable)
- [x] Planning glisser-déposer (jour et semaine), durée et charge visibles à l'assignation
- [x] Agent : calendrier 7 jours / semaine / mois, heures travaillées
- [x] VIP + Prestations haut de gamme (chef, restaurant, chauffeur, transfert…), demandes depuis le livret
- [x] Équipe par postes (ménage, gouvernante, maintenance, linge, concierge, chauffeur, chef)
- [x] Livret voyageur contenu dans le lien : le QR code fonctionne sur n'importe quel téléphone
- [ ] Phase 2 — Base de données Supabase (les données sont pour l'instant enregistrées dans le navigateur)
