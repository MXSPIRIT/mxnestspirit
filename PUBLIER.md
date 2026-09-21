# Publier MXNestSpirit 4.2

## 1. Mettre le dépôt à jour

Sur github.com/MXSPIRIT/mxnestspirit : "Add file" > "Upload files", puis glisse
le contenu du zip -github dézippé :

- README.md, README-fr.md, LICENSE, PUBLIER.md
- le dossier spiritpanel en entier

Message de commit :
`4.2 — gestionnaire d'encres, temps Sparrow, métrage en direct`
puis "Commit changes".

## 2. Supprimer l'ancienne release

Onglet Releases > clique sur la précédente > "Delete" en haut à droite.
Accepte aussi la suppression du tag.

## 3. Créer la release 4.2

Releases > "Create a new release" :

- Tag : v4.2
- Titre : MXNestSpirit 4.2 — gestionnaire d'encres
- Description : le texte ci-dessous
- Glisse MXNestSpirit-4.2-panneau.zip dans "Attach binaries"
  (important : c'est comme ça que GitHub compte les téléchargements)
- "Publish release"

Texte de la release :

    NOUVEAU
    - Gestionnaire d'encres, sur le modèle de l'Ink Manager d'Esko : toutes les
      encres utilisées (quadri et tons directs, y compris dans les dégradés et
      les textes). Chaque ton direct a sa colonne « devient », et Tout
      appliquer convertit tout en un clic, teinte conservée. Sélection des
      objets par encre, renommage.
    - Temps Sparrow réglable.
    - Métrage affiché en direct pendant la recherche Sparrow.
    - Blocs Finitions et Encres repliables.

    CORRIGÉ
    - Pièces perdues et pièces en contact pendant l'affinage.
    - Le bouton Stop est utilisable pendant tout le calcul, Sparrow compris.

    RAPPEL
    Sparrow fonctionne sous Windows uniquement. Sur Mac, le panneau retombe sur
    le moteur intégré : tout marche, sans le gain de 10 %.

## 4. Le lien à partager

    https://github.com/MXSPIRIT/mxnestspirit/releases
