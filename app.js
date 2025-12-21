let CATALOG = { products: [], variants: [], packItems: [], options: {} };
let CURRENT_CAT = null;
let CART = [];

const ADULT_SIZES = ["S", "M", "L", "XL", "XXL"];
const KID_SIZES = ["4", "6", "8", "10", "12", "14"];

/* === CONFIG BACKEND APPS SCRIPT === */
window.APPS_SCRIPT_DEPLOY =
  "https://script.google.com/macros/s/AKfycbynQ91SCza8sIz9auJ-GB2iLO-EeOwZ6S-hjqeLZrtXj8p53tborgWOGlDo294RP__sWw/exec";

/* === CONFIG MODE GITHUB PAGES === */
// URL du catalogue statique généré par GitHub Actions (Sheets → data/catalog.json)
window.CATALOG_URL = window.CATALOG_URL || "./data/catalog.json";

// ✅ Endpoint de commande (Cloudflare Worker) – BASE URL (sans /api/order)
window.ORDER_API_URL =
  window.ORDER_API_URL || "https://training-addict-orders.sylvainpoulet69.workers.dev";

/* === DÉTECTION ENVIRONNEMENT === */
const isAppsScript =
  typeof google !== "undefined" && google.script && google.script.run;

const APPS_SCRIPT_DEPLOY = (window.APPS_SCRIPT_DEPLOY || "").replace(/\/$/, "");

// (Optionnel) Proxy CORS (ex: Cloudflare Worker) pour que POST fonctionne sur GitHub Pages
const APPS_SCRIPT_PROXY = (window.APPS_SCRIPT_PROXY || "").replace(/\/$/, "");

const euros = (n) => (Number(n) || 0).toFixed(2).replace(".", ",") + "€";
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
function show(id) {
  $$(".section").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
}
function refreshCartBadge() {
  $("#cartCount").textContent = CART.reduce((a, l) => a + (l.qty || 1), 0);
}
function cartTotal() {
  return CART.reduce((s, l) => s + (Number(l.price) || 0) * (l.qty || 1), 0);
}
function loadCart() {
  try {
    CART = JSON.parse(localStorage.getItem("cart") || "[]");
  } catch (e) {
    CART = [];
  }
  refreshCartBadge();
}
function saveCart() {
  localStorage.setItem("cart", JSON.stringify(CART));
}
function imgOrFallback(u) {
  return u && String(u).trim()
    ? u
    : "https://picsum.photos/seed/acacias/1600/1200";
}
function colorToHex(n) {
  const m = {
    Bleu: "#2563EB",
    Blanc: "#FFFFFF",
    Noir: "#111111",
    Rose: "#F472B6",
    Rouge: "#e11d48",
    Vert: "#22c55e",
    Gris: "#64748b",
  };
  return m[n] || "#CBD5E1";
}

/* === Helpers catalogue / variantes === */
const uniq = (arr) => [...new Set((arr || []).filter((x) => x !== null && x !== undefined && String(x).trim() !== "").map((x) => String(x)))];

function getVariantsForProduct_(productId) {
  return (CATALOG.variants || []).filter((v) => String(v.product_id) === String(productId));
}

function splitSizes_(sizeListStr) {
  return String(sizeListStr || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function getCandidateSizes_(vars, gender, color) {
  const V = vars || [];

  // 1) strict: gender + color
  let cands = V.filter((v) =>
    (!gender || String(v.gender_scope) === String(gender)) &&
    (!color || String(v.color) === String(color))
  );

  let sizes = [];
  for (const v of cands) sizes.push(...splitSizes_(v.size_list));
  sizes = uniq(sizes);
  if (sizes.length) return sizes;

  // 2) fallback: gender only (ignore color)
  cands = V.filter((v) => (!gender || String(v.gender_scope) === String(gender)));
  sizes = [];
  for (const v of cands) sizes.push(...splitSizes_(v.size_list));
  sizes = uniq(sizes);
  if (sizes.length) return sizes;

  // 3) fallback: any size from product
  sizes = [];
  for (const v of V) sizes.push(...splitSizes_(v.size_list));
  return uniq(sizes);
}


function pickVariant_(vars, gender, color) {
  // 1) match gender+color
  let v = (vars || []).find((x) =>
    (!gender || String(x.gender_scope) === String(gender)) &&
    (!color || String(x.color) === String(color)) &&
    String(x.image_url || "").trim()
  );
  if (v) return v;

  // 2) match color
  v = (vars || []).find((x) => (!color || String(x.color) === String(color)) && String(x.image_url || "").trim());
  if (v) return v;

  // 3) any with image
  v = (vars || []).find((x) => String(x.image_url || "").trim());
  return v || null;
}

function applyVariantImage_(imgEl, vars, gender, color, fallbackUrl) {
  if (!imgEl) return;
  const v = pickVariant_(vars, gender, color);
  const u = v && String(v.image_url || "").trim() ? String(v.image_url).trim() : fallbackUrl;
  imgEl.src = imgOrFallback(u);
}

function shouldShowGender_(genders) {
  const gs = uniq(genders);
  if (gs.length <= 1) return false;
  if (gs.length === 1 && gs[0] === "Unisexe") return false;
  // si Unisexe + autres, on affiche
  return true;
}

function defaultGender_(genders) {
  const gs = uniq(genders);
  // priorité : H puis F puis Unisexe puis Enfant
  const prio = ["H", "F", "Unisexe", "Enfant"];
  for (const p of prio) if (gs.includes(p)) return p;
  return gs[0] || null;
}

function defaultColor_(colors) {
  const cs = uniq(colors);
  // si le club a une liste par défaut, on préfère une couleur existante proche
  const preferred = (CATALOG.options && CATALOG.options.colors_default) ? CATALOG.options.colors_default : [];
  for (const p of preferred) if (cs.includes(String(p))) return String(p);
  return cs[0] || null;
}

/* ✅ JSONP pour contourner CORS sur GitHub Pages (catalogue) */
function getJsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = "cb_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);

    window[cb] = (data) => {
      try {
        delete window[cb];
      } catch (e) {
        window[cb] = undefined;
      }
      script.remove();
      resolve(data);
    };

    const script = document.createElement("script");
    script.src = url + (url.includes("?") ? "&" : "?") + "callback=" + cb;

    script.onerror = () => {
      try {
        delete window[cb];
      } catch (e) {
        window[cb] = undefined;
      }
      script.remove();
      reject(new Error("JSONP load failed"));
    };

    document.head.appendChild(script);
  });
}

