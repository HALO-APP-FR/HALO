# HALO — Parcours et écrans

Principe directeur : **un écran = une décision**. Si l'utilisateur doit réfléchir, l'écran est raté.

## 1. Architecture de navigation

### Manager / Owner (ordinateur, barre latérale gauche)
1. **Aujourd'hui** — tableau de bord opérationnel du jour
2. **Planning** — vue calendrier jour/semaine
3. **Tâches** — liste filtrable de toutes les tâches
4. **Logements** — liste + fiches
5. **Linge** — stock, besoins, bons blanchisserie
6. **Équipe** — membres, invitations, disponibilités
7. **Réglages** — organisation, langues, notifications, synchros iCal

Sur mobile, le manager a les mêmes sections dans une barre d'onglets en bas (5 max : Aujourd'hui, Planning, Tâches, Logements, Plus).

### Agent (mobile uniquement, 3 onglets en bas)
1. **Aujourd'hui** — ses tâches du jour, dans l'ordre
2. **À venir** — 7 prochains jours
3. **Profil** — langue, disponibilités, déconnexion

Rien d'autre. Un agent ne voit jamais les réglages, la facturation ou les autres agents.

## 2. Écrans détaillés


### 2.0 Connexion (révisé le 26/10/2026)
Deux parcours distincts, choisis par un sélecteur « Responsable / Agent terrain » sur l'écran de connexion :
- **Responsable** (ordinateur) : lien magique par e-mail ou Google.
- **Agent terrain** (téléphone) : **jamais d'e-mail**. Première fois : lien d'invitation reçu par SMS → l'agent crée un **code PIN à 6 chiffres** → le téléphone est enregistré. Ensuite, chaque jour : écran de déverrouillage (« Bonjour Inès ») + clavier PIN à grosses touches, rien d'autre. Sur un nouveau téléphone : numéro de téléphone + PIN.
- Sécurité du PIN (phase 2) : code haché côté serveur (jamais stocké en clair), valable uniquement sur un téléphone enregistré par invitation, blocage 15 min après 5 erreurs, session longue (30 jours) sur le téléphone de l'agent, révocation d'un téléphone par le manager, nouveau lien d'invitation pour réinitialiser le code.

### 2.1 Onboarding conciergerie (objectif : 1re rotation créée en < 5 min)
1. Inscription par e-mail (lien magique, pas de mot de passe) ou Google.
2. Nom de la conciergerie, pays, langue, fuseau horaire par défaut (pré-rempli depuis le navigateur).
3. Ajouter un 1er logement : nom, adresse, nombre de lits par taille, heures check-in/out par défaut.
4. Coller un lien iCal (aide visuelle : « Où trouver mon lien iCal Airbnb / Booking ? »).
5. Écran « magique » : les réservations apparaissent, les ménages sont générés. Bouton : « Inviter mon premier agent ».
6. Invitation par lien partageable (WhatsApp, SMS, e-mail) — ironie assumée : c'est le dernier message WhatsApp.

Chaque étape est passable (« Plus tard »), une barre de progression discrète en haut.

