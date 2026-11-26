# Publier MXNestSpirit 4.3

## 1. Mettre le dépôt à jour

Sur github.com/MXSPIRIT/mxnestspirit : "Add file" > "Upload files", puis glisse
le contenu du zip -github dézippé :

- README.md, README-fr.md, LICENSE, PUBLIER.md
- le dossier spiritpanel en entier

Message de commit :
`4.3 — structure du fichier respectée, calques cachés, lettrage, nouveau panneau`
puis "Commit changes".

## 2. Supprimer l'ancienne release

Onglet Releases > clique sur la 4.2 > "Delete" en haut à droite.
Accepte aussi la suppression du tag.

## 3. Créer la release 4.3

Releases > "Create a new release" :

- Tag : v4.3
- Titre : MXNestSpirit 4.3 — le fichier reste tel quel
- Description : le texte ci-dessous
- Glisse MXNestSpirit-4.3-panneau.zip dans "Attach binaries"
  (c'est comme ça que GitHub compte les téléchargements)
- "Publish release"

Texte de la release :

    NOUVEAU
    - Le nesting ne recrée aucun groupe : chaque pièce reste un groupe, un
      masque ou un tracé, comme dans le fichier. Verrous remis après la pose.
    - Ce qui est décoché (objet, groupe, calque) est ignoré, ne fait plus
      planter le calcul et n'est jamais rallumé.
    - Lettrage : un texte vectorisé reste un seul bloc. Textes non vectorisés,
      images et traits de gravure imbriqués sans déborder.
    - Case « Garder chaque groupe entier » (lettrage, laser).
    - Kits rangés par type (Cutting Layer / Alpha / Graphic / Logos / Text) :
      chaque pièce est retrouvée sans rien regrouper.
    - Pièce plus large que la laize : nommée et sélectionnée, au lieu d'une
      erreur Sparrow incompréhensible.
    - Nouvelle mise en page, adaptée aux portables.

    CORRIGÉ
    - Contours de PDF de découpe pris pour des rectangles.
    - Remplissage affiché au-dessus de 100 %.
    - Une pièce verrouillée faisait échouer toute la pose.
    - Sous-calques mal lus, repères pris pour des pièces.

    RAPPEL
    Sparrow fonctionne sous Windows uniquement. Sur Mac, le panneau retombe sur
    le moteur intégré : tout marche, sans le gain de 10 %.

## 4. Le lien à partager

    https://github.com/MXSPIRIT/mxnestspirit/releases
