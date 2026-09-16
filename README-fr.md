# MXNestSpirit

[English version](README.md)

Imbrication true-shape pour Adobe Illustrator, pensée pour les kits déco moto.
Gratuite, libre, faite dans un atelier qui produit des kits depuis 2009.

**MX Spirit — Montpellier**

---

## Ce que ça fait

Ça pose tes pièces sur la laize en suivant leur **vrai contour**, pas leur boîte
englobante. Chaque pièce reste un bloc : tracé de coupe, masque d'écrêtage,
logos, tout pivote ensemble.

- rotation libre au pas de 5 à 30°, ou bloquée pour les dégradés
- écart de lame et marge de bord garantis, jamais rabotés
- les petites pièces vont se loger dans les creux et dans les trous des grandes
- emboîtement des pièces deux par deux, conservé seulement s'il fait gagner
- repères de découpe posés après coup, sur un calque à part
- contrôle automatique : le script vérifie qu'aucune pièce n'en touche une autre

## Résultat mesuré

Kit Husqvarna réel, 16 pièces, laize 1350 mm, écart 1 mm :

| | Métrage | Remplissage | Temps |
|---|---|---|---|
| Recherche rapide | 0,862 m | 61,4 % | 2 s |
| Recherche normale | 0,830 m | 63,7 % | 5 s |
| Recherche maximale | **0,826 m** | 64,1 % | 36 s |
| eCut (référence payante) | 0,829 m | — | — |

Zéro chevauchement dans les trois cas, contrôlé automatiquement.

## Installation

1. Télécharge le zip de la dernière version
2. Dézippe
3. **Windows** : double-clic sur `install-windows.bat`
   **Mac** : double-clic sur `install-mac.command` (si refus : clic droit > Ouvrir)
4. Relance Illustrator → **Fenêtre > Extensions > MXNestSpirit**

Illustrator CC 2014 et plus récent, Windows et Mac.
Le script autorise les extensions non signées (`PlayerDebugMode`) et copie le
panneau dans le dossier des extensions CEP. À faire une fois par machine.

## Utilisation

**Analyser → Imbriquer → Appliquer → Poser les repères.**

`Ctrl+Z` annule toute l'imbrication d'un coup.

Si tu changes un réglage, reprends à Imbriquer. Si tu touches au document,
reprends à Analyser.

### Réglages qui comptent

| Réglage | Conseil |
|---|---|
| Écart lame | 1 mm si ta découpe est bien calée, 2 mm sinon |
| Précision | 1 mm. En 2 mm, le quadrillage rajoute à lui seul 2 mm de vide entre les pièces |
| Rotation | pas 10°. Au-delà, plus de gain mesurable |
| Recherche | Normale au quotidien, Maximale sur les gros kits |

### Si aucune pièce n'est trouvée

Clique sur **Que contient le fichier ?** : il liste les tons directs et les
couleurs réellement présentes. Sélectionne ensuite un contour de coupe dans
Illustrator et choisis « Même couleur que le tracé sélectionné ».

## Comment il reconnaît une pièce

Dans l'ordre, par pièce :

1. le tracé en ton direct (CutContour et compagnie), s'il existe
2. sinon le masque d'écrêtage du groupe, cherché à tous les niveaux
3. sinon la silhouette de toutes les formes du groupe, réunies
4. sinon la boîte englobante (image matricielle sans contour)

L'option « Serrer au dessin » force la silhouette plutôt que le masque, bornée
par le masque : ce qui dépasse n'est pas imprimé, donc ne compte pas.

## Repères de découpe

Rond plein, carré plein ou angle en L. Taille, retrait et épaisseur réglables,
posés sur un calque `Regmark` verrouillé, après l'imbrication — ils ne mangent
pas de place dans le calcul, et le script prévient si une pièce en recouvre un.

Deux presets fournis, et deux seulement :

- **Valiani** : ronds 10 mm, relevés sur des planches de production
- **Graphtec CE7000 / FC9000** : angles en L, 20 mm, trait 1 mm — le manuel
  autorise 5 à 20 mm et 0,3 à 1,0 mm, et impose une ligne unique

Pour les autres machines, rien n'est deviné : règle une fois d'après un fichier
validé et clique **Mémoriser**. Un repère de la mauvaise taille est invisible à
l'écran et fatal au massicot, après impression.

## Comment ça marche dedans

Le contour est aplati à 0,08 mm près, sans aucune simplification — c'est ce qui
évite les pièces déformées. Il est ensuite rastérisé en masque de bits, traité
32 pixels à la fois.

Le placement est un *bottom-left-fill* true-shape : chaque pièce tombe vers le
début du rouleau puis glisse à gauche, en testant le contour réel. Elle entre
donc dans les creux des autres pièces, pas seulement à côté.

L'écart de lame s'obtient en dilatant l'empreinte déjà posée, jamais en
déformant la pièce : la géométrie appliquée dans Illustrator est exactement la
tienne.

Le moteur tourne dans le panneau, donc dans Chrome, pas dans l'interpréteur
d'Illustrator — 30 à 50 fois plus rapide à code identique. Illustrator ne fait
que lire les pièces et les reposer.

## Limites connues

- une pièce plus large que la laize est tournée automatiquement ; si elle ne
  passe toujours pas, elle est signalée et laissée en place
- pas de miroir automatique : un kit gauche/droite garde ses deux pièces
- pas encore de rapport de production, ni de retouche manuelle après coup
- sur un PDF entièrement aplati, sans contour ni groupe, la reconnaissance des
  pièces reste approximative — aucun outil du marché ne s'en sort mieux

## Licence

GPL v3. Tu peux t'en servir, le modifier, le redistribuer. Si tu le modifies et
que tu le diffuses, tu diffuses aussi tes modifications.
