/****************************************************
 * Boutique Les Acacias — Apps Script (BACKEND)
 * - UI si accès direct
 * - API catalogue (GET ?api=catalog)
 * - API commande (POST api=createOrder)
 ****************************************************/

/*** CONFIG ***/
const SHEET_ID = "11c43GO9RCULZ22CiajYXVPzvjwynsftCm5p3foTmd0s";
const EMAIL_FOURNISSEUR = "sylvainpoulet@free.fr";
const TZ = "Europe/Paris";

/*** UTILS ***/
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseBody_(e) {
  const raw = e && e.postData && e.postData.contents;
  if (!raw) return null;
  return JSON.parse(raw);
}

/*** ROUTER GET ***/
function doGet(e) {
  const api = e && e.parameter && e.parameter.api ? e.parameter.api : "";

  // ===== API =====
  if (api === "catalog") {
    try {
      return json_(getCatalog_());
    } catch (err) {
      return json_({ ok:false, error:String(err) });
    }
  }

  if (api === "ping") {
    return json_({ ok:true, message:"pong" });
  }

  // ===== UI =====
  return HtmlService.createTemplateFromFile("index")
    .evaluate()
    .setTitle("Boutique Les Acacias")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/*** ROUTER POST ***/
function doPost(e) {
  try {
    const data = parseBody_(e);
    if (!data || !data.api) {
      return json_({ ok:false, error:"POST invalide" });
    }

    if (data.api === "createOrder") {
      return json_(createOrder_(data.payload));
    }

    return json_({ ok:false, error:"API inconnue" });

  } catch (err) {
    return json_({ ok:false, error:String(err) });
  }
}

/*** CATALOGUE ***/
function getCatalog_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  return {
    products:  sheetToObjects_(ss.getSheetByName("Products")),
    variants:  sheetToObjects_(ss.getSheetByName("Variants")),
    packItems: sheetToObjects_(ss.getSheetByName("PackItems")),
    options: {
      colors_default: ["Bleu","Blanc","Noir","Rose"],
      logo: ["Tennis","Padel","Aucun"]
    }
  };
}

function sheetToObjects_(sheet) {
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues().filter(r => r.join("") !== "");
  if (rows.length < 2) return [];
  const headers = rows.shift();
  return rows.map(r => {
    const o = {};
    headers.forEach((h,i)=>o[h]=r[i]);
    return o;
  });
}

/*** COMMANDE / PDF / EMAIL ***/
function createOrder_(payload) {
  if (!payload || !payload.items || !payload.items.length) {
    throw new Error("Panier vide");
  }

  const c = payload.customer || {};
  if (!c.name || !c.email) {
    throw new Error("Nom et email requis");
  }

  const order_id = "CMD" + Utilities.getUuid().slice(0,8).toUpperCase();

  const order = {
    customer: c,
    items: payload.items,
    total: payload.total || 0
  };

  const ss = SpreadsheetApp.openById(SHEET_ID);

  const sh = ss.getSheetByName("Orders") || ss.insertSheet("Orders");
  if (sh.getLastRow() === 0) {
    sh.appendRow(["order_id","date","client","email","total"]);
  }
  sh.appendRow([
    order_id,
    Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm"),
    c.name,
    c.email,
    order.total
  ]);

  const t = HtmlService.createTemplateFromFile("pdf");
  t.order = order;
  t.order_id = order_id;

  const pdf = t.evaluate().getBlob().setName(order_id + ".pdf");
  const file = DriveApp.createFile(pdf);

  GmailApp.sendEmail(
    EMAIL_FOURNISSEUR,
    "Commande " + order_id,
    "Nouvelle commande\nPDF : " + file.getUrl(),
    { attachments:[file] }
  );

  return { ok:true, order_id, pdfUrl:file.getUrl() };
}