async function loadCatalog() {
  // 1) Si l'app tourne DANS Apps Script, on garde la voie directe (stable)
  if (isAppsScript) {
    google.script.run
      .withSuccessHandler((data) => {
        CATALOG = data;
        renderHome();
      })
      .getCatalog();
    return;
  }

  const list = $("#homeList");

  // 2) Mode GitHub Pages : on privilégie le catalogue statique (data/catalog.json)
  //    (généré automatiquement depuis Google Sheets via GitHub Actions)
  if (window.CATALOG_URL) {
    fetch(window.CATALOG_URL, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("catalog fetch failed: " + r.status);
        return r.json();
      })
      .then((data) => {
        if (!data || !data.products) throw new Error("catalog.json invalide");
        CATALOG = data;
        renderHome();
      })
      .catch(() => {
        // 3) Fallback : ancien mode Apps Script (proxy / JSONP)
        loadCatalog_AppsScriptFallback(list);
      });

    return;
  }

  // Si pas de CATALOG_URL, on tombe directement sur l'ancien mode
  loadCatalog_AppsScriptFallback(list);
}

// Ancien mode : Apps Script direct (proxy CORS en fetch) ou JSONP sinon
function loadCatalog_AppsScriptFallback(list) {
  if (!APPS_SCRIPT_DEPLOY) {
    list.innerHTML =
      '<div class="card"><div class="card-body"><div class="card-title-wrap">Catalogue introuvable. Renseignez window.CATALOG_URL (recommandé) ou APPS_SCRIPT_DEPLOY dans app.js.</div></div></div>';
    return;
  }

  try {
    // Si tu définis window.APPS_SCRIPT_PROXY (proxy CORS), on peut utiliser fetch en JSON (GET/POST).
    if (APPS_SCRIPT_PROXY) {
      const res = fetch(APPS_SCRIPT_PROXY + "/?api=getCatalog", {
        cache: "no-store",
      });
      res
        .then((r) => {
          if (!r.ok) throw new Error(r.statusText);
          return r.json();
        })
        .then((data) => {
          CATALOG = data;
          renderHome();
        })
        .catch(() => loadCatalog_JSONP());
      return;
    }
  } catch (e) {}

  // Sinon JSONP
  loadCatalog_JSONP();
}

// JSONP catalogue (si tu l'utilises encore)
function loadCatalog_JSONP() {
  const list = $("#homeList");
  const url = APPS_SCRIPT_DEPLOY + "?callback=?"; // placeholder, remplacé dans getJsonp
  // Ici, ton ancien JSONP (si nécessaire) : on tente /exec?action=getCatalog ou similaire
  // Comme tu as déjà CATALOG_URL, ce chemin ne devrait presque jamais servir.
  const jsonpUrl = APPS_SCRIPT_DEPLOY + "?action=getCatalog";
  getJsonp(jsonpUrl)
    .then((data) => {
      CATALOG = data;
      renderHome();
    })
    .catch(() => {
      list.innerHTML =
        '<div class="card"><div class="card-body"><div class="card-title-wrap">Impossible de charger le catalogue (JSONP).</div></div></div>';
    });
}

