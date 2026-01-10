/**
 * Cloudflare Worker – Orders API → Google Sheets + trigger PDF WebApp (Apps Script)
 *
 * Endpoints:
 *  - POST /api/order
 *  - GET  /health
 *
 * Secrets (Workers -> Settings -> Variables):
 *  - SHEET_ID
 *  - GOOGLE_SERVICE_ACCOUNT_JSON
 *  - PDF_WEBAPP_URL                 // ✅ Apps Script /exec
 *  - ORDERS_SHEET_NAME (optional) default "Orders"
 *  - ITEMS_SHEET_NAME  (optional) default "OrderItems"
 *
 * Google side:
 *  - Share the Google Sheet with the service account email (Editor).
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response("", { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/health") {
      return json({ ok: true, ts: Date.now() }, 200);
    }

    if (url.pathname !== "/api/order") {
      return json({ ok: false, error: "Not found" }, 404);
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    const sheetId = env.SHEET_ID;
    const saJson = env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const pdfWebappUrl = (env.PDF_WEBAPP_URL || "").replace(/\/$/, "");
    if (!sheetId || !saJson) {
      return json(
        { ok: false, error: "Worker missing SHEET_ID or GOOGLE_SERVICE_ACCOUNT_JSON" },
        500
      );
    }
    if (!pdfWebappUrl) {
      return json(
        { ok: false, error: "Worker missing PDF_WEBAPP_URL (Apps Script /exec)" },
        500
      );
    }

    const ordersTab = env.ORDERS_SHEET_NAME || "Orders";
    const itemsTab = env.ITEMS_SHEET_NAME || "OrderItems";

    // ✅ Nouveau format attendu depuis ton app.js:
    // { order: {...}, items: [...] }
    if (!body || !body.order || !Array.isArray(body.items)) {
      return json({ ok: false, error: "Missing body.order or body.items[]" }, 400);
    }

    const o = body.order || {};
    const items = body.items || [];

    const orderId = makeOrderId();
    const nowIso = new Date().toISOString();

    // =========================
    // ✅ ORDERS: MATCH EXACT HEADERS
    // order_id | date | customer_name | phone | total | status | pdf_url | email | note | pdf_vendor_url
    // =========================
    const orderRow = [
      orderId,
      nowIso,
      String(o.customer_name || ""),
      String(o.phone || ""),
      Number(o.total || 0),
      String(o.status || "new"),
      "", // pdf_url (sera rempli par Apps Script)
      String(o.email || ""),
      String(o.note || ""),
      "", // pdf_vendor_url (sera rempli par Apps Script)
    ];

    // =========================
    // ✅ ORDERITEMS: MATCH EXACT HEADERS
    // order_id|line|product_id|title|color|gender|size|qty|unit_price|logo|flocage_text|image_url
    // =========================
    const itemRows = items.map((it, idx) => ([
      orderId,
      String(it.line || (idx + 1)),
      String(it.product_id || ""),
      String(it.title || ""),
      String(it.color || ""),
      String(it.gender || ""),
      String(it.size || ""),
      Number(it.qty || 1),
      Number(it.unit_price || 0),
      String(it.logo || ""),
      String(it.flocage_text || ""),
      String(it.image_url || ""),
    ]));

    try {
      const token = await getAccessToken(JSON.parse(saJson));

      // Append Orders
      await appendValues(token, sheetId, `${ordersTab}!A1`, [orderRow]);

      // Append OrderItems
      if (itemRows.length) {
        await appendValues(token, sheetId, `${itemsTab}!A1`, itemRows);
      }

      // ✅ Trigger Apps Script: generate BOTH PDFs + email + update sheet urls
      let pdfRes = null;
      try {
        const r = await fetch(pdfWebappUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "makePdfAndMail", order_id: orderId }),
        });
        const t = await r.text();
        pdfRes = safeJsonParse(t) || { raw: t };
        if (!r.ok) {
          return json({ ok: false, error: "PDF webapp error", order_id: orderId, details: pdfRes }, 500);
        }
      } catch (e) {
        return json({ ok: false, error: "PDF webapp call failed", order_id: orderId, details: String(e) }, 500);
      }

      return json({
        ok: true,
        order_id: orderId,
        ts: nowIso,
        pdf_url: pdfRes && (pdfRes.pdf_url || pdfRes.pdfUrl) ? String(pdfRes.pdf_url || pdfRes.pdfUrl) : "",
        pdf_vendor_url: pdfRes && pdfRes.pdf_vendor_url ? String(pdfRes.pdf_vendor_url) : "",
        mail_ok: pdfRes && typeof pdfRes.mail_ok !== "undefined" ? pdfRes.mail_ok : undefined,
        mail_error: pdfRes && pdfRes.mail_error ? pdfRes.mail_error : "",
      }, 200);

    } catch (e) {
      return json({ ok: false, error: (e && e.message) ? e.message : String(e) }, 500);
    }
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function makeOrderId() {
  const t = Date.now().toString(36).toUpperCase();
  const r = crypto.getRandomValues(new Uint32Array(2));
  return `ORD-${t}-${r[0].toString(36).toUpperCase()}${r[1].toString(36).toUpperCase()}`;
}

/**
 * Google OAuth2 Service Account JWT flow
 */
async function getAccessToken(sa) {
  if (!sa.client_email || !sa.private_key) throw new Error("Invalid service account JSON");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const enc = (obj) => btoaUrl(JSON.stringify(obj));
  const unsigned = `${enc(header)}.${enc(claimSet)}`;

  const key = await importPrivateKey(sa.private_key);
  const sigBuf = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(unsigned),
  );
  const sig = btoaUrl(bufToBin(sigBuf));

  const jwt = `${unsigned}.${sig}`;

  const form = new URLSearchParams();
  form.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  form.set("assertion", jwt);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || "OAuth token error");
  return data.access_token;
}

async function appendValues(accessToken, sheetId, range, values) {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}` +
    `/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Sheets append failed: ${res.status} ${t}`);
  }
}

function btoaUrl(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bufToBin(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

async function importPrivateKey(pem) {
  const pkcs8 = pemToArrayBuffer(pem);
  return crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
