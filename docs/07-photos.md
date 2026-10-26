# HALO — Photos et pièces jointes

La photo est **la preuve** du travail logistique : ménage fait, linge posé, dégât constaté. Elle doit être possible partout, en 1 geste, même hors connexion.

## 1. Où peut-on prendre ou joindre une photo
| Endroit | Qui | Obligatoire ? |
|---|---|---|
| Élément de checklist | Agent | Selon le réglage de l'élément |
| Arrivée dans le logement (« état d'entrée ») | Agent | Réglable par logement (recommandé : oui) |
| Fin de ménage (« état de sortie ») | Agent | Réglable par logement |
| Signalement d'incident | Agent, manager | Oui (au moins 1) |
| Commentaire sur une tâche | Tous | Non |
| Linge : écart ou linge abîmé | Agent, manager | Oui si linge abîmé |
| Bon de blanchisserie : réception | Manager | Non |
| Fiche logement : photos de référence | Manager | Non |
| Fiche logement : accès (boîte à clés, porte) | Manager | Non |

Pièces jointes autres que photos (PDF, vidéo courte ≤ 30 s) : commentaires et incidents uniquement.

## 2. Expérience agent
- Bouton appareil photo **intégré** à l'écran (pas de détour par la galerie) ; la galerie reste possible.
- **Plusieurs photos d'affilée** sans revenir à l'écran précédent.
- Miniatures immédiates, suppression d'un tap avant envoi.
- Annotation simple : entourer / flécher une zone au doigt (incidents).
- **Hors connexion** : les photos sont stockées sur le téléphone (IndexedDB) et envoyées dans l'ordre au retour du réseau, avec reprise si l'envoi est coupé. Le compteur « 3 photos en attente d'envoi » est visible.

## 3. Valeur de preuve (différenciant)
Chaque photo enregistre automatiquement :
- **date et heure** de prise de vue (horloge du téléphone + heure de réception serveur) ;
- **position GPS** si l'agent l'a autorisée, et un indicateur « prise dans le logement » (distance < 150 m de l'adresse) ;
- **auteur**, tâche, logement, réservation concernée.

Les photos ne sont jamais modifiables. Une annotation crée une copie, l'original est conservé.

**Dossier litige en 1 clic** : depuis un incident, le manager exporte un PDF « État des lieux » (photos d'entrée de l'agent suivant + photos de sortie de l'agent précédent, horodatées et géolocalisées) pour le propriétaire ou pour une réclamation auprès de la plateforme de réservation.

## 4. Technique (pour Cursor)
- Compression côté téléphone avant envoi : 1 600 px max, JPEG qualité 0,8 (≈ 300 Ko). Miniature 400 px générée aussi.
- Suppression des métadonnées EXIF du fichier (vie privée) après extraction des données utiles en base.
- Stockage : bucket Supabase privé, chemin `{organization_id}/{entité}/{id}/{uuid}.jpg`, accès par URL signée courte (1 h).
- Table unique `attachments` (remplace `task_photos` et `incidents.photo_paths`) :
  `id, organization_id, entity_type ('task'|'checklist_item'|'incident'|'comment'|'linen'|'laundry_order'|'property'), entity_id, kind ('photo'|'pdf'|'video'), stage ('entry'|'exit'|null), storage_path, thumb_path, taken_at, received_at, latitude, longitude, distance_to_property_m, width, height, size_bytes, uploaded_by, client_id (identifiant unique généré sur le téléphone pour éviter les doublons hors ligne)`.
- RLS : mêmes règles que l'entité parente.
- Conservation : 12 mois par défaut, réglable par l'organisation ; les photos liées à un incident ouvert ne sont jamais purgées.
- Quota indicatif MVP : 60 photos par tâche.

## 5. Tests obligatoires
- Envoi hors ligne puis reprise : aucune photo perdue, aucun doublon.
- Un agent ne voit que les photos de ses tâches.
- Les métadonnées EXIF sont absentes du fichier stocké.
- Une tâche ne se termine pas si une photo obligatoire manque.
