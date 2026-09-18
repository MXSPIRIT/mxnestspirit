# Mettre MXNestSpirit 1.1 en ligne

## 1. Faire le ménage dans le dépôt

Sur github.com/MXSPIRIT/mxnestspirit :

**Supprimer un fichier** : tu cliques dessus, puis l'icône corbeille en haut à
droite, puis "Commit changes" en bas.

**Supprimer un dossier entier** : GitHub ne le propose pas directement. Le plus
rapide est de supprimer le dépôt et de le refaire — Settings du dépôt, tout en
bas, "Delete this repository", tu tapes le nom pour confirmer. Puis "New
repository", nom `mxnestspirit`, Public, Create.

**Supprimer une ancienne version publiée** : onglet Releases, tu cliques sur la
release, bouton "Delete" en haut à droite. Supprime aussi le tag quand il te le
propose.

## 2. Déposer les fichiers

Sur la page du dépôt : "Add file" > "Upload files", puis tu glisses :

- README.md
- README-fr.md
- LICENSE
- le dossier spiritpanel (glisse le dossier entier, l'arborescence est gardée)

"Commit changes".

## 3. Publier la version téléchargeable

Onglet Releases > "Create a new release" :

- Tag : v1.1
- Titre : MXNestSpirit 1.1 — moteur Sparrow
- Description : colle les trois lignes ci-dessous
- Glisse le zip du panneau dans "Attach binaries"
- "Publish release"

Texte de la release :

    Nouveau moteur Sparrow (KU Leuven, MIT) en plus du moteur intégré.
    Sur un kit réel de 83 pièces : 0,721 m contre 0,800 m, soit 10 % de vinyle
    en moins par planche.
    Sparrow fonctionne sous Windows uniquement ; sur Mac le panneau retombe sur
    le moteur intégré.

## 4. Le lien à partager

    https://github.com/MXSPIRIT/mxnestspirit/releases

C'est celui-là qu'il faut donner : il tombe directement sur le téléchargement.

## 5. Voir combien de gens viennent

Onglet Insights > Traffic : visites et visiteurs uniques sur 14 jours, avec la
provenance. Et dans Releases, chaque fichier affiche son nombre de
téléchargements — c'est le chiffre qui compte vraiment.
