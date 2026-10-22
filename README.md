# Vigie — overlay d'aide aux combats (Dofus 3)

Vigie affiche par-dessus Dofus une fiche de combat qui suit tout seule l'endroit où tu te trouves :

- **Tous les donjons du jeu** (187, expéditions comprises) : boss, résistances, PA/PM, esquives, sorts complets, monstres du donjon. **129 donjons ont un guide de mécaniques** (essentiel, mécaniques, stratégie, pièges, succès, accès, rappels tour par tour) ; les autres ont une synthèse tirée des données du jeu.
- **Mode Combat / Songe** : en survolant un groupe de monstres (ou un monstre en combat) et en appuyant sur `Ctrl+Alt+M`, Vigie lit leurs noms à l'écran et affiche leurs résistances, l'élément à jouer contre le groupe, leurs sorts, et les conseils des guides. Pratique dans les **Songes Infinis**, où les groupes sont tirés de tout le bestiaire.
- **Songes Infinis** : règles, intensités, boss final et vagues, les 16 **Aberrations** et leur effet, les avis de recherche des songes.
- **Comte Harebourg** : la case à cliquer pour le toucher malgré la confusion horaire, affichée directement sur la grille du jeu.
- **Recherche** sur tous les donjons, boss et 5 000+ monstres (`Ctrl+Alt+F`).

## Comment il fonctionne (et ce qu'il ne fait pas)

