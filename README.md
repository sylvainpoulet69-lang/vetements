# Boutique Les Acacias — prise en main rapide

Cette version fonctionne en local (via `catalog.json`) **ou** en mode Google Sheets (via `code.gs`). Les sections ci-dessous expliquent comment ajouter des couleurs, des articles et ajuster le catalogue.

## Ajouter / modifier des produits

### En local (catalog.json)
Fichier : `catalog.json`

- **products** : chaque ligne représente un article (`product_id`, `title`, `category`, `price`, `image_url`, `type`, `active`). Mettez `type` à `pack` pour un pack, sinon `simple`.
- **variants** : précisez les tailles/couleurs/genre disponibles (`product_id`, `color`, `gender_scope`, `size_list`). Laissez `size_list` vide pour utiliser les tailles par défaut.
- **packItems** : pour un pack, listez les articles inclus (`pack_id` = `product_id` du pack, `product_id` de l'article, `title`, `qty`).
- **options** : paramètres généraux (`colors_default`, `logo`).

Enregistrez puis rechargez la page pour voir le nouveau catalogue.

### Avec Google Sheets (Apps Script)
Fichier : `code.gs`

1. Renseignez `SHEET_ID` avec l'identifiant de votre fichier Sheets.
2. Créez les onglets `Products`, `Variants`, `PackItems` et alimentez-les avec les colonnes listées ci-dessus.
3. Déployez le script Apps Script comme application web et ouvrez l'URL fournie.

L'onglet `Orders` / `OrderItems` est créé automatiquement lors d'une commande.

## Ajouter ou changer les couleurs

- **Couleurs proposées** : mettez à jour `options.colors_default` dans `catalog.json`, ou la colonne `color` dans l'onglet `Variants` pour des couleurs spécifiques par article.
- **Couleurs affichées (pastilles)** : ajoutez le couple nom → hex dans la fonction `colorToHex` de `app.js` pour que la pastille affiche la bonne couleur.

## Ajouter des logos ou options globales

- Dans `catalog.json`, ajustez `options.logo` pour proposer de nouveaux logos.
- Dans `code.gs`, modifiez l'objet `options` renvoyé par `getCatalog` si vous souhaitez gérer ces paramètres côté feuille.

## Ajouter un pack

1. Ajoutez un produit avec `type: "pack"` dans `products`.
2. Ajoutez les lignes correspondantes dans `packItems` (un item par article inclus).
3. Ajoutez au besoin des `variants` si les tailles/couleurs diffèrent des valeurs par défaut.

## Tester rapidement en local

1. Dans le dossier du projet, lancez `python3 -m http.server 8000`.
2. Ouvrez `http://localhost:8000/index.html`.
3. Rechargez la page après chaque modification pour voir le rendu.
