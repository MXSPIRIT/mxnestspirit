# MXNestSpirit

Imbrication true-shape pour Adobe Illustrator, pensée pour les kits déco moto.
Gratuite, libre, faite dans un atelier qui produit des kits depuis 2009.

**MX Spirit — Montpellier** · [English version](README.md)

---

## Nouveau en 2.0

**Le fond perdu.** Il élargit le masque d'écrêtage d'une pièce de quelques
millimètres, pour que le dessin déborde derrière le tracé de coupe — plus de
liseré blanc si la lame dévie d'un cheveu. Il suit ta sélection : tu
sélectionnes des pièces, seules celles-là sont traitées ; tu ne sélectionnes
rien, c'est tout le document. Le fond perdu s'ajoute automatiquement à l'écart
de lame, parce que deux pièces qui débordent chacune de 2 mm doivent s'écarter
de 4 mm de plus.

**Les finitions sont passées sous l'aperçu**, dans l'ordre réel du travail : tu
regardes la planche, elle te convient, tu poses tes repères et ton fond perdu.

**Mise en page large.** Élargis le panneau et il se coupe en deux : à gauche ce
que tu regardes, à droite ce sur quoi tu cliques.

**Surveillance du document.** Le panneau repère maintenant que tu as changé de
fichier et jette l'analyse périmée, au lieu d'appliquer un plan calculé sur un
autre document — c'était la cause des « pièces oubliées ».

## Nouveau en 1.1 — le moteur Sparrow

La version 1.0 avait un seul moteur, le mien. Il tenait la comparaison avec
eCut sur un kit réel : 0,826 m contre 0,829 m.

La 1.1 ajoute un second moteur, **Sparrow**, issu de la recherche universitaire
(KU Leuven), état de l'art pour l'imbrication de formes irrégulières, sous
licence MIT. Les deux travaillent sur le même kit, la planche la plus courte
gagne.

Sur un kit réel de 83 pièces :

| Moteur | Métrage |
|---|---|
| Moteur intégré | 0,800 m |
| **Sparrow** | **0,721 m** |

**Environ 10 cm gagnés par planche, soit 10 %.** Sur cent kits, dix mètres de
vinyle.

> **Sparrow ne fonctionne que sous Windows** dans cette version : le solveur
> fourni est un exécutable Windows. Sur Mac, le panneau retombe sur le moteur
> intégré — tout marche, mais sans les 10 % de gain. Une compilation macOS, ou
> la version WebAssembly de Sparrow, réglerait ça. Contributions bienvenues.

## Ce que ça fait

Ça pose tes pièces sur la laize en suivant leur **vrai contour**, pas leur boîte
englobante. Chaque pièce reste un bloc : tracé de coupe, masque d'écrêtage et
logos pivotent ensemble.

- rotation libre au pas de 5 à 30°, ou bloquée pour les dégradés
- écart de lame et marge de bord garantis, jamais rabotés
- les petites pièces vont se loger dans les creux et dans les trous des grandes
- repères de découpe posés après coup, sur un calque à part
- contrôle automatique : aucune pièce ne doit en toucher une autre, et le
  panneau te le dit si c'est le cas

## Installation

1. Télécharge le zip de la dernière version
2. Dézippe
3. **Windows** : double-clic sur `install-windows.bat`
   **Mac** : double-clic sur `install-mac.command` (si refus : clic droit > Ouvrir)
4. Relance Illustrator → **Fenêtre > Extensions > MXNestSpirit**

Illustrator CC 2014 et plus récent.

### Sécurité — à lire avant d'installer

L'installeur active `PlayerDebugMode`, le réglage qui autorise Illustrator à
charger des extensions **non signées**. Les plugins payants évitent ça en
achetant un certificat de signature ; les projets gratuits, non. Une fois
activé, le réglage vaut pour toutes les extensions, pas seulement celle-ci —
donc n'installe que des extensions dont tu peux lire le code.

Le panneau ne fait rien de caché : il lit les tracés du document ouvert, calcule,
déplace les objets, dessine des ronds sur un calque. Il ne va jamais sur
Internet et n'envoie rien nulle part. Tout est du texte lisible dans ce dépôt.

Une exception à connaître : `bin/sparrow.exe` est un **binaire compilé**, pas du
source. C'est une compilation de [Sparrow](https://github.com/JeroenGar/sparrow),
sous licence MIT. Si tu préfères ne pas lancer un binaire que tu n'as pas
compilé toi-même, supprime-le — le panneau retombe sur le moteur intégré — ou
compile Sparrow depuis son dépôt officiel et remplace le fichier.

## Utilisation

**Analyser → Nesting complet → Appliquer → Poser les repères.**

`Ctrl+Z` annule toute l'imbrication d'un coup.

