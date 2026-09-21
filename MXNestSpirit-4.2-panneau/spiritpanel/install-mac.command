#!/bin/bash
cd "$(dirname "$0")"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/MXNestSpirit"
for V in 5 6 7 8 9 10 11 12; do defaults write com.adobe.CSXS.$V PlayerDebugMode 1 2>/dev/null; done
rm -rf "$DEST"; mkdir -p "$DEST"
rsync -a --exclude 'install-mac.command' --exclude 'install-windows.bat' ./ "$DEST/"
echo "Termine. Relance Illustrator : Fenetre > Extensions > MXNestSpirit"
read -n 1 -s -r -p "Appuie sur une touche."
