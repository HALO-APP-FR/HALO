# HALO — Design system

Référence d'esprit : la retenue d'Apple, la précision de Tesla. **Le luxe, c'est ce qu'on enlève.**

## 1. Principes
1. **Une seule couleur d'accent**, utilisée uniquement pour l'action principale et l'état actif. Tout le reste est en niveaux de gris.
2. **La donnée est le décor** : pas d'illustrations décoratives, pas de dégradés, pas d'ombres lourdes. La hiérarchie vient de la typo et de l'espace.
3. **Une action primaire par écran**, visuellement évidente.
4. **Généreux en espace, précis dans l'alignement** : grille de 4 px, tout aligné.
5. **Le mouvement explique**, il ne décore pas : transitions courtes qui montrent d'où vient et où va un élément.
6. **Pensé pour le pouce** côté agent : zones tactiles ≥ 48 px, actions principales en bas de l'écran.

## 2. Couleurs (tokens CSS — source de vérité : `src/app/globals.css`)

Tous les couples texte/fond ont été vérifiés ≥ 4,5:1 (WCAG AA). En Tailwind : `bg-canvas`, `bg-subtle`, `bg-surface`, `border-line`, `text-fg`, `text-muted`, `text-faint` (icônes et éléments décoratifs uniquement, jamais du texte utile), `bg-accent`, `text-accent-text`, `bg-danger-soft text-danger`, etc.
```css
:root {
  --bg:            #FFFFFF;
  --bg-subtle:     #F5F5F7;   /* fond de page des écrans manager */
  --surface:       #FFFFFF;   /* cartes */
  --surface-hover: #FAFAFA;
  --border:        #E5E5EA;
  --border-strong: #D1D1D6;
  --text:          #0B0B0C;
  --text-muted:    #6E6E73;
  --text-faint:    #A1A1A6;

  --accent:        #0055FF;
  --accent-hover:  #0047D6;
  --accent-soft:   #EBF1FF;
  --accent-text:   #0055FF;   /* accent utilisé comme texte (sombre : #6B9BFF) */
  --on-accent:     #FFFFFF;

  /* États (toujours accompagnés d'un libellé ou d'une icône, jamais la couleur seule) */
  --success:       #137A40;  --success-soft: #E8F6EE;
  --warning:       #9A5B00;  --warning-soft: #FFF6E0;
  --danger:        #C4261B;  --danger-soft:  #FDECEA;
  --info:          #5B5BD6;  --info-soft:    #EFEFFD;

  /* Types de tâche */
  --type-turnover:  #0055FF;
  --type-checkin:   #137A40;
  --type-checkout:  #9A5B00;
  --type-linen:     #8E4EC6;
  --type-other:     #6E6E73;

  --radius-sm: 8px;  --radius-md: 12px;  --radius-lg: 16px;  --radius-xl: 24px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,.04);
  --shadow-md: 0 4px 16px rgba(0,0,0,.06);
  --shadow-lg: 0 12px 40px rgba(0,0,0,.10);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #000000; --bg-subtle: #0A0A0B; --surface: #141416; --surface-hover: #1C1C1E;
    --border: #2C2C2E; --border-strong: #3A3A3C;
    --text: #F5F5F7; --text-muted: #98989D; --text-faint: #636366;
    --accent: #2A66F5; --accent-hover: #4078FF; --accent-text: #6B9BFF; --accent-soft: #0F1F44;
    --success-soft: #0E2A1B; --warning-soft: #2E2205; --danger-soft: #3A1210; --info-soft: #1C1C3A;
    --shadow-sm: none; --shadow-md: 0 4px 16px rgba(0,0,0,.4); --shadow-lg: 0 12px 40px rgba(0,0,0,.6);
  }
}
:root[data-theme="dark"] { /* mêmes valeurs que le bloc ci-dessus */ }
```
Contraste minimum WCAG AA (4,5:1) pour tout texte. À vérifier sur chaque combinaison.

