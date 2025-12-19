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


---

## Mode GitHub Pages (recommandé) : catalogue via Workflow + commandes via Cloudflare Worker

### 1) Catalogue : Google Sheets → `data/catalog.json` (auto)

- Le site GitHub Pages charge par défaut `./data/catalog.json` (voir `window.CATALOG_URL` dans `app.js`).
- Un workflow GitHub Actions (`.github/workflows/sync-catalog.yml`) synchronise automatiquement le catalogue depuis votre Google Sheet vers `data/catalog.json`.

**À configurer dans GitHub → Settings → Secrets and variables → Actions :**
- `SHEET_ID` : l’ID de votre Google Sheet
- `GOOGLE_SERVICE_ACCOUNT_JSON` : le JSON complet d’un compte de service Google

**Google Sheet :**
- Partagez la feuille avec l’email du compte de service (Editor).
- Onglets attendus : `Products`, `Variants`, `PackItems` (optionnel : `Options`).

### 2) Commandes : Cloudflare Worker → Google Sheets (write fiable)

Le front **n’écrit plus** vers Apps Script (ou seulement en fallback).  
Pour que les commandes fonctionnent à merveille depuis GitHub Pages, utilisez le Worker fourni : `worker/worker.js`.

**Cloudflare :**
1. Créez un Worker (Wrangler ou UI Cloudflare).
2. Collez le code `worker/worker.js`.
3. Ajoutez des variables/secrets :
   - `SHEET_ID` (même valeur)
   - `GOOGLE_SERVICE_ACCOUNT_JSON` (même JSON)
   - Optionnel : `ORDERS_SHEET_NAME` (défaut `Orders`)
   - Optionnel : `ITEMS_SHEET_NAME` (défaut `OrderItems`)
4. Déployez. Vous obtenez une URL du type :
   - `https://xxxxxxx.workers.dev/api/order`

**Front (`app.js`) :**
- Renseignez `window.ORDER_API_URL = "https://xxxxxxx.workers.dev/api/order";`

### 3) À propos d’Apps Script (fallback)

Vous pouvez garder Apps Script pour certaines fonctions, mais en GitHub Pages :
- lecture catalogue : mieux via `data/catalog.json` (zéro CORS)
- écriture commandes : mieux via Worker (zéro souci POST/CORS)

