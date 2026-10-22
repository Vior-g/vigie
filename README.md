# Vigie — overlay d'aide aux combats de boss (Dofus 3)

Vigie affiche par-dessus Dofus une fiche de combat qui suit tout seul le donjon où tu te trouves : résistances, mécaniques, sorts, monstres, stratégie, succès, et des rappels qui changent à chaque tour. Pour le Comte Harebourg, il montre directement sur la grille du jeu la case à cliquer pour le toucher malgré la confusion horaire.

Première version : les 5 boss de Frigost III (Missiz Frizz, Sylargh, Klime, Nileza, Comte Harebourg).

## Comment il fonctionne (et ce qu'il ne fait pas)

- **Détection** : toutes les 2 secondes, Vigie capture l'écran, lit le nom de la map en haut à gauche avec un OCR local (Tesseract, langue française embarquée) et le compare aux donjons connus. Il reconnaît aussi les noms de monstres et les coordonnées d'entrée des donjons.
- **Lecture seule** : aucune lecture de la mémoire du jeu, aucune interception réseau, aucun fichier du jeu modifié, aucun clic ni touche envoyé au jeu. Les fenêtres de Vigie sont invisibles aux captures (pour que l'OCR ne se lise pas lui-même).
- **Statistiques** : niveaux, PV et résistances viennent de l'API publique [DofusDB](https://dofusdb.fr), mises en cache 7 jours. Hors ligne, les fiches gardent leurs valeurs intégrées.
- **À savoir** : un overlay qui capture l'écran reste un outil tiers. Il ne fait rien d'autre que t'afficher des infos, mais relis les conditions d'Ankama ; usage perso, à tes risques.

## Installation

**Version prête à l'emploi** : dézippe `Vigie-win-x64.zip` où tu veux, puis lance `Vigie\Vigie.exe`. L'exécutable n'est pas signé : Windows SmartScreen peut afficher un avertissement (« Informations complémentaires » → « Exécuter quand même »).

**Depuis les sources** (Node.js 22 ou plus) :

```
npm install
npm start          # lance Vigie
npm test           # tests (géométrie, fiches, reconnaissance, OCR)
npm run dist       # reconstruit dist/win-unpacked/Vigie.exe
```

## Premier lancement (5 minutes)

1. Lance Dofus en **fenêtré** ou **plein écran fenêtré** (pas en plein écran exclusif).
2. Lance Vigie : le panneau apparaît à droite, une icône (losange doré) arrive dans la zone de notification.
3. **Zone de lecture** : ⚙ Réglages → « Définir la zone de lecture », puis encadre à la souris le nom de la map et ses coordonnées en haut à gauche du jeu, et valide avec Entrée.
4. Toujours dans les réglages, regarde « Dernière lecture » : tu dois y voir l'image lue en noir sur blanc et le texte reconnu. Si le texte est vide ou faux, ajuste le **seuil** (plus bas si le texte du jeu est grisé) ou l'agrandissement.
5. **Grille de combat** (pour la visée Harebourg) : en combat, ⚙ → « Calibrer la grille de combat ». Clique au centre d'une case, ajuste la taille à la molette jusqu'à ce que la grille dorée colle aux cases du jeu, glisse pour la caler, puis Entrée. Le calibrage est mémorisé pour la taille de fenêtre actuelle.

## Raccourcis (modifiables dans les réglages)

| Raccourci | Action |
|---|---|
| `Ctrl+Alt+O` | Afficher / masquer le panneau |
| `Ctrl+Alt+F` | Chercher un boss ou un monstre |
| `Ctrl+Alt+H` | Visée Harebourg : 1er appui = ta case (sous la souris), 2e appui = la cible |
| `Ctrl+Alt+Maj+H` | Effacer les repères de visée |
| `Ctrl+Alt+T` / `Ctrl+Alt+Maj+T` | Tour suivant / précédent |
| `Ctrl+Alt+R` | Revenir au tour 1 |
| `Ctrl+Alt+D` | Relire l'écran tout de suite |

Ces combinaisons ne produisent aucun caractère sur un clavier AZERTY (contrairement à `Ctrl+Alt+chiffre`, qui donne `@`, `#`…), donc elles ne gênent pas le chat du jeu.

## Le compteur de tours

Il pilote les rappels affichés sous le nom du boss (par exemple « Tour pair : frapper le Comte le téléporte… », « Cristallisation : ne retire pas de PM », « Au tour 5, Pacifiste au-delà de 9 PO »). Vigie ne lit pas le numéro de tour à l'écran : avance-le avec `Ctrl+Alt+T` au début de chaque tour. Il repart à 1 quand tu changes de donjon.

## Comte Harebourg : taper en direct

Onglet **Visée** de la fiche :

1. Choisis ta confusion du tour (90° horaire, 180°, 90° anti-horaire), ou tape tes PV en % pour la présélectionner.
2. Indique les lignes de dégâts déjà infligées au corps à corps ce tour : chacune décale la confusion d'un quart de tour.
3. **Dans le jeu** : survole ta case → `Ctrl+Alt+H`, survole le Comte (ou un monstre) → `Ctrl+Alt+H`. Le calque affiche :
   - en **vert**, la case à cliquer ;
   - en **orange pointillé**, où tomberait un tir visé directement sur la cible ;
   - en **violet**, l'arrivée de la téléportation (tour pair : le Comte passe de l'autre côté de toi ; tour impair : c'est toi qui passes de l'autre côté du Comte). Vérifie que ce n'est ni un obstacle ni un trou.
4. Le simulateur du panneau fait la même chose sans toucher au jeu (clic gauche : toi, clic droit : la cible).

