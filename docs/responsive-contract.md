# Contrat responsive — libreflow

Règle d'or : un composant est responsive à SON conteneur, pas à la fenêtre.

## Ligne de piste (.tr)
Priorité (cède du moins au plus important) : pochette → album → durée → artiste → titre.
Le titre ne se tronque jamais avant que l'album ait disparu.

## Grille albums/artistes
Cartes en repeat(auto-fill, minmax(fluide, 1fr)). Jamais de nombre de colonnes fixe.

## Player bar
Colonne centrale (transport + progression) prioritaire. Les extras (volume, vitesse,
sleep) cèdent d'abord ; les 3 boutons transport + lecture/pause ne disparaissent jamais.

## Panneaux Queue / EQ
< --bp-compact : overlay. Sinon : poussent #main MAIS #main garde >= 320px.
