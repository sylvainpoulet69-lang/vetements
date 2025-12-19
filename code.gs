/****************************************************
 * Boutique Les Acacias — Apps Script côté serveur
 * - Lecture du catalogue (Produits / Variantes / Packs)
 * - Création PDF commande + e-mail au fournisseur
 ****************************************************/

/*** CONFIG ***/
const SHEET_ID ="11c43GO9RCULZ22CiajYXVPzvjwynsftCm5p3foTmd0s";
const EMAIL_FOURNISSEUR = "sylvainpoulet@free.fr"; // ← à personnaliser
const TZ = "Europe/Paris";

/*** Rendu UI ***/
function doGet() {
  return HtmlService.createTemplateFromFile("index").evaluate()
    .setTitle("Boutique Les Acacias")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function include(filename) { return HtmlService.createHtmlOutputFromFile(filename).getContent(); }

/*** Lecture du catalogue ***/
function getCatalog() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const products = sheetToObjects(ss.getSheetByName("Products"));
  const variants = sheetToObjects(ss.getSheetByName("Variants"));
  const packItems = sheetToObjects(ss.getSheetByName("PackItems"));
  const options = {
    colors_default:["Bleu","Blanc","Noir","Rose"],
    logo:["Tennis","Padel","Aucun"]
  };
  return { products, variants, packItems, options };
}

function sheetToObjects(sheet){
  if(!sheet) return [];
  const [header, ...rows] = sheet.getDataRange().getValues().filter(r=>r.join("")!="");
  return rows.map(r=>{
    let o={}; header.forEach((h,i)=>o[h]=r[i]); return o;
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
        name:  String(customer.name || "").trim(),
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

    // 3) Enregistrer (optionnel) dans Sheets
    const ss = SpreadsheetApp.getActive();
    const ordersSh = ss.getSheetByName("Orders") || ss.insertSheet("Orders");
    if (ordersSh.getLastRow() === 0) {
      ordersSh.appendRow(["order_id","date","client","email","phone","total"]);
    }
    ordersSh.appendRow([
      order_id,
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm"),
      order.customer.name,
      order.customer.email,
      order.customer.phone,
      order.total
    ]);

    const itemsSh = ss.getSheetByName("OrderItems") || ss.insertSheet("OrderItems");
    if (itemsSh.getLastRow() === 0) {
      itemsSh.appendRow(["order_id","title","color","size","gender","logo","flocage","qty","price"]);
    }
    order.items.forEach(it => {
      itemsSh.appendRow([order_id, it.title, it.color, it.size, it.gender, it.logo, it.flocage_text, it.qty, it.price]);
    });

    // 4) Générer le PDF (clé : passer 'order' et 'order_id' au template)
    const t = HtmlService.createTemplateFromFile("pdf");
    t.order = order;              // <<< important
    t.order_id = order_id;        // <<< important
    const blobPdf = t.evaluate().getBlob().getAs("application/pdf");
    blobPdf.setName(order_id + ".pdf");
    const file = DriveApp.createFile(blobPdf);

    // 5) Email à l’organisation (et pas forcément au client)
    const to = Session.getActiveUser().getEmail(); // mets ton mail si tu veux le forcer
    const subject = "Commande " + order_id;
    const body = "Commande " + order_id + " — total " + order.total.toFixed(2) + "€\n\nPDF : " + file.getUrl();
    GmailApp.sendEmail(to, subject, body, {attachments:[file]});

    // 6) Réponse à l’UI
    return { ok:true, order_id: order_id, pdfUrl: file.getUrl() };

  } catch (err) {
    throw new Error(err && err.message ? err.message : String(err));
  }
}

/*** Template PDF (simple) ***/
function createPdfTemplate() {
  const html = `
  <html><head><meta charset="UTF-8"><style>
  body{font-family:Arial,Helvetica,sans-serif;font-size:12pt}
  table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #ccc;padding:6px;text-align:left}
  h1{font-size:16pt;margin:0 0 10px 0}
  </style></head><body>
  <h1>Les Acacias — Bon de commande</h1>
  <p><b>Client :</b> <?= data.customer.name ?> — <?= data.customer.phone ?></p>
  <table>
    <tr><th>Article</th><th>Couleur</th><th>Taille</th><th>Genre</th><th>Logo</th><th>Flocage</th><th>Qté</th><th>PU</th></tr>
    <? data.items.forEach(it => { ?>
      <tr>
        <td><?= it.title ?></td><td><?= it.color ?></td><td><?= it.size ?></td>
        <td><?= it.gender ?></td><td><?= it.logo ?></td><td><?= it.flocage_text ?></td>
        <td><?= it.qty ?></td><td><?= it.price ?>€</td>
      </tr>
    <? }); ?>
  </table>
  <p><b>Total :</b> <?= data.total ?>€</p>
  </body></html>`;
  return HtmlService.createHtmlOutput(html).getContent();
}
