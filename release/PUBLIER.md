# Publier MXNestSpirit 3.2

## 1. Mettre le dépôt à jour

Sur github.com/MXSPIRIT/mxnestspirit : "Add file" > "Upload files", puis glisse
le contenu du zip -github dézippé :

- README.md, README-fr.md, LICENSE, PUBLIER.md
- le dossier spiritpanel en entier

Message de commit :
`3.2 — bouton Stop, décalage, logos dans la chute, laizes enregistrées`
puis "Commit changes".

## 2. Supprimer l'ancienne release

Onglet Releases > clique sur la précédente > "Delete" en haut à droite.
Accepte aussi la suppression du tag.

## 3. Créer la release 3.0

Releases > "Create a new release" :

- Tag : v3.2
- Titre : MXNestSpirit 3.2 — Stop, décalage, remplissage de la chute
- Description : le texte ci-dessous
- Glisse MXNestSpirit-3.2-panneau.zip dans "Attach binaries"
- "Publish release"

Texte de la release :

    NOUVEAU
    - Bouton Stop : interrompt V10, Sparrow ou l'affinage. Le meilleur plan
      trouvé est conservé et reste applicable.
    - Décalage, trois modes : nouveau tracé de coupe autour du visuel, élargir
      le tracé existant, ou élargir le masque pour un vrai fond perdu. Travaille
      sur la sélection.
    - Semer un logo dans la chute : autant de copies que la place le permet,
      sans toucher les pièces ni allonger la planche. Calque dédié, retrait en
      un clic.
    - Laizes enregistrées : gardées d'un mois sur l'autre.
    - Tout remettre à zéro : vide le panneau et nettoie Illustrator.
    - Jauge de remplissage, verte au-dessus de 70 %.

    CORRIGÉ
    - Le bouton Stop était grisé pendant les calculs : il ne pouvait pas être
      cliqué au moment précis où il sert.
    - Le décalage échouait sur les pièces issues d'un PDF : il dépendait de
      l'analyse du nesting et de ses identifiants.
    - Le fond perdu partait du contour d'imbrication — souvent un rectangle de
      recadrage — au lieu du tracé de coupe.
    - Changement de document : l'analyse périmée était conservée, d'où des
      pièces qui ne bougeaient pas à l'application.
    - Pièces perdues et pièces en contact : pendant l'affinage, une pièce dont
      l'empreinte ne pouvait pas être reconstruite était sautée en silence, sa
      place restait libre et une autre venait s'y poser. Un tour d'affinage
      incomplet est désormais abandonné en bloc.

    RAPPEL
    Sparrow fonctionne sous Windows uniquement. Sur Mac, le panneau retombe sur
    le moteur intégré : tout marche, sans le gain de 10 %.

## 4. Le lien à partager

    https://github.com/MXSPIRIT/mxnestspirit/releases