### 2.2 Aujourd'hui (manager)
- En-tête : date du jour, sélecteur de date (← aujourd'hui →).
- **4 compteurs** en cartes : Arrivées · Départs · Ménages · Incidents ouverts.
- **Bloc « À traiter »** en haut, uniquement s'il y a quelque chose : tâches non assignées, tâches en retard, tâches à valider, incidents. Chaque ligne a son action directe (Assigner, Valider, Voir).
- **Journée** : tableau strict « qui fait quoi, à quelle heure » — Horaire · Logement · Mission · Agent · Statut. Pas de diagramme en barres. Tâche sans agent = bouton « Assigner » dans la colonne Agent. Sur téléphone : liste compacte (heure, logement sur toute la largeur, mission + statut, avatar ou « Assigner »).
- **Indicateurs** : sur téléphone, cartes d'une seule ligne (libellé + chiffre), moitié moins hautes, pour que « À traiter » soit visible sans défiler.

### 2.3 Planning (manager)
- Bascule **Par agent** / **Par logement**, et **Jour** / **Semaine**.
- Colonne gauche : liste des tâches non assignées du jour/semaine (glisser vers un agent).
- Grille : lignes = agents (ou logements), colonnes = heures (vue jour) ou jours (vue semaine).
- Glisser-déposer pour assigner ou déplacer. Une tâche posée hors de sa fenêtre devient rouge avec une infobulle : « Hors fenêtre : arrivée à 15:00 ».
- Alerte de conflit : deux tâches qui se chevauchent pour un même agent → bordure orange.
- Durée de la tâche = durée estimée du logement (réglable par logement).

### 2.4 Fiche logement
Onglets : **Infos** · **Accès** · **Lits & linge** · **Checklist** · **Calendrier** · **Historique**.
- Infos : nom, adresse, fuseau, surface, capacité, heures par défaut, durée de ménage estimée, consignes générales, photos de référence (« comment ça doit être »).
- Accès : type (boîte à clés, digicode, serrure connectée, remise en main propre), code, instructions, photo de la porte/boîte.
- Lits & linge : liste des lits (taille), parure associée, linge de bain par voyageur.
- Checklist : pièces → éléments, chaque élément peut exiger une photo. Bibliothèque de modèles (« Studio », « T2 », « Maison 3 ch ») + dupliquer depuis un autre logement.
- Calendrier : réservations + tâches, source iCal et date de dernière synchro.

### 2.5 App agent — Aujourd'hui (l'écran le plus important de l'app)
- Salutation + date dans la langue de l'agent.
- Liste de cartes, dans l'ordre chronologique. Chaque carte :
  - grande pastille de type (icône + couleur : ménage, check-in, check-out, linge) ;
  - nom du logement en gros, quartier/ville dessous ;
  - fenêtre horaire **« Avant 15:00 »** (l'info qui compte vraiment) ;
  - badge **Prioritaire** si rotation à J ;
  - bouton plein écran en bas : **Démarrer**.
- Bouton secondaire sur la carte : **Itinéraire** (ouvre Plans / Google Maps).
- État vide : illustration sobre + « Rien de prévu aujourd'hui ».

### 2.6 App agent — Exécution d'une tâche
1. **Arrivée** : adresse, bouton itinéraire, bloc accès (code en très gros, copiable), consignes spécifiques.
2. **Checklist** pièce par pièce, une pièce par écran (balayage horizontal ou bouton Suivant). Chaque élément = grande case à cocher (zone tactile ≥ 48 px). Élément avec photo requise = bouton appareil photo intégré, la case se coche quand la photo est prise.
3. **Linge** : « Posé : 2 parures doubles, 4 serviettes. Retiré : idem » — confirmation en un tap, ajustement +/− si différent.
4. **Signaler** (bouton flottant toujours visible) : photo + catégorie (Casse, Panne, Saleté anormale, Objet oublié, Manque de produit, Autre) + note vocale ou texte. Urgence : oui/non.
5. **Terminer** : récapitulatif, impossible si photo obligatoire manquante (message clair indiquant laquelle). Après validation : animation de succès sobre, retour à la liste.

Hors-ligne : bandeau discret « Hors connexion — tout est enregistré, envoi automatique au retour du réseau ».

### 2.7 Contrôle qualité (manager)
- File « À valider » : carte par tâche terminée, galerie photos comparées aux photos de référence (côte à côte).
- Actions : **Valider** (1 tap) ou **Demander une reprise** (commentaire obligatoire, notifie l'agent, la tâche repasse en cours).

### 2.8 Linge
- **Stock** : tableau par type de linge × emplacement (Stock central, Dans les logements, Chez la blanchisserie, Sale en attente).
- **Besoins** : besoin calculé pour les 7 prochains jours depuis les rotations planifiées, comparé au stock propre disponible → alerte si déficit.
- **Bons blanchisserie** : créer un bon (départ sale → blanchisserie), réceptionner (blanchisserie → stock propre), écarts signalés (perdu, abîmé).

## 3. États à concevoir systématiquement
Pour CHAQUE écran : **chargement** (squelettes, jamais de spinner plein écran), **vide** (explication + action), **erreur** (message humain + réessayer), **hors-ligne**, **sans permission**.

## 4. Micro-textes (ton de voix)
- Phrases courtes, verbes d'action, jamais de jargon technique.
- « Avant 15:00 » plutôt que « Fenêtre : 11:00–15:00 ».
- « Il manque la photo de la salle de bain » plutôt que « Erreur de validation ».
- Tutoiement interdit par défaut ; vouvoiement en FR, ton neutre poli dans les autres langues.
