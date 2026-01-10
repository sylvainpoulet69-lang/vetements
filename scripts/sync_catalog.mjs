import { google } from "googleapis";
import fs from "fs";
import path from "path";

const SHEET_ID = process.env.SHEET_ID;
const SA_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

if (!SHEET_ID) throw new Error("Missing SHEET_ID secret");
if (!SA_JSON) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON secret");

const creds = JSON.parse(SA_JSON);

const auth = new google.auth.JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const sheets = google.sheets({ version: "v4", auth });

async function readTab(tabName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A:ZZ`,
  });

  const values = res.data.values || [];
  if (!values.length) return [];
  const headers = values[0].map((h) => String(h || "").trim());
  return values.slice(1).map((row) => {
    const o = {};
    headers.forEach((h, i) => (o[h] = row[i] ?? ""));
    return o;
  });
}

function normalizeBool(v) {
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "oui";
}

function normalizeNum(v) {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

// ✅ AJOUT: normalisation HEX (#RRGGBB)
function normalizeHex(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  const h = s.startsWith("#") ? s : "#" + s;
  return /^#[0-9A-Fa-f]{6}$/.test(h) ? h : "";
}

function normalizeCatalog({ products, variants, packItems, options }) {
  const P = products.map((p) => ({
    ...p,
    active: normalizeBool(p.active),
    price: normalizeNum(p.price),
  }));

  const V = variants.map((v) => ({ ...v }));

  const PI = packItems.map((x) => ({
    ...x,
    qty: normalizeNum(x.qty || 1),
    extra_price: normalizeNum(x.extra_price || 0),
  }));

  return { products: P, variants: V, packItems: PI, options };
}

const products = await readTab("Products");
const variants = await readTab("Variants");
const packItems = await readTab("PackItems");

// ✅ AJOUT: Colors (optionnel)
let colors = [];
try {
  colors = await readTab("Colors");
} catch {
  colors = [];
}

// Optionnel: Options (key/value) pour couleurs par défaut, etc.
let options = {};
try {
  const optionsRows = await readTab("Options");
  options = optionsRows.reduce((acc, r) => {
    if (r.key) acc[r.key] = r.value;
    return acc;
  }, {});
} catch {
  options = {};
}

// ✅ AJOUT: build options.colors_hex depuis l'onglet Colors
const colors_hex = (colors || []).reduce((acc, r) => {
  const name = String(r.color || "").trim();
  const hex = normalizeHex(r.hex);

  // active: si vide => on considère actif (évite les surprises)
  const isActive = String(r.active || "").trim() === "" ? true : normalizeBool(r.active);

  if (name && hex && isActive) acc[name] = hex;
  return acc;
}, {});

// ✅ AJOUT: injecter dans options sans casser le reste
options = {
  ...options,
  colors_hex,
};

const catalog = normalizeCatalog({ products, variants, packItems, options });

fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
fs.writeFileSync(
  path.join(process.cwd(), "data/catalog.json"),
  JSON.stringify(catalog, null, 2),
  "utf-8",
);

console.log("✅ Wrote data/catalog.json");
