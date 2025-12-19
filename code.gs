/****************************************************
 * Boutique Les Acacias — Apps Script côté serveur
 * - UI (index.html) si accès direct
 * - API catalogue (GET ?api=catalog) + JSONP (GET ?api=catalog&callback=...)
 * - API commande (POST { api:"createOrder", payload:{...} })
 *
 * IMPORTANT (GitHub Pages) :
 * - Les navigateurs bloquent souvent le fetch vers script.google.com (CORS).
 * - Le catalogue est donc servi aussi en JSONP (callback=...).
 * - Pour "createOrder" depuis GitHub (POST), il faut soit :
 *    1) héberger l'UI dans Apps Script (google.script.run), soit
 *    2) passer par un proxy CORS (ex: Cloudflare Worker).
 ****************************************************/

/*** CONFIG ***/
const SHEET_ID = "11c43GO9RCULZ22CiajYXVPzvjwynsftCm5p3foTmd0s";
const EMAIL_FOURNISSEUR = "sylvainpoulet@free.fr"; // ← à personnaliser
const TZ = "Europe/Paris";

/*** Utilitaires ***/
function asJson_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// JSONP pour contourner CORS sur GET (GitHub Pages / Safari)
function asJsonp_(callback, obj) {
  const safeCb = String(callback || "").replace(/[^\w$.]/g, "");
  const payload = JSON.stringify(obj);
  return ContentService
    .createTextOutput(`${safeCb}(${payload});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/*** Rendu UI / API ***/
function doGet(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  const api = p.api ? String(p.api) : "";
  const cb  = p.callback ? String(p.callback) : "";

  // --- API ---
  try {
    if (api === "ping") {
      return cb ? asJsonp_(cb, { ok: true, message: "pong" }) : asJson_({ ok: true, message: "pong" });
    }

    if (api === "catalog") {
      const data = getCatalog(); // {products, variants, packItems, options}
      return cb ? asJsonp_(cb, data) : asJson_(data);
    }

    // si pas d'api => UI
  } catch (err) {
    const out = { ok: false, error: (err && err.message) ? err.message : String(err) };
    return cb ? asJsonp_(cb, out) : asJson_(out);
  }

  // --- UI ---
  return HtmlService
    .createTemplateFromFile("index")
    .evaluate()
    .setTitle("Boutique Les Acacias")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    const body = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    if (body && body.api === "createOrder") {
      const res = createOrder(body.payload);
      return asJson_(res);
    }
    return asJson_({ ok: false, error: "Action inconnue" });
  } catch (err) {
    return asJson_({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

/*** Lecture du catalogue ***/
function getCatalog() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const products = sheetToObjects(ss.getSheetByName("Products"));
  const variants = sheetToObjects(ss.getSheetByName("Variants"));
  const packItems = sheetToObjects(ss.getSheetByName("PackItems"));
  const options = {
    colors_default: ["Bleu", "Blanc", "Noir", "Rose"],
    logo: ["Tennis", "Padel", "Aucun"]
  };
  return { products, variants, packItems, options };
}

function sheetToObjects(sheet) {
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues().filter(r => r.join("") != "");
  if (!values.length) return [];
  const header = values[0];
  const rows = values.slice(1);
  return rows.map(r => {
    const o = {};
    header.forEach((h, i) => o[h] = r[i]);
    return o;
  });
}

/*** Création PDF + e-mail ***/
function createOrder(payload) {
  try {
    // 1) Sécurité / nettoyage
    if (!payload || !payload.items || !payload.items.length) {
      throw new Error("Panier vide");
    }
    const customer = payload.customer || {};
    if (!customer.name || !customer.email) {
      throw new Error("Nom et e-mail obligatoires");
    }

    // 2) Build order object attendu par pdf.html
    const order_id = "CMD" + Utilities.getUuid().slice(0, 8).toUpperCase();
    const order = {
      customer: {
        name: String(customer.name || "").trim(),
        email: String(customer.email || "").trim(),
        phone: String(customer.phone || "").trim()
      },
      items: payload.items.map(it => ({
        title: it.title,
        color: it.color,
        size: it.size,
        gender: it.gender,
        logo: it.logo,
        flocage_text: it.flocage_text,
        qty: Number(it.qty) || 1,
        price: Number(it.price) || 0,
        image_url: it.image_url || ""
      })),
      total: Number(payload.total) || 0
    };

    // 3) Enregistrer dans Sheets (dans le fichier pointé par SHEET_ID)
    const ss = SpreadsheetApp.openById(SHEET_ID);

    const ordersSh = ss.getSheetByName("Orders") || ss.insertSheet("Orders");
    if (ordersSh.getLastRow() === 0) {
      ordersSh.appendRow(["order_id", "date", "client", "email", "phone", "total"]);
    }
    ordersSh.appendRow([
      order_id,
      Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm"),
      order.customer.name,
      order.customer.email,
      order.customer.phone,
      order.total
    ]);

    const itemsSh = ss.getSheetByName("OrderItems") || ss.insertSheet("OrderItems");
    if (itemsSh.getLastRow() === 0) {
      itemsSh.appendRow(["order_id", "title", "color", "size", "gender", "logo", "flocage", "qty", "price"]);
    }
    order.items.forEach(it => {
      itemsSh.appendRow([order_id, it.title, it.color, it.size, it.gender, it.logo, it.flocage_text, it.qty, it.price]);
    });

    // 4) Générer le PDF
    const t = HtmlService.createTemplateFromFile("pdf");
    t.order = order;
    t.order_id = order_id;
    const blobPdf = t.evaluate().getBlob().getAs("application/pdf");
    blobPdf.setName(order_id + ".pdf");
    const file = DriveApp.createFile(blobPdf);

    // 5) Email au fournisseur
    const subject = "Commande " + order_id;
    const body =
      "Commande " + order_id + " — total " + order.total.toFixed(2) + "€\n\n" +
      "Client : " + order.customer.name + "\n" +
      "Email  : " + order.customer.email + "\n" +
      (order.customer.phone ? ("Tel    : " + order.customer.phone + "\n") : "") +
      "\nPDF : " + file.getUrl();

    GmailApp.sendEmail(EMAIL_FOURNISSEUR, subject, body, { attachments: [file] });

    // 6) Réponse à l’UI
    return { ok: true, order_id: order_id, pdfUrl: file.getUrl() };

  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}