Rien n'est cliqué à ta place : c'est toi qui cliques la case verte.

## À vérifier lors de tes premiers combats

Les guides ne sont pas toujours d'accord. Tout se corrige dans les réglages ou dans les fiches :

- **Paliers de confusion** : table par défaut tirée du guide de Papycha (100–91 % horaire, 90–75 % anti-horaire, 74–46 % 180°, 45–31 % anti-horaire, 30–0 % horaire). JeuxOnLine décrit un découpage en 3 couleurs. Fie-toi à l'état affiché en combat et corrige la table si besoin.
- **Sens du décalage au CàC** : anti-horaire selon 3 sources sur 4. Réglable.
- **Nileza** : distances de Pacifiste 11/9/7/5 PO (le même guide cite aussi 12/10/8/6).
- **Sylargh** : distance pour lever l'invulnérabilité donnée à 5-10 PO ou 6-10 PO selon les passages.
- **Zone de lecture** : la valeur par défaut couvre le coin haut-gauche ; redéfinis-la si l'interface de Dofus 3 place le nom de la map ailleurs chez toi.

## Ajouter tes propres fiches (avis de recherche, autres donjons)

⚙ → « Ouvrir le dossier » ouvre `%APPDATA%\Vigie\fiches`. Dépose-y des fichiers `.json` au même format que ceux de `src/data/bosses/`, puis « Recharger les fiches ». Une fiche perso avec le même `id` remplace celle d'origine.

Champs principaux :

```json
{
  "id": "avis-exemple",
  "nom": "Nom du monstre",
  "donjon": "Nom affiché en haut à gauche du jeu (sert à la détection)",
  "zone": "Avis de recherche",
  "stats": { "niveau": 100, "pv": [1000, 1200], "pa": 8, "pm": 4,
             "res": { "neutre": 0, "terre": 0, "feu": 0, "eau": 0, "air": 0 } },
  "detection": { "alias": ["autres textes à reconnaître"], "coords": ["12,-5"] },
  "essentiel": ["Les 3 à 6 choses à savoir absolument"],
  "mecaniques": [{ "titre": "…", "texte": "…" }],
  "sortsBoss": [{ "nom": "…", "texte": "…" }],
  "monstres": [{ "nom": "…", "danger": "haut", "texte": "…" }],
  "strategie": ["Étape 1", "Étape 2"],
  "pieges": ["…"],
  "tours": [{ "from": 2, "every": 3, "level": "alerte", "text": "Rappel aux tours 2, 5, 8…" },
            { "parity": "pair", "level": "info", "text": "Rappel aux tours pairs" }],
  "succes": [{ "nom": "…", "texte": "…" }],
  "acces": ["Position, clé, prérequis"],
  "sources": [{ "titre": "…", "url": "https://…" }]
}
```

`tours` : `from` (premier tour), `to` (dernier tour), `every` (périodicité), `parity` (`pair`/`impair`), `level` (`info`, `alerte`, `danger`).

## Dépannage

- **Rien n'est reconnu** : vérifie la zone de lecture et « Dernière lecture » dans les réglages. Si la fenêtre du jeu n'est pas vue (« En attente de la fenêtre Dofus… »), adapte « Processus du jeu » (par défaut `^dofus`).
- **Un raccourci ne marche pas** : un autre logiciel l'utilise déjà ; les réglages listent ceux qui ont échoué. Change-le et « Appliquer ».
- **Le panneau n'apparaît pas dans mon stream** : c'est voulu (« Invisible aux captures »). Décoche l'option si tu veux le montrer ; l'OCR peut alors se lire lui-même si le panneau recouvre la zone de lecture.
- **Multi-compte** : Vigie suit la fenêtre Dofus au premier plan et retient la fiche de chaque fenêtre ; il fonctionne avec Relais.

## Organisation du code

```
src/main/       processus principal : fenêtres, raccourcis, détection, DofusDB
src/core/       logique pure testée : géométrie Harebourg, reconnaissance, règles de tours, traitement d'image
src/renderer/   panneau (panel.*) et calque posé sur le jeu (board.*)
src/data/bosses fiches des boss (JSON)
test/           tests unitaires + OCR sur captures simulées, visite guidée de l'interface (npm run e2e)
```

## Sources

- Dofus pour les Noobs : guides des donjons [Comte Harebourg](https://www.dofuspourlesnoobs.com/donjon-du-comte-harebourg.html), [Missiz Frizz](https://www.dofuspourlesnoobs.com/forgefroide-de-missiz-frizz.html), [Sylargh](https://www.dofuspourlesnoobs.com/transporteur-de-sylargh.html), [Klime](https://www.dofuspourlesnoobs.com/salons-priveacutes-de-klime.html), [Nileza](https://www.dofuspourlesnoobs.com/laboratoire-de-nileza.html)
- [Le Bazar de Papycha](https://papycha.fr/donjon-du-comte-harebourg/) (table des confusions)
- [JeuxOnLine](https://dofus.jeuxonline.info/article/13413/donjon-comte-harebourg)
- [DofusDB](https://dofusdb.fr) (statistiques, positions d'entrée)

## Publier une nouvelle version

Le dépôt contient un workflow GitHub Actions (`.github/workflows/release.yml`) :

- chaque push sur `main` lance les tests et construit Vigie (zip téléchargeable dans l'onglet **Actions**) ;
- chaque tag `vX.Y.Z` fait la même chose puis publie une **Release** avec `Vigie-win-x64.zip`.

```
npm version patch      # 0.1.0 -> 0.1.1, crée le commit et le tag
git push --follow-tags
```
