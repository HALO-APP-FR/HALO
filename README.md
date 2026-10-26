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
- [ ] Phase 2 — Base de données, connexion, organisations