Tu changes un réglage ? Relance le nesting. Tu touches au document ? Relance
l'analyse.

Deux boutons :

- **Nesting complet** — Sparrow cherche, le moteur intégré reste en secours.
  Une à deux minutes, et c'est lui qui économise du vinyle.
- **Nesting V10 seul** — le moteur intégré seul, quelques secondes, pour un
  aperçu rapide.

Pendant que Sparrow travaille, le panneau affiche le meilleur métrage atteint,
mis à jour en direct d'après ce que le solveur annonce.

### Les réglages qui comptent

| Réglage | Conseil |
|---|---|
| Écart lame | 1 mm si ta découpe est bien calée, 2 mm sinon |
| Précision | 1 mm. En 2 mm, le quadrillage rajoute à lui seul 2 mm de vide entre les pièces |
| Rotation | tous les 10°. Au-delà, plus de gain mesurable |
| Recherche | Normale au quotidien, Maximale sur les gros kits |
| Longueur max | 0 pour un rouleau libre, ou une valeur pour brider la planche |

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

## Fond perdu

Tu mets une valeur en millimètres et tu cliques **Ajouter le fond perdu**. Le
masque d'écrêtage de la pièce est élargi d'autant, donc le dessin imprimé
déborde du tracé de coupe. Le tracé de coupe, lui, ne bouge jamais : la lame
coupe toujours là où tu l'as dessiné.

Ça travaille sur ta **sélection** si tu en as une, sur tout le document sinon.
Une pièce sans masque d'écrêtage est laissée telle quelle et signalée : sans
masque il n'y a rien à élargir, et étirer le dessin lui-même le déformerait.

Laisse **Compter dans l'écart** cochée, sauf si tu sais ce que tu fais. Deux
pièces voisines qui débordent chacune de 2 mm doivent s'écarter de 4 mm de
plus, sinon le fond perdu de l'une s'imprime sur la découpe de l'autre.

## Repères de découpe

Rond plein, carré plein ou angle en L. Taille, retrait et épaisseur réglables,
posés sur un calque `Regmark` verrouillé après l'imbrication — ils ne mangent pas
de place dans le calcul, et le panneau prévient si une pièce en recouvre un.

Deux préréglages portent de vraies cotes :

- **Valiani** : ronds 10 mm, relevés sur des planches de production
- **Graphtec CE7000 / FC9000** : angles en L, 20 mm, trait 1 mm. Le manuel
  autorise 5 à 20 mm et 0,3 à 1,0 mm, et impose une ligne unique

Summa, Zünd, Roland et Gerber sont volontairement vides. Rien n'est deviné ici :
un repère de la mauvaise taille est invisible à l'écran et fait rater une
planche imprimée. Règle une fois d'après un fichier validé, puis Mémoriser.

## Comment ça marche dedans

Le contour est aplati à 0,08 mm près, sans aucune simplification — c'est ce qui
évite les pièces déformées. Le moteur intégré le rastérise en masque de bits
traité 32 pixels à la fois, et pose chaque pièce en *bottom-left-fill* true-shape :
elle tombe vers le début du rouleau puis glisse à gauche en testant le contour
réel, donc elle entre dans les creux de ses voisines.

Sparrow procède autrement : il pose tout, puis secoue la planche et la comprime,
encore et encore. C'est pour ça qu'il trouve plus court. Le pont lui envoie une
géométrie simplifiée, et rend cette simplification à l'écart de lame — l'écart
réel n'est donc jamais inférieur à celui demandé.

Le panneau tourne dans Chrome, pas dans le moteur de script d'Illustrator : même
code, 30 à 50 fois plus rapide. Illustrator ne fait que lire les pièces et les
reposer.

## Limites connues

- Sparrow est réservé à Windows dans cette version
- une pièce plus large que la laize est tournée automatiquement ; si elle ne
  passe toujours pas, elle est signalée et laissée en place
- pas de miroir automatique : un kit gauche/droite garde ses deux pièces
- pas encore de rapport de production ni de retouche manuelle après coup
- sur un PDF entièrement aplati, sans contour ni groupe, la reconnaissance des
  pièces reste approximative — aucun outil du marché ne fait mieux là-dessus

## Crédits

- [Sparrow](https://github.com/JeroenGar/sparrow) — Jeroen Gardeyn, KU Leuven, MIT
- [jagua-rs](https://github.com/JeroenGar/jagua-rs) — moteur de collision, MIT
- [Clipper](http://www.angusj.com/delphi/clipper.php) — opérations sur polygones, Boost

## Licence

GPL v3. Tu peux t'en servir, le modifier, le redistribuer. Si tu le modifies et
que tu le diffuses, tu diffuses aussi tes modifications.