- **Détection du lieu** : toutes les 2 secondes, Vigie capture l'écran, lit le nom de la zone en haut à gauche avec un OCR local (Tesseract, français embarqué) et ouvre la fiche du donjon ou le mode Songe.
- **Lecture des monstres** : uniquement quand tu appuies sur `Ctrl+Alt+M` : Vigie lit la zone autour de ta souris (infobulle d'un groupe, d'un monstre, de la timeline). Un niveau lu à côté du nom (« Craqueleur (210) ») choisit la bonne version du monstre (normale ou expédition niv. 200+).
- **Lecture seule** : aucune lecture de la mémoire du jeu, aucune interception réseau, aucun fichier du jeu modifié, aucun clic ni touche envoyé au jeu. Les fenêtres de Vigie sont invisibles aux captures (pour que l'OCR ne se lise pas lui-même).
- **Données** : bestiaire, sorts et donjons sont générés chaque semaine depuis l'API publique [DofusDB](https://dofusdb.fr) ; les guides sont résumés et reformulés depuis [Dofus pour les Noobs](https://www.dofuspourlesnoobs.com). Vigie télécharge tout seul les données et guides mis à jour depuis ce dépôt GitHub (seuls les fichiers modifiés).
- **Mise à jour du logiciel** (comme Relais) : au démarrage, Vigie regarde la dernière Release ; si une version plus récente existe, un bandeau propose « Mettre à jour ». Vigie télécharge seulement ce qui a changé (le code seul pèse quelques Mo), se ferme, remplace ses fichiers et redémarre. En cas d'échec, l'ancienne version est remise en place (journal : `resources\mise-a-jour.log`).
- **À savoir** : un overlay qui capture l'écran reste un outil tiers. Il ne fait rien d'autre que t'afficher des infos, mais relis les conditions d'Ankama ; usage perso, à tes risques.

## Installation

**Version prête à l'emploi** : dans [Releases](https://github.com/Vior-g/vigie/releases), télécharge `Vigie-win-x64.zip`, dézippe-le dans un dossier à toi (Documents, Bureau… pas dans Program Files, sinon Vigie ne pourra pas se mettre à jour), puis lance `Vigie\Vigie.exe`. L'exécutable n'est pas signé : Windows SmartScreen peut afficher un avertissement (« Informations complémentaires » → « Exécuter quand même »). Ensuite, Vigie se met à jour tout seul ; tes réglages sont conservés.

**Depuis les sources** (Node.js 22 ou plus) :

```
npm install
npm start          # lance Vigie
npm test           # tests (géométrie, guides, données, reconnaissance, mises à jour, OCR)
npm run dist       # reconstruit dist/win-unpacked/Vigie.exe
```

## Premier lancement (5 minutes)

1. Lance Dofus en **fenêtré** ou **plein écran fenêtré** (pas en plein écran exclusif).
2. Lance Vigie : le panneau apparaît à droite, une icône arrive dans la zone de notification.
3. **Zone de lecture** : ⚙ Réglages → « Définir la zone de lecture », encadre à la souris le nom de la zone et ses coordonnées en haut à gauche du jeu, puis Entrée.
4. Toujours dans les réglages, regarde « Dernière lecture » : tu dois y voir l'image lue en noir sur blanc et le texte reconnu. Si le texte est vide ou faux, ajuste le **seuil** (plus bas si le texte du jeu est grisé) ou l'agrandissement.
5. **Monstres** : survole un groupe sur la carte et appuie sur `Ctrl+Alt+M`. Si rien n'est reconnu, « Tester la lecture des monstres » dans les réglages montre l'image et le texte lus ; agrandis la zone autour du curseur si l'infobulle sort du cadre.
6. **Grille de combat** (pour la visée Harebourg) : en combat, ⚙ → « Calibrer la grille de combat ». Clique au centre d'une case, ajuste la taille à la molette jusqu'à ce que la grille dorée colle aux cases du jeu, glisse pour la caler, puis Entrée.

## Raccourcis (modifiables dans les réglages)

| Raccourci | Action |
|---|---|
| `Ctrl+Alt+M` | Lire les noms de monstres sous la souris (ajoute à la liste du combat) |
| `Ctrl+Alt+Maj+M` | Vider la liste des monstres |
| `Ctrl+Alt+O` | Afficher / masquer le panneau |
| `Ctrl+Alt+F` | Chercher un donjon, un boss ou un monstre |
| `Ctrl+Alt+H` | Visée Harebourg : 1er appui = ta case (sous la souris), 2e appui = la cible |
| `Ctrl+Alt+Maj+H` | Effacer les repères de visée |
| `Ctrl+Alt+T` / `Ctrl+Alt+Maj+T` | Tour suivant / précédent |
| `Ctrl+Alt+R` | Revenir au tour 1 |
| `Ctrl+Alt+D` | Relire le lieu tout de suite |

Ces combinaisons ne produisent aucun caractère sur un clavier AZERTY (contrairement à `Ctrl+Alt+chiffre`, qui donne `@`, `#`…), donc elles ne gênent pas le chat du jeu.

## En Songe

1. En entrant dans les Songes, Vigie passe en **mode Songe** (fiche « Songes Infinis » : règles, Aberrations, avis de recherche).
2. Avant chaque combat, survole le groupe et appuie sur `Ctrl+Alt+M` : l'onglet **Combat** liste les monstres, l'élément conseillé contre le groupe (résistances moyennes pondérées par les PV) et celui à éviter. Chaque carte donne PV, PA/PM, esquives, résistances, sorts dépliables et le conseil du guide de leur donjon d'origine.
3. Si une **Aberration** est active (icône en haut à droite), survole-la et appuie sur `Ctrl+Alt+M` : son effet s'affiche en tête de la liste et sur la carte du boss concerné.
4. Une nouvelle lecture moins de 2 minutes après la précédente complète la liste ; au-delà, elle la remplace (nouveau combat). Durée réglable.
5. **Niveau des monstres** : en Songe, le niveau des monstres suit l'étage. Vigie affiche chaque monstre au niveau lu dans l'infobulle (sinon au niveau réglé à côté du bouton « Songe »), avec ses PV estimés grâce à la courbe de PV du jeu (`≈`) ; en combat, survoler un monstre et appuyer sur `Ctrl+Alt+M` affiche ses PV réels. Résistances, PA/PM et sorts sont ceux du monstre. Le mode Songe s'active tout seul dans les Songes ou quand un niveau lu ne correspond pas au monstre classique ; le bouton « Songe » permet de le forcer.

## Le compteur de tours

Il pilote les rappels affichés sous le nom du boss (« Tour pair : frapper le Comte le téléporte… », « Cristallisation : ne retire pas de PM », « Au tour 5, Pacifiste au-delà de 9 PO »…). Vigie ne lit pas le numéro de tour à l'écran : avance-le avec `Ctrl+Alt+T` au début de chaque tour. Il repart à 1 quand tu changes de donjon.

## Comte Harebourg : taper en direct

Onglet **Visée** de la fiche :

1. Choisis ta confusion du tour (90° horaire, 180°, 90° anti-horaire), ou tape tes PV en % pour la présélectionner.
2. Indique les lignes de dégâts déjà infligées au corps à corps ce tour : chacune décale la confusion d'un quart de tour.
3. **Dans le jeu** : survole ta case → `Ctrl+Alt+H`, survole le Comte (ou un monstre) → `Ctrl+Alt+H`. Le calque affiche en **vert** la case à cliquer, en **orange pointillé** où tomberait un tir direct, en **violet** l'arrivée de la téléportation.
4. Le simulateur du panneau fait la même chose sans toucher au jeu (clic gauche : toi, clic droit : la cible).

Rien n'est cliqué à ta place : c'est toi qui cliques la case verte.

## Ajouter tes propres guides

⚙ → « Ouvrir le dossier perso » ouvre `%APPDATA%\Vigie\fiches`. Dépose-y des fichiers `.json` au même format que ceux de [`src/data/guides/`](src/data/guides), puis « Recharger ». Un guide perso portant le même nom de fichier remplace celui d'origine. Le guide est rattaché au donjon dont le nom (`dj`) ou le boss (`boss`) correspond.

```json
{
  "dj": "Nom du donjon tel qu'affiché en jeu",
  "boss": "Nom du boss",
  "essentiel": ["Les 3 à 6 choses à savoir absolument"],
  "mecaniques": [{ "t": "Titre", "x": "Explication" }],
  "sorts": [{ "n": "Sort", "x": "Ce qu'il fait" }],
  "monstres": [{ "n": "Monstre", "d": "haut", "x": "Conseil" }],
  "strategie": ["Étape 1", "Étape 2"],
  "pieges": ["…"],
  "tours": [{ "from": 2, "every": 3, "level": "alerte", "text": "Rappel aux tours 2, 5, 8…" },
            { "parity": "pair", "text": "Rappel aux tours pairs" }],
  "succes": [{ "n": "Succès", "x": "Condition" }],
  "acces": ["Position, clé, prérequis"],
  "src": "https://…"
}
```

`tours` : `from` (premier tour), `to` (dernier tour), `every` (périodicité), `parity` (`pair`/`impair`), `level` (`info`, `alerte`, `danger`). `monstres[].d` : `haut`, `moyen` ou `bas`.

## Dépannage

- **Le lieu n'est pas reconnu** : vérifie la zone de lecture et « Dernière lecture » dans les réglages. Si la fenêtre du jeu n'est pas vue (« En attente de la fenêtre Dofus… »), adapte « Processus du jeu » (par défaut `^dofus`).
- **Les monstres ne sont pas reconnus** : garde la souris sur le groupe pendant l'appui pour que l'infobulle soit visible, puis regarde « Tester la lecture des monstres ». Tu peux aussi chercher un monstre par son nom.
- **Un raccourci ne marche pas** : un autre logiciel l'utilise déjà ; les réglages listent ceux qui ont échoué. Change-le et « Appliquer ».
- **Le panneau n'apparaît pas dans mon stream** : c'est voulu (« Invisible aux captures »). Décoche l'option si tu veux le montrer ; l'OCR peut alors se lire lui-même.
- **Multi-compte** : Vigie suit la fenêtre Dofus au premier plan et retient la fiche de chaque fenêtre ; il fonctionne avec Relais.

## Organisation du code

```
src/main/        processus principal : fenêtres, raccourcis, capture, OCR, mises à jour
src/core/        logique pure testée : données et fiches, reconnaissance, géométrie Harebourg, tours, image
src/renderer/    panneau (panel.*) et calque posé sur le jeu (board.*)
src/data/        guides (guides/), Songes (songes.json), données générées (generated/), manifeste
scripts/         build-data.mjs (DofusDB → generated/), build-manifest.mjs
test/            tests unitaires + OCR sur captures simulées, visite guidée de l'interface (npm run e2e)
```

## Données et publication

- **Données du jeu** : le workflow « Données du jeu » régénère `src/data/generated/` depuis DofusDB chaque mercredi (et à la demande), puis le manifeste. Les Vigie installés récupèrent les fichiers modifiés au démarrage.
- **Guides** : après modification d'un guide, lance `npm run manifest` (le test échoue sinon).
- **Nouvelle version** : à chaque push sur `main`, GitHub Actions teste, construit et vérifie Vigie. Si la version de `package.json` n'a pas encore de Release, il la publie avec `Vigie-win-x64.zip` (complet) et les paquets de mise à jour (`vigie-app.zip`, `vigie-modules.zip`, `vigie-update.json`). Les nouveautés affichées dans Vigie viennent de la section correspondante de `CHANGELOG.md`.

```
npm version minor --no-git-tag-version   # 0.2.0 -> 0.3.0
git commit -am "0.3.0 : …"
git push
```

## Sources

- [Dofus pour les Noobs](https://www.dofuspourlesnoobs.com) : guides des donjons (lien sur chaque fiche, onglet Accès) et [Songes Infinis](https://www.dofuspourlesnoobs.com/songes-infinis.html)
- [DofusDB](https://dofusdb.fr) : bestiaire, sorts, donjons
- [Le Bazar de Papycha](https://papycha.fr/donjon-du-comte-harebourg/) (table des confusions de Harebourg), [JeuxOnLine](https://dofus.jeuxonline.info/article/13413/donjon-comte-harebourg)