/* -------- ACCUEIL -------- */
function renderHome() {
  const hh = $("#heroTitle");
  if (hh) hh.textContent = "Choisis tes vêtements club";
  const hs = $("#heroSubtitle");
  if (hs) hs.textContent = "Logos inclus · Flocage personnalisé inclus";

  const list = $("#homeList");
  list.innerHTML = "";
  const items = CATALOG.products
    .filter((p) => p.active === true || String(p.active).toLowerCase() === "true")
    .slice(0, 4);

  if (!items.length) {
    list.innerHTML =
      '<div class="card"><div class="card-body"><div class="card-title-wrap">Aucun produit actif dans le catalogue.</div></div></div>';
  }

  items.forEach((p) => {
    const card = document.createElement("div");
    card.className = "card product";
    card.dataset.id = p.product_id;
    card.innerHTML = `
      <img src="${imgOrFallback(p.image_url)}" alt="${p.title}">
      <div class="card-body">
        <div class="card-title-wrap">
          <h3>${p.title}${
            String(p.type).toLowerCase() === "pack"
              ? " <span class='muted'>(Pack)</span>"
              : ""
          }</h3>
          <div class="price">à partir de ${euros(p.price)}</div>
        </div>
        <button class="btn btn-ghost btn-small" data-id="${p.product_id}">Choisir</button>
      </div>`;
    list.appendChild(card);
  });

  list.onclick = (e) => {
    const t = e.target.closest("[data-id]");
    if (!t) return;
    openDetail(t.dataset.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
}

/* -------- Liste produits -------- */
function renderProducts() {
  const list = $("#productList");
  list.innerHTML = "";
  const items = CATALOG.products.filter(
    (p) =>
      String(p.category) === String(CURRENT_CAT) &&
      (p.active === true || String(p.active).toLowerCase() === "true")
  );

  items.forEach((p) => {
    const card = document.createElement("div");
    card.className = "card product";
    card.dataset.id = p.product_id;
    card.innerHTML = `
      <img src="${imgOrFallback(p.image_url)}" alt="${p.title}">
      <div class="card-body">
        <div class="card-title-wrap">
          <h3>${p.title}${
            String(p.type).toLowerCase() === "pack"
              ? " <span class='muted'>(Pack)</span>"
              : ""
          }</h3>
          <div class="price">à partir de ${euros(p.price)}</div>
        </div>
        <button class="btn btn-ghost btn-small" data-id="${p.product_id}">Choisir</button>
      </div>`;
    list.appendChild(card);
  });

  list.onclick = (e) => {
    const t = e.target.closest("[data-id]");
    if (!t) return;
    openDetail(t.dataset.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
}

/* -------- Détail unitaire -------- */
function openDetail(pid) {
  const p = CATALOG.products.find((x) => String(x.product_id) === String(pid));
  if (!p) return;

  // Packs
  if (String(p.type).toLowerCase() === "pack") {
    return openPackDetail(p);
  }

  const vars = getVariantsForProduct_(pid);
  const colors = uniq(vars.map((v) => v.color));
  const genders = uniq(vars.map((v) => v.gender_scope));

  // UI defaults
  const sel = {
    color: defaultColor_(colors),
    gender: defaultGender_(genders),
    size: null,
    logo: "Aucun",
  };

  // Compute sizes (may be empty for accessories like casquette)
  const sizesFromVars = getCandidateSizes_(vars, sel.gender, sel.color);
  const shouldShowSize = sizesFromVars.length > 0;

  // If we show size, set default to first
  if (shouldShowSize) sel.size = sizesFromVars[0];

  const showGender = shouldShowGender_(genders);

  // --- Render ---
  $("#detail").innerHTML = `
    <div style="display:flex;gap:12px;margin-bottom:16px">
      <button id="goHome" class="back">Accueil</button>
      <button id="backList" class="back">Produits</button>
    </div>

    <div class="detail">
      <img id="detailImg" class="detail-img" src="${imgOrFallback(p.image_url)}" alt="${p.title}">
      <h3>${p.title}</h3>
      <div class="price" style="margin-bottom:12px">${euros(p.price)}</div>

      <div id="wrapGender" style="${showGender ? "" : "display:none"}">
        <label>Genre</label>
        <div class="pills" id="pickGender">
          ${["H", "F", "Unisexe", "Enfant"]
            .filter((g) => !genders.length || genders.includes(g))
            .map((g) => `<button class="pill" data-val="${g}">${g}</button>`)
            .join("")}
        </div>
      </div>

      <div id="wrapSize" style="${shouldShowSize ? "" : "display:none"}">
        <label>Taille</label>
        <div class="pills sizes-grid" id="pickSize"></div>
      </div>

      <label>Couleur</label>
      <div class="swatches" id="pickColor">
        ${(colors.length ? colors : (CATALOG.options.colors_default || ["Bleu", "Blanc", "Noir", "Rose"]))
          .map(
            (c) => `
            <div class="swatch" data-val="${c}">
              <div class="dot" style="background:${colorToHex(c)}"></div>
              <div class="name">${c}</div>
            </div>`
          )
          .join("")}
      </div>

      <label>Logo (inclus)</label>
      <div class="pills" id="pickLogo">
        ${(CATALOG.options.logo || ["Tennis", "Padel", "Aucun"])
          .map((l) => `<button class="pill" data-val="${l}">${l}</button>`)
          .join("")}
      </div>

      <label>Flocage (inclus)</label>
      <input id="flocText" class="inp" placeholder="Texte (ex: NOM)">

      <label>Quantité</label>
      <input id="qty" class="inp" type="number" min="1" value="1">

      <div class="actions">
        <button id="btnAdd" class="btn btn-primary">🛒 Ajouter au panier</button>
      </div>
    </div>
  `;

  // Activate defaults (gender/logo/color)
  if (showGender) {
    const gbtn = Array.from($$("#pickGender .pill")).find((b) => b.dataset.val === sel.gender) || $("#pickGender .pill");
    if (gbtn) {
      $$("#pickGender .pill").forEach((x) => x.classList.remove("active"));
      gbtn.classList.add("active");
      sel.gender = gbtn.dataset.val;
    }
  }

  const lbtn = Array.from($$("#pickLogo .pill")).find((b) => b.dataset.val === sel.logo) || $("#pickLogo .pill");
  if (lbtn) {
    $$("#pickLogo .pill").forEach((x) => x.classList.remove("active"));
    lbtn.classList.add("active");
    sel.logo = lbtn.dataset.val;
  }

  const cbtn = Array.from($$("#pickColor .swatch")).find((b) => b.dataset.val === sel.color) || $("#pickColor .swatch");
  if (cbtn) {
    $$("#pickColor .swatch").forEach((x) => x.classList.remove("active"));
    cbtn.classList.add("active");
    sel.color = cbtn.dataset.val;
  }

  // Render sizes if needed
  function renderSizes() {
    const sizes = getCandidateSizes_(vars, sel.gender, sel.color);
    const wrap = $("#wrapSize");
    const box = $("#pickSize");

    if (!sizes.length) {
      if (wrap) wrap.style.display = "none";
      sel.size = "";
      return;
    }

    if (wrap) wrap.style.display = "";
    box.innerHTML = sizes.map((s) => `<button class="pill" data-val="${s}">${s}</button>`).join("");

    // Keep selection
    if (!sel.size || !sizes.includes(sel.size)) sel.size = sizes[0];

    const sbtn = Array.from(box.querySelectorAll(".pill")).find((b) => b.dataset.val === sel.size);
    if (sbtn) sbtn.classList.add("active");
  }

  renderSizes();

  // Apply image based on selected color/gender if variant has image_url
  applyVariantImage_($("#detailImg"), vars, sel.gender, sel.color, p.image_url);

  // Events
  if (showGender) {
    $("#pickGender").addEventListener("click", (e) => {
      const b = e.target.closest(".pill");
      if (!b) return;
      $$("#pickGender .pill").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      sel.gender = b.dataset.val;
      renderSizes();
      applyVariantImage_($("#detailImg"), vars, sel.gender, sel.color, p.image_url);
    });
  }

  $("#pickSize")?.addEventListener("click", (e) => {
    const b = e.target.closest(".pill");
    if (!b) return;
    $$("#pickSize .pill").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    sel.size = b.dataset.val;
  });

  $("#pickColor").addEventListener("click", (e) => {
    const s = e.target.closest(".swatch");
    if (!s) return;
    $$("#pickColor .swatch").forEach((x) => x.classList.remove("active"));
    s.classList.add("active");
    sel.color = s.dataset.val;
    renderSizes();
    applyVariantImage_($("#detailImg"), vars, sel.gender, sel.color, p.image_url);
  });

  $("#pickLogo").addEventListener("click", (e) => {
    const b = e.target.closest(".pill");
    if (!b) return;
    $$("#pickLogo .pill").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    sel.logo = b.dataset.val;
  });

  $("#btnAdd").addEventListener("click", () => {
    const qty = Math.max(1, Number($("#qty").value || 1));
    if (showGender && !sel.gender) {
      alert("Choisir un genre.");
      return;
    }
    // Taille peut être vide pour accessoires
    if ($("#wrapSize") && $("#wrapSize").style.display !== "none" && !sel.size) {
      alert("Choisir une taille.");
      return;
    }
    if (!sel.color) {
      alert("Choisir une couleur.");
      return;
    }

    CART.push({
      product_id: p.product_id,
      title: p.title,
      color: sel.color,
      gender: sel.gender || "Unisexe",
      size: sel.size || "",
      qty,
      price: p.price,
      logo: sel.logo,
      flocage_text: ($("#flocText").value || "").trim(),
      image_url: $("#detailImg")?.src || imgOrFallback(p.image_url),
    });

    saveCart();
    refreshCartBadge();
    show("#sectionCategories");
    window.scrollTo({ top: 0 });
  });

  $("#backList").addEventListener("click", () => show("#sectionProducts"));
  $("#goHome").addEventListener("click", () => show("#sectionCategories"));

  show("#sectionDetail");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* -------- Pack -------- */
function openPackDetail(p) {
  const packLines = (CATALOG.packItems || []).filter((x) => String(x.pack_id) === String(p.product_id));
  if (!packLines.length) {
    alert("Pack incomplet : aucun item défini dans PackItems.");
    return;
  }

  const packUpgrades = Array.isArray(CATALOG.packUpgrades) ? CATALOG.packUpgrades : [];

  const slots = packLines.map((line, idx) => {
    const baseProductId = String(line.product_id);
    const prod = CATALOG.products.find((pr) => String(pr.product_id) === baseProductId);
    const vars = getVariantsForProduct_(baseProductId);

    const colors = uniq(vars.map((v) => v.color));
    const genders = uniq(vars.map((v) => v.gender_scope));

    const gender = defaultGender_(genders);
    const color = defaultColor_(colors);

    const sizes = getCandidateSizes_(vars, gender, color);
    const size = sizes[0] || "";

    const upgrades = packUpgrades
      .filter((u) =>
        String(u.pack_id) === String(p.product_id) &&
        String(u.base_product_id || "") === baseProductId &&
        (u.active === true || String(u.active).toLowerCase() === "true" || u.active === undefined)
      )
      .map((u) => ({
        upgrade_product_id: String(u.upgrade_product_id || ""),
        label: String(u.label || "Upgrade"),
        extra_price: Number(u.extra_price || 0),
      }))
      .filter((u) => u.upgrade_product_id);

    return {
      idx,
      base_product_id: baseProductId,
      chosen_product_id: baseProductId,
      slot_title: String(line.title || (prod ? prod.title : "Article")),
      qty: Number(line.qty || 1),
      upgrades,

      gender,
      color,
      size,
      logo: "Aucun",
      flocage_text: "",

      img_fallback: imgOrFallback((prod && prod.image_url) || p.image_url),
    };
  });

  // --- render vertical like your existing product detail (scroll) ---
  const itemsHtml = slots.map((s) => {
    const vars = getVariantsForProduct_(s.chosen_product_id);
    const colors = uniq(vars.map((v) => v.color));
    const genders = uniq(vars.map((v) => v.gender_scope));
    const showGender = shouldShowGender_(genders);

    const sizes = getCandidateSizes_(vars, s.gender, s.color);
    const showSize = sizes.length > 0;

    const upgradeHtml = (s.upgrades && s.upgrades.length)
      ? `
        <label>Option</label>
        <div class="pills packUp" data-slot="${s.idx}">
          <button class="pill active" data-up="base" data-extra="0">Base</button>
          ${s.upgrades.map((u) => `
            <button class="pill" data-up="${u.upgrade_product_id}" data-extra="${u.extra_price}">
              ${u.label} +${euros(u.extra_price)}
            </button>
          `).join("")}
        </div>
      `
      : "";

    return `
  <div class="card pack-slot" style="margin-top:14px">
    <div class="card-body">
          <div class="card-title-wrap" style="margin-bottom:8px">
            <h3 style="margin:0">${s.slot_title}</h3>
            <div class="muted">x${s.qty}</div>
          </div>

          <div style="display:flex;gap:12px;align-items:center;margin:10px 0 6px">
            <img id="slotImg_${s.idx}" src="${s.img_fallback}" alt="${s.slot_title}"
              style="width:92px;height:92px;object-fit:cover;border-radius:14px;border:1px solid rgba(0,0,0,.06)">
            <div class="muted" style="flex:1">
              Personnalise cet article : couleur / taille / logo / flocage.
            </div>
          </div>

          ${upgradeHtml}

          <div class="wrapGender" data-slot="${s.idx}" style="${showGender ? "" : "display:none"}">
            <label>Genre</label>
            <div class="pills pickGender" data-slot="${s.idx}">
              ${["H", "F", "Unisexe", "Enfant"]
                .filter((g) => !genders.length || genders.includes(g))
                .map((g) => `<button class="pill ${String(g) === String(s.gender) ? "active" : ""}" data-val="${g}">${g}</button>`)
                .join("")}
            </div>
          </div>

          <div class="wrapSize" data-slot="${s.idx}" style="${showSize ? "" : "display:none"}">
            <label>Taille</label>
            <div class="pills sizes-grid pickSize" data-slot="${s.idx}">
              ${sizes.map((z) => `<button class="pill ${String(z) === String(s.size) ? "active" : ""}" data-val="${z}">${z}</button>`).join("")}
            </div>
          </div>

          <label>Couleur</label>
          <div class="swatches pickColor" data-slot="${s.idx}">
            ${(colors.length ? colors : (CATALOG.options.colors_default || ["Bleu", "Blanc", "Noir", "Rose"]))
              .map((c) => `
                <div class="swatch ${String(c) === String(s.color) ? "active" : ""}" data-val="${c}">
                  <div class="dot" style="background:${colorToHex(c)}"></div>
                  <div class="name">${c}</div>
                </div>
              `).join("")}
          </div>

          <label>Logo (inclus)</label>
          <div class="pills pickLogo" data-slot="${s.idx}">
            ${(CATALOG.options.logo || ["Tennis", "Padel", "Aucun"])
              .map((l) => `<button class="pill ${String(l) === String(s.logo) ? "active" : ""}" data-val="${l}">${l}</button>`)
              .join("")}
          </div>

          <label>Flocage (inclus)</label>
          <input class="inp pickFloc" data-slot="${s.idx}" value="${String(s.flocage_text || "")}" placeholder="Texte (ex: NOM)">
        </div>
      </div>
    `;
  }).join("");

  $("#detail").innerHTML = `
    <div style="display:flex;gap:12px;margin-bottom:16px">
      <button id="goHome" class="back">Accueil</button>
      <button id="backList" class="back">Produits</button>
    </div>

    <div class="detail">
      <img class="detail-img" src="${imgOrFallback(p.image_url)}" alt="${p.title}">
      <h3>${p.title} — Pack</h3>
      <div class="price" style="margin-bottom:12px">${euros(p.price)}</div>

      <label>Quantité de packs</label>
      <input id="packQty" class="inp" type="number" min="1" value="1">

      ${itemsHtml}

      <div class="actions" style="margin-top:16px">
        <button id="btnAddPack" class="btn btn-primary">🛒 Ajouter le pack</button>
      </div>
    </div>
  `;

  // set images per selection
  slots.forEach((s) => {
    const vars = getVariantsForProduct_(s.chosen_product_id);
    const prod = CATALOG.products.find((pr) => String(pr.product_id) === String(s.chosen_product_id));
    applyVariantImage_(document.getElementById(`slotImg_${s.idx}`), vars, s.gender, s.color, (prod && prod.image_url) || p.image_url);
  });

  // --- Delegation click ---
  $("#detail").addEventListener("click", (e) => {
    // upgrades
    const upBtn = e.target.closest(".packUp .pill");
    if (upBtn) {
      const slotIndex = Number(upBtn.closest(".packUp").dataset.slot);
      const slot = slots.find((x) => x.idx === slotIndex);
      if (!slot) return;

      upBtn.closest(".packUp").querySelectorAll(".pill").forEach((b) => b.classList.remove("active"));
      upBtn.classList.add("active");

      const up = upBtn.dataset.up;
      if (up === "base") {
        slot.chosen_product_id = slot.base_product_id;
        slot.extra_price = 0;
      } else {
        slot.chosen_product_id = up;
        slot.extra_price = Number(upBtn.dataset.extra || 0);
      }

      // refresh size list + image based on new chosen product
      const vars = getVariantsForProduct_(slot.chosen_product_id);
      const sizes = getCandidateSizes_(vars, slot.gender, slot.color);
      slot.size = sizes.includes(slot.size) ? slot.size : (sizes[0] || "");

      const sizeBox = document.querySelector(`.pickSize[data-slot="${slotIndex}"]`);
      const sizeWrap = document.querySelector(`.wrapSize[data-slot="${slotIndex}"]`);
      if (sizes.length) {
        if (sizeWrap) sizeWrap.style.display = "";
        if (sizeBox) {
          sizeBox.innerHTML = sizes.map((z) => `<button class="pill ${String(z) === String(slot.size) ? "active" : ""}" data-val="${z}">${z}</button>`).join("");
        }
      } else {
        if (sizeWrap) sizeWrap.style.display = "none";
        slot.size = "";
      }

      const prod = CATALOG.products.find((pr) => String(pr.product_id) === String(slot.chosen_product_id));
      applyVariantImage_(document.getElementById(`slotImg_${slotIndex}`), vars, slot.gender, slot.color, (prod && prod.image_url) || p.image_url);
      return;
    }

    // gender
    const g = e.target.closest(".pickGender .pill");
    if (g) {
      const slotIndex = Number(g.closest(".pickGender").dataset.slot);
      const slot = slots.find((x) => x.idx === slotIndex);
      if (!slot) return;

      g.closest(".pickGender").querySelectorAll(".pill").forEach((b) => b.classList.remove("active"));
      g.classList.add("active");
      slot.gender = g.dataset.val;

      const vars = getVariantsForProduct_(slot.chosen_product_id);
      const sizes = getCandidateSizes_(vars, slot.gender, slot.color);
      slot.size = sizes.includes(slot.size) ? slot.size : (sizes[0] || "");

      const sizeBox = document.querySelector(`.pickSize[data-slot="${slotIndex}"]`);
      const sizeWrap = document.querySelector(`.wrapSize[data-slot="${slotIndex}"]`);
      if (sizes.length) {
        if (sizeWrap) sizeWrap.style.display = "";
        if (sizeBox) {
          sizeBox.innerHTML = sizes.map((z) => `<button class="pill ${String(z) === String(slot.size) ? "active" : ""}" data-val="${z}">${z}</button>`).join("");
        }
      } else {
        if (sizeWrap) sizeWrap.style.display = "none";
        slot.size = "";
      }

      const prod = CATALOG.products.find((pr) => String(pr.product_id) === String(slot.chosen_product_id));
      applyVariantImage_(document.getElementById(`slotImg_${slotIndex}`), vars, slot.gender, slot.color, (prod && prod.image_url) || p.image_url);
      return;
    }

    // size
    const sBtn = e.target.closest(".pickSize .pill");
    if (sBtn) {
      const slotIndex = Number(sBtn.closest(".pickSize").dataset.slot);
      const slot = slots.find((x) => x.idx === slotIndex);
      if (!slot) return;
      sBtn.closest(".pickSize").querySelectorAll(".pill").forEach((b) => b.classList.remove("active"));
      sBtn.classList.add("active");
      slot.size = sBtn.dataset.val;
      return;
    }

    // color
    const c = e.target.closest(".pickColor .swatch");
    if (c) {
      const slotIndex = Number(c.closest(".pickColor").dataset.slot);
      const slot = slots.find((x) => x.idx === slotIndex);
      if (!slot) return;

      c.closest(".pickColor").querySelectorAll(".swatch").forEach((b) => b.classList.remove("active"));
      c.classList.add("active");
      slot.color = c.dataset.val;

      const vars = getVariantsForProduct_(slot.chosen_product_id);
      const sizes = getCandidateSizes_(vars, slot.gender, slot.color);
      slot.size = sizes.includes(slot.size) ? slot.size : (sizes[0] || "");

      const sizeBox = document.querySelector(`.pickSize[data-slot="${slotIndex}"]`);
      const sizeWrap = document.querySelector(`.wrapSize[data-slot="${slotIndex}"]`);
      if (sizes.length) {
        if (sizeWrap) sizeWrap.style.display = "";
        if (sizeBox) {
          sizeBox.innerHTML = sizes.map((z) => `<button class="pill ${String(z) === String(slot.size) ? "active" : ""}" data-val="${z}">${z}</button>`).join("");
        }
      } else {
        if (sizeWrap) sizeWrap.style.display = "none";
        slot.size = "";
      }

      const prod = CATALOG.products.find((pr) => String(pr.product_id) === String(slot.chosen_product_id));
      applyVariantImage_(document.getElementById(`slotImg_${slotIndex}`), vars, slot.gender, slot.color, (prod && prod.image_url) || p.image_url);
      return;
    }

    // logo
    const l = e.target.closest(".pickLogo .pill");
    if (l) {
      const slotIndex = Number(l.closest(".pickLogo").dataset.slot);
      const slot = slots.find((x) => x.idx === slotIndex);
      if (!slot) return;

      l.closest(".pickLogo").querySelectorAll(".pill").forEach((b) => b.classList.remove("active"));
      l.classList.add("active");
      slot.logo = l.dataset.val;
      return;
    }
  });

  // floc input
  $("#detail").addEventListener("input", (e) => {
    const inp = e.target.closest(".pickFloc");
    if (!inp) return;
    const slotIndex = Number(inp.dataset.slot);
    const slot = slots.find((x) => x.idx === slotIndex);
    if (!slot) return;
    slot.flocage_text = String(inp.value || "");
  });

  // add pack to cart as ONE bubble
  $("#btnAddPack").addEventListener("click", () => {
    const packQty = Math.max(1, Number($("#packQty").value || 1));

    const children = slots.map((s, i) => {
      const chosenProd = CATALOG.products.find((pr) => String(pr.product_id) === String(s.chosen_product_id));
      const img = document.getElementById(`slotImg_${s.idx}`)?.src || imgOrFallback((chosenProd && chosenProd.image_url) || p.image_url);

      return {
        product_id: s.chosen_product_id,
        title: s.slot_title,
        color: s.color || "",
        gender: s.gender || "Unisexe",
        size: s.size || "",
        qty: (s.qty || 1) * packQty,
        price: 0, // inclus
        logo: s.logo || "Aucun",
        flocage_text: String(s.flocage_text || "").trim(),
        image_url: img,
        slot_index: i + 1,
        extra_price: Number(s.extra_price || 0), // upgrade
        base_product_id: s.base_product_id,
      };
    });

    const extrasTotal = children.reduce((sum, it) => sum + (Number(it.extra_price) || 0) * (Number(it.qty) || 1), 0);

    CART.push({
      is_pack: true,
      pack_id: p.product_id,
      title: `${p.title} — Pack`,
      qty: packQty,
      price: Number(p.price || 0) + extrasTotal,
      image_url: imgOrFallback(p.image_url),
      children,
    });

    saveCart();
    refreshCartBadge();
    show("#sectionCategories");
    window.scrollTo({ top: 0 });
  });

  $("#backList").addEventListener("click", () => show("#sectionProducts"));
  $("#goHome").addEventListener("click", () => show("#sectionCategories"));

  show("#sectionDetail");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* -------- Panier -------- */
function renderCart() {
  const box = $("#cartLines");
  box.innerHTML = "";

  if (!CART.length) {
    box.innerHTML =
      '<div class="card"><div class="card-body"><div class="card-title-wrap">Votre panier est vide.</div></div></div>';
  }

  CART.forEach((l, i) => {
    // ✅ PACK (1 seule bulle)
    if (l.is_pack) {
      const row = document.createElement("div");
      row.className = "cart-line";
      row.innerHTML = `
        <img src="${imgOrFallback(l.image_url)}" alt="${l.title}">
        <div class="cart-info">
          <div class="cart-title">${l.title}</div>
          <div class="cart-meta muted">${l.qty} pack(s)</div>

          <div class="muted" style="margin-top:8px;line-height:1.35">
            ${(l.children || []).map(ch => {
              const up = (Number(ch.extra_price) || 0) > 0 ? ` (+${euros(ch.extra_price)} /u)` : "";
              const fl = ch.flocage_text ? ` · Flocage: ${ch.flocage_text}` : "";
              return `• ${ch.qty}× ${ch.title} — ${ch.size || "-"} · ${ch.color || "-"} · ${ch.gender || "-"} · Logo: ${ch.logo || "-"}${fl}${up}`;
            }).join("<br>")}
          </div>

          <div class="cart-qty" style="margin-top:10px">${l.qty} × ${euros(l.price)}</div>
        </div>
        <div class="cart-actions">
          <div class="cart-total">${euros((Number(l.price) || 0) * (Number(l.qty) || 1))}</div>
          <button class="btn btn-outline btn-remove" data-i="${i}">Supprimer</button>
        </div>
      `;
      box.appendChild(row);
      return;
    }

    // ✅ LIGNE NORMAL
    const row = document.createElement("div");
    row.className = "cart-line";
    row.innerHTML = `
      <img src="${imgOrFallback(l.image_url)}" alt="${l.title}">
      <div class="cart-info">
        <div class="cart-title">${l.title}</div>
        <div class="cart-meta muted">${l.size || "-"} · ${l.color || "-"} · ${l.gender || "-"} · Logo: ${l.logo || "-"}${l.flocage_text ? " · Flocage: " + l.flocage_text : ""}</div>
        <div class="cart-qty">${l.qty} × ${euros(l.price)}</div>
      </div>
      <div class="cart-actions">
        <div class="cart-total">${euros((Number(l.price) || 0) * (Number(l.qty) || 1))}</div>
        <button class="btn btn-outline btn-remove" data-i="${i}">Supprimer</button>
      </div>`;
    box.appendChild(row);
  });

  box.onclick = (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    CART.splice(Number(b.dataset.i), 1);
    saveCart();
    renderCart();
    refreshCartBadge();
  };

  $("#cartTotal").textContent = euros(cartTotal());
}

/* -------- Bootstrap -------- */
window.addEventListener("DOMContentLoaded", () => {
  loadCart();
  loadCatalog();

  $$(".chip.cat").forEach((c) => {
    c.addEventListener("click", () => {
      CURRENT_CAT = c.dataset.cat;
      $("#prodTitle").textContent = CURRENT_CAT;
      renderProducts();
      show("#sectionProducts");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  $("#backHome").addEventListener("click", () => show("#sectionCategories"));
  $("#backHome2").addEventListener("click", () => show("#sectionCategories"));

  $("#btnCart").addEventListener("click", () => {
    renderCart();
    show("#sectionCart");
  });

  $("#btnValidate").addEventListener("click", () => {
    if (!CART.length) {
      alert("Panier vide");
      return;
    }
    const name = ($("#custName").value || "").trim();
    const email = ($("#custEmail").value || "").trim();
    const phone = ($("#custPhone").value || "").trim();

    if (!name || !email) {
      alert("Nom et e-mail sont obligatoires.");
      return;
    }

    if (!phone) {
      alert("Téléphone obligatoire.");
      $("#result").textContent = "";
      $("#custPhone").focus();
      return;
    }

    $("#btnValidate").disabled = true;
    $("#result").textContent = isAppsScript
      ? "Génération du PDF…"
      : "Envoi de la commande…";

    // ---- APPS SCRIPT ----
    if (isAppsScript) {
      const payload = { customer: { name, email, phone }, items: CART, total: cartTotal() };

      google.script.run
        .withSuccessHandler((res) => {
          $("#doneMsg").textContent = `Commande n° ${res.order_id}. L'organisation a bien reçu votre commande.`;

          const pdf = (res && (res.pdf_url || res.pdfUrl)) ? String(res.pdf_url || res.pdfUrl).trim() : "";
          const a = $("#donePdf");
          if (pdf) {
            a.href = pdf;
            a.target = "_blank";
            a.rel = "noopener";
            a.style.pointerEvents = "auto";
            a.style.opacity = "1";
          } else {
            a.href = "#";
            a.style.pointerEvents = "none";
            a.style.opacity = "0.5";
          }

          $("#btnValidate").disabled = false;
          $("#result").textContent = "";
          CART = [];
          saveCart();
          refreshCartBadge();
          show("#sectionDone");
          window.scrollTo({ top: 0, behavior: "smooth" });
        })
        .withFailureHandler((err) => {
          $("#result").textContent =
            "Erreur : " + (err && err.message ? err.message : err);
          $("#btnValidate").disabled = false;
        })
        .createOrder(payload);

      return;
    }

    // ---- GITHUB PAGES -> CLOUDFARE WORKER ----
    const base =
      (window.ORDER_API_URL || "").replace(/\/$/, "") ||
      (APPS_SCRIPT_PROXY || APPS_SCRIPT_DEPLOY);

    if (!base) {
      $("#result").textContent =
        "Aucun endpoint de commande configuré. Renseigne window.ORDER_API_URL (Cloudflare Worker) ou APPS_SCRIPT_DEPLOY.";
      $("#btnValidate").disabled = false;
      return;
    }

    const orderUrl = base.includes("workers.dev") ? base + "/api/order" : base;

    const order = {
      customer_name: name,
      phone: phone || "",
      total: cartTotal(),
      status: "new",
    };

    // ✅ Flatten panier (packs -> lignes) pour Worker/Sheet
const flatCart = [];
CART.forEach((l) => {
  if (l.is_pack) {
    // 1 ligne "pack" au prix du pack
    flatCart.push({
      product_id: l.pack_id || l.product_id || "",
      title: l.title || "Pack",
      color: "",
      gender: "",
      size: "",
      qty: l.qty || 1,
      price: l.price || 0,
      logo: "",
      flocage_text: "",
      image_url: l.image_url || "",
      is_pack: true,
    });

    // + les items inclus à 0€
    (l.children || []).forEach((ch) => {
      flatCart.push({
        product_id: ch.product_id || "",
        title: ch.title || "",
        color: ch.color || "",
        gender: ch.gender || "",
        size: ch.size || "",
        qty: ch.qty || 1,
        price: 0,
        logo: ch.logo || "",
        flocage_text: ch.flocage_text || "",
        image_url: ch.image_url || "",
        parent_pack: l.pack_id || "",
        extra_price: ch.extra_price || 0,
      });
    });

    return;
  }

  // produit normal
  flatCart.push(l);
});

// ✅ Worker attend items[] -> on mappe flatCart
const items = flatCart.map((it, idx) => ({
  line: idx + 1,
  product_id: it.product_id || "",
  title: it.title || "",
  color: it.color || "",
  gender: it.gender || "",
  size: it.size || "",
  qty: it.qty || 1,
  unit_price: it.price || 0,
  logo: it.logo || "",
  flocage_text: it.flocage_text || "",
  image_url: it.image_url || "",
}));

    fetch(orderUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order, items }),
    })
      .then((r) => {
        if (!r.ok)
          return r.text().then((t) => {
            throw new Error(t || r.statusText);
          });
        return r.json();
      })
      .then((res) => {
        if (res.ok === false) throw new Error(res.error || "Erreur inconnue");

        $("#doneMsg").textContent = `Commande n° ${res.order_id || "?"}. L'organisation a bien reçu votre commande.`;

        const pdf = (res && (res.pdf_url || res.pdfUrl)) ? String(res.pdf_url || res.pdfUrl).trim() : "";
        const a = $("#donePdf");
        if (pdf) {
          a.href = pdf;
          a.target = "_blank";
          a.rel = "noopener";
          a.style.pointerEvents = "auto";
          a.style.opacity = "1";
        } else {
          a.href = "#";
          a.style.pointerEvents = "none";
          a.style.opacity = "0.5";
        }

        $("#btnValidate").disabled = false;
        $("#result").textContent = "";

        CART = [];
        saveCart();
        refreshCartBadge();
        renderCart();
        show("#sectionDone");
        window.scrollTo({ top: 0 });
      })
      .catch((err) => {
        $("#result").textContent =
          "Erreur : " + (err && err.message ? err.message : err);
        $("#btnValidate").disabled = false;
      });
  });

  $("#doneBack").addEventListener("click", () => {
    show("#sectionCategories");
    window.scrollTo({ top: 0 });
  });
});
