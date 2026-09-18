MXNestSpirit HYBRID 0.3
=======================

Cette version conserve le moteur V10 et ajoute Sparrow comme second moteur de
recherche.

Principe
--------
1. V10 cherche un premier plan avec ses heuristiques motocross.
2. Sparrow reçoit exactement les mêmes contours et cherche indépendamment en
   moteur natif multicœur.
3. Le résultat Sparrow est reconstruit dans l'espace V10.
4. V10 applique compact() puis ruinRecreate() pour tenter de resserrer le plan.
5. Le meilleur plan valide est envoyé au même bouton « Appliquer » qu'avant.

Installation Windows
--------------------
1. Fermer Illustrator.
2. Extraire tout le ZIP.
3. Ouvrir spiritpanel.
4. Double-cliquer install-windows.bat.
5. Relancer Illustrator.
6. Fenêtre > Extensions > MXNestSpirit.
7. Ouvrir le kit, cliquer « Analyser », puis « V10 + Sparrow ».

Réglages
--------
- La laize et l'écart entre pièces utilisent les valeurs du panneau V10.
- Rotation 0° = rotation libre pour Sparrow.
- Recherche Rapide / Normale / Maximale donne environ 25 / 60 / 90 secondes
  au moteur Sparrow, en plus de la recherche V10 et de l'affinage.

Sécurité de production
----------------------
- Si Sparrow ne démarre pas, le résultat V10 est conservé.
- Le résultat Sparrow est refusé si la vérification de transformation dépasse
  0,05 mm.
- Le résultat final passe encore par la vérification de collisions V10.

M73
---
Le fixture réel M73 est fourni dans fixtures/m73_parts_v10.json pour permettre
un benchmark reproductible.

Sparrow / licences
------------------
Le binaire sparrow.exe est le binaire Windows fourni dans le TrueNest Pro
3.8.2 fourni pour cette étude. Les notices et licences accompagnent le binaire
(dossier spiritpanel/bin et THIRD_PARTY_NOTICES.txt).

Sparrow est un projet open source distinct :
https://github.com/JeroenGar/sparrow

Cette version hybride ne modifie pas le code du moteur V10.


CORRECTION 0.3
----------------
Le bouton hybride de la 0.2 affichait « Sparrow indisponible » parce que les deux modules nécessaires (sparrow.js et sparrow-run.js) n'étaient pas chargés par index.html. Ils étaient présents dans le ZIP mais jamais inclus dans la page CEP. 0.3 les charge explicitement avant hybrid.js.


CORRECTION 0.10 (par Claude)
----------------------------
Sparrow tournait mais n'améliorait rien. Cause : la boucle des niveaux de
géométrie commençait par eps = 0, c'est-à-dire les contours bruts, et gardait
le premier résultat valide — donc elle s'arrêtait toujours là.

Mesuré sur fixtures/m73_parts_v10.json : 25 pièces, 24 858 points de contour,
jusqu'à 1 613 pour une seule pièce. jagua-rs construit ses structures de
collision sur ces points ; à ce volume, Sparrow passe son temps de calcul à
ramer au lieu d'explorer.

Effet de la simplification sur ce même kit :

  tolérance   points totaux   max/pièce   écart de surface
  0 mm            24 858        1 613         0 %
  0,1 mm           2 511          209         0,020 %
  0,2 mm           1 765          141         0,032 %
  0,5 mm           1 109           90         0,110 %

L'ordre des niveaux est donc inversé : 0,25 mm d'abord, puis 0,5 / 0,1 / 1,5,
et les contours bruts seulement en dernier recours si tout le reste a été
refusé.

La simplification pouvant raboter jusqu'à eps vers l'intérieur, cet eps est
rendu à l'écart de lame passé au solveur (--min-item-separation = écart + eps).
L'écart réel entre deux pièces reste donc au moins celui demandé. Les bords de
laize étaient déjà compensés par stripHeight.

Non vérifié en exécution : sparrow.exe est un binaire Windows, impossible à
lancer ici. Le changement est géométrique et se vérifie sur le métrage obtenu.


CORRECTION 0.12 (par Claude)
----------------------------
Symptôme : « Sparrow brut 0,721 m · Sparrow converti 3,007 m ». Le solveur
trouvait un bon plan, la conversion l'éparpillait.

Cause : deux conventions de rotation opposées, mélangées dans toV10Result.

  MXNest.rotatePoly(p, rad)   tourne autour de l'ORIGINE, sens direct
  rotateMulti(polys, deg)     tourne autour du CENTRE de la pièce, sens inverse

Les anneaux de la pièce étaient tournés avec la première, le cadre de coupe avec
la seconde, puis on comparait leurs boîtes englobantes pour en déduire la
position. Chaque pièce repartait donc avec un décalage qui lui était propre.

Correction : tout est tourné avec la convention du pont pour calculer la
position, et l'angle rendu à Illustrator est l'opposé — la pose applique
rotate(-angle), ce qui reproduit exactement l'orientation choisie par Sparrow.

Vérifié sans Sparrow (test de conversion aller-retour, 8 pièces réelles du kit
M73, angles 0 / 17 / 35 / 90 / 143 / 210 / 275 / 330°) :

  plan fabriqué              2768,3 mm
  après conversion corrigée  2763,3 mm   (les 5 mm sont l'écart final)
  écart de forme/position    0,000000 mm

  avec l'ancienne conversion 2659,8 mm   soit 108 mm d'erreur de placement