## 3. Typographie
- Police : **Inter** (variable, via le paquet `@fontsource-variable/inter`, servie par l'app elle-même), chiffres tabulaires activés partout où il y a des heures et des quantités (`font-variant-numeric: tabular-nums`).
- Échelle :
| Token | Taille / interligne | Graisse | Usage |
|---|---|---|---|
| display | 34 / 40 | 700 | Titre d'écran agent, gros chiffres |
| title-1 | 28 / 34 | 700 | Titre de page manager |
| title-2 | 22 / 28 | 600 | Titre de section |
| title-3 | 18 / 24 | 600 | Titre de carte |
| body | 15 / 22 | 400 | Texte courant |
| body-strong | 15 / 22 | 600 | Libellés importants |
| caption | 13 / 18 | 500 | Métadonnées |
| micro | 11 / 14 | 600, majuscules, +4 % d'espacement | Étiquettes de statut |
- Interlettrage négatif léger (−1 à −2 %) sur display et title-1.
- Côté agent, le texte courant passe à **17 px** minimum.

## 4. Espacement & grille
Échelle (px) : 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64.
- Marges de page : 16 px mobile, 32 px ordinateur. Largeur max contenu : 1280 px.
- Espacement interne des cartes : 16 px mobile, 20 px ordinateur.
- Barre latérale manager : 248 px, repliable à 72 px (icônes seules).

## 5. Composants (écrits à la main sur Radix UI, dans `src/components/ui` et `src/components/halo`)
- **Button** : `primary` (accent plein), `secondary` (fond `--bg-subtle`), `ghost`, `danger`. Hauteurs : 36 (ordinateur), 44 (mobile), 56 (action principale agent, pleine largeur).
- **Card** : fond `--surface`, bordure 1 px `--border`, rayon `--radius-lg`, ombre `--shadow-sm`. Survol : `--surface-hover`.
- **StatusPill** : point coloré 6 px + libellé micro. Jamais de couleur sans texte.
- **TaskCard** (agent) : barre verticale de 4 px à gauche à la couleur du type, nom du logement en title-3, « Avant 15:00 » en body-strong, badge Prioritaire en `--danger-soft`.
- **TimelineBar** (manager) : barre horizontale représentant la fenêtre de ménage, bloc plein pour la durée planifiée.
- **Sheet** (panneau latéral droit ordinateur / feuille du bas mobile) pour tout détail : on ne quitte jamais le contexte.
- **Command palette** (⌘K / Ctrl K) côté manager : rechercher un logement, une tâche, un agent, une action.
- **Toast** : en bas au centre, 4 s, avec action « Annuler » quand c'est réversible.
- **Skeleton** pour tout chargement.
- **Empty state** : icône ligne 32 px, titre, une phrase, un bouton.

## 6. Icônes
**Lucide** uniquement, trait 1,75 px, tailles 16 / 20 / 24. Une icône = un sens, utilisé partout de la même façon.

## 7. Mouvement
- Durées : 120 ms (survol, petits états), 200 ms (apparition), 280 ms (panneaux, feuilles).
- Courbe : `cubic-bezier(0.32, 0.72, 0, 1)` (sensation iOS).
- Bibliothèque : **Motion** (ex Framer Motion) pour les panneaux, le glisser-déposer et la validation.
- Respecter `prefers-reduced-motion` : désactiver les déplacements, garder les fondus.
- Retour haptique sur mobile (`navigator.vibrate(10)`) à la validation d'un élément de checklist et à la fin d'une tâche, si supporté.

## 8. Accessibilité & international
- Navigation clavier complète côté manager, focus visible (anneau 2 px accent, décalé de 2 px).
- Mises en page compatibles **droite-à-gauche** (arabe, hébreu) : utiliser les propriétés logiques CSS (`margin-inline-start`, `ps-4` en Tailwind) dès le départ.
- Les textes traduits peuvent être 40 % plus longs (allemand) : aucun texte dans une largeur fixe.
- Formats de date/heure/nombres via `Intl` selon la langue de la personne ; format 12 h/24 h selon la langue.

## 9. Interdits
Dégradés décoratifs, ombres colorées, plus de 2 graisses dans une même carte, texte en majuscules hors étiquettes micro, emojis dans l'interface, modales empilées, spinners plein écran, couleur comme seule information, texte gris clair sur fond gris.
