# Boutique Les Acacias — prise en main rapide

Cette version charge désormais uniquement le catalogue depuis Google Sheets (via `code.gs`). Les sections ci-dessous expliquent comment ajouter des couleurs, des articles et ajuster le catalogue dans la feuille.

## Ajouter / modifier des produits

Fichier : `code.gs`

1. Renseignez `SHEET_ID` avec l'identifiant de votre fichier Sheets.
2. Créez les onglets `Products`, `Variants`, `PackItems` et alimentez-les avec les colonnes listées ci-dessus.
3. Déployez le script Apps Script comme application web et ouvrez l'URL fournie.

L'onglet `Orders` / `OrderItems` est créé automatiquement lors d'une commande.

## Ajouter ou changer les couleurs

- **Couleurs proposées** : mettez à jour la colonne `color` dans l'onglet `Variants` pour des couleurs spécifiques par article.
- **Couleurs affichées (pastilles)** : ajoutez le couple nom → hex dans la fonction `colorToHex` de `app.js` pour que la pastille affiche la bonne couleur.

## Ajouter des logos ou options globales

- Dans `code.gs`, modifiez l'objet `options` renvoyé par `getCatalog` si vous souhaitez gérer ces paramètres côté feuille.

## Ajouter un pack

1. Ajoutez un produit avec `type: "pack"` dans `products`.
2. Ajoutez les lignes correspondantes dans `packItems` (un item par article inclus).
3. Ajoutez au besoin des `variants` si les tailles/couleurs diffèrent des valeurs par défaut.

## Déployer côté Google Apps Script

1. Dans `code.gs`, renseignez `SHEET_ID` avec votre fichier Google Sheets.
2. Déployez le projet en application web (`Publier` > `Déployer en tant qu'application web`). Conservez l'URL `https://script.google.com/macros/s/.../exec`.
3. Sur l'hébergement statique (ex : GitHub Pages), définissez la constante `APPS_SCRIPT_DEPLOY` dans `app.js` avec cette URL. Le front fera alors un `fetch` CORS vers Apps Script pour charger le catalogue et créer les commandes.

> Si `APPS_SCRIPT_DEPLOY` n'est pas renseigné, le front affichera un message expliquant que l'URL manque.

## Tester rapidement l'interface

1. Dans le dossier du projet, lancez `python3 -m http.server 8000`.
2. Ouvrez `http://localhost:8000/index.html`.
3. Le catalogue ne se chargera pas sans Apps Script, mais cela permet de vérifier le rendu visuel avant de publier.
