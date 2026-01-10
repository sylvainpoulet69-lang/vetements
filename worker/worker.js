/**
 * Cloudflare Worker – Order API → Google Sheets
 *
 * Endpoints:
 *  - POST /api/order
 *  - GET  /health
 *
 * Secrets:
 *  - SHEET_ID
 *  - GOOGLE_SERVICE_ACCOUNT_JSON
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
    if (!sheetId || !saJson) {
      return json(
        { ok: false, error: "Worker missing SHEET_ID or GOOGLE_SERVICE_ACCOUNT_JSON" },
        500
      );
    }

    const ordersTab = env.ORDERS_SHEET_NAME || "Orders";
    const itemsTab = env.ITEMS_SHEET_NAME || "OrderItems";

    const orderId = makeOrderId();
    const nowIso = new Date().toISOString();

    /* =========================================================
       ✅ NEW: Support 2 formats (sans casser l'ancien)
       - ancien: { payload: { customer, cart, total, ... } }
       - nouveau: { order: {...}, items: [...] }
       ========================================================= */
    let payload = null;

    // 1) Ancien format
    if (body && body.payload) {
      payload = body.payload;
    }

    // 2) Nouveau format (celui de ton app.js actuel)
    if (!payload && body && body.order && Array.isArray(body.items)) {
      const o = body.order || {};
      const items = body.items || [];

      payload = {
        customer: {
          name: o.customer_name || "",
          email: o.email || "",
          phone: o.phone || "",
          company: o.company || "",
          // ✅ NEW: on met la note INFO ici
          notes: o.note || o.notes || "",
        },
        // ✅ On reconstruit un "cart" compatible avec l'ancien mapping
        cart: items.map((it) => ({
          product_id: it.product_id || "",
          title: it.title || "",
          qty: it.qty || 1,
          price: it.unit_price || 0,
          gender: it.gender || "",
          size: it.size || "",
          color: it.color || "",
          logo: it.logo || "",
          flocage: it.flocage || "",
          flocage_text: it.flocage_text || "",
          pack_parent_id: it.parent_pack || it.pack_parent_id || "",
          extra: it.extra || "",
        })),
        total: o.total || 0,
        currency: o.currency || "EUR",
        source: o.source || "github-pages",
      };
    }

    if (!payload || !payload.customer) {
      return json(
        { ok: false, error: "Missing payload.customer (or body.order/body.items)" },
        400
      );
    }
    if (!payload.cart || !Array.isArray(payload.cart)) {
      return json(
        { ok: false, error: "Missing payload.cart (or body.items)" },
        400
      );
    }

    /* =========================================================
       ✅ NEW: récupérer la note INFO de façon robuste
       ========================================================= */
    const note =
      (payload.customer && (payload.customer.notes || payload.customer.note)) ||
      payload.note ||
      "";

    // Flatten order header (structure IDENTIQUE à ton worker)
    const orderRow = [
      orderId,
      nowIso,
      payload.customer.name || "",
      payload.customer.email || "",
      payload.customer.phone || "",
      payload.customer.company || "",
      // ✅ NEW: ici on écrit la note (colonne "notes" existante)
      String(note || ""),
      payload.total || "",
      payload.currency || "EUR",
      payload.source || "github-pages",
    ];

    // Flatten items (structure IDENTIQUE à ton worker)
    const itemRows = (payload.cart || []).map((line, idx) => ([
      orderId,
      String(idx + 1),
      String(line.product_id || ""),
      String(line.title || ""),
      String(line.qty || 1),
      String(line.price || 0),
      String(line.gender || ""),
      String(line.size || ""),
      String(line.color || ""),
      String(line.logo || ""),
      String(line.flocage || ""),
      String(line.flocage_text || ""),
      String(line.pack_parent_id || ""), // if pack item
      String(line.extra || ""),          // json/string free field
    ]));

    try {
      const token = await getAccessToken(JSON.parse(saJson));

      // Append order header
      await appendValues(token, sheetId, `${ordersTab}!A1`, [orderRow]);

      // Append items
      if (itemRows.length) {
        await appendValues(token, sheetId, `${itemsTab}!A1`, itemRows);
      }

      // Response
      return json({
        ok: true,
        order_id: orderId,
        ts: nowIso,
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

function makeOrderId() {
  const t = Date.now().toString(36).toUpperCase();
  const r = crypto.getRandomValues(new Uint32Array(2));
  return `O-${t}-${r[0].toString(36).toUpperCase()}${r[1].toString(36).toUpperCase()}`;
}

/**
 * Google OAuth2 Service Account JWT flow
 * - create JWT assertion signed RS256
 * - exchange for access token
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
