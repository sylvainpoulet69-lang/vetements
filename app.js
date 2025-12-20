let CATALOG = { products: [], variants: [], packItems: [], options: {} };
let CURRENT_CAT = null;
let CART = [];

const ADULT_SIZES = ["S", "M", "L", "XL", "XXL"];
const KID_SIZES = ["4", "6", "8", "10", "12", "14"];

/* === CONFIG BACKEND APPS SCRIPT === */
window.APPS_SCRIPT_DEPLOY =
  "https://script.google.com/macros/s/AKfycbyT0xk6dAiPoBIGf96VT52HC6FcWqG7M40Wv_Om3hLRy3ITQXZPs32l8Kb2rZp-MZl0Dw/exec";

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

/* -------- ACCUEIL -------- */
function renderHome() {
  const hh = $("#heroTitle");
  if (hh) hh.textContent = "Choisis tes vêtements club";
  const hs = $("#heroSubtitle");
  if (hs) hs.textContent = "Logos inclus · Flocage personnalisé inclus";

  const list = $("#homeList");
  list.innerHTML = "";
  const items = CATALOG.products
    .filter(
      (p) =>
        p.active === true || String(p.active).toLowerCase() === "true"
    )
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
        <button class="btn btn-ghost btn-small" data-id="${
          p.product_id
        }">Choisir</button>
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
        <button class="btn btn-ghost btn-small" data-id="${
          p.product_id
        }">Choisir</button>
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
  if (String(p.type).toLowerCase() === "pack") {
    return openPackDetail(p);
  }

  const vars = CATALOG.variants.filter((v) => String(v.product_id) === String(pid));
  const colors = [...new Set(vars.map((v) => v.color).filter(Boolean))];
  const genders = [...new Set(vars.map((v) => v.gender_scope).filter(Boolean))];

  $("#detail").innerHTML = `
    <div style="display:flex;gap:12px;margin-bottom:16px">
      <button id="goHome" class="back">Accueil</button>
      <button id="backList" class="back">Produits</button>
    </div>

    <div class="detail">
      <img class="detail-img" src="${imgOrFallback(p.image_url)}" alt="${p.title}">
      <h3>${p.title}</h3>
      <div class="price" style="margin-bottom:12px">${euros(p.price)}</div>

      <label>Genre</label>
      <div class="pills" id="pickGender">
        ${["H", "F", "Unisexe", "Enfant"]
          .filter((g) => !genders.length || genders.includes(g))
          .map((g) => `<button class="pill" data-val="${g}">${g}</button>`)
          .join("")}
      </div>

      <label>Taille</label>
      <div class="pills sizes-grid" id="pickSize"></div>

      <label>Couleur</label>
      <div class="swatches" id="pickColor">
        ${(colors.length ? colors : CATALOG.options.colors_default || ["Bleu", "Blanc", "Noir", "Rose"])
          .map(
            (c) => `
            <div class="swatch" data-val="${c}">
              <div class="dot" style="background:${colorToHex(c)}"></div>
              <div class="name">${c}</div>
            </div>`,
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

  const sel = { color: null, gender: null, size: null, logo: "Aucun" };

  function renderSizes() {
    const base = sel.gender === "Enfant" ? KID_SIZES : ADULT_SIZES;
    const cands = vars.filter(
      (v) =>
        (!sel.color || v.color === sel.color) &&
        (!sel.gender || v.gender_scope === sel.gender)
    );
    const set = new Set(
      cands.flatMap((v) => {
        const list = (v.size_list || "")
          .toString()
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        return list.length ? list : base;
      })
    );
    const final = set.size ? Array.from(set) : base;

    const box = $("#pickSize");
    box.innerHTML = final.map((s) => `<button class="pill" data-val="${s}">${s}</button>`).join("");

    if (sel.size) {
      const match = Array.from(box.querySelectorAll(".pill")).find(
        (b) => b.dataset.val === sel.size
      );
      if (match) match.classList.add("active");
      else sel.size = null;
    }
  }

  const g0 = $("#pickGender .pill");
  if (g0) {
    g0.classList.add("active");
    sel.gender = g0.dataset.val;
  }
  const l0 = $("#pickLogo .pill");
  if (l0) {
    l0.classList.add("active");
    sel.logo = l0.dataset.val;
  }
  const c0 = $("#pickColor .swatch");
  if (c0) {
    c0.classList.add("active");
    sel.color = c0.dataset.val;
  }
  renderSizes();

  $("#pickGender").addEventListener("click", (e) => {
    const b = e.target.closest(".pill");
    if (!b) return;
    $$("#pickGender .pill").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    sel.gender = b.dataset.val;
    renderSizes();
  });
  $("#pickSize").addEventListener("click", (e) => {
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
    if (!sel.gender || !sel.size || !sel.color) {
      alert("Choisir genre, taille et couleur.");
      return;
    }
    CART.push({
      product_id: p.product_id,
      title: p.title,
      color: sel.color,
      gender: sel.gender,
      size: sel.size,
      qty,
      price: p.price,
      logo: sel.logo,
      flocage_text: ($("#flocText").value || "").trim(),
      image_url: imgOrFallback(p.image_url),
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
  const items = CATALOG.packItems.filter(
    (x) => String(x.pack_id) === String(p.product_id)
  );

  $("#detail").innerHTML = `
    <div style="display:flex;gap:12px;margin-bottom:16px">
      <button id="goHome" class="back">Accueil</button>
      <button id="backList" class="back">Produits</button>
    </div>
    <div class="detail">
      <img class="detail-img" src="${imgOrFallback(p.image_url)}" alt="${p.title}">
      <h3>${p.title} — Pack</h3>
      <div class="price" style="margin-bottom:12px">${euros(p.price)}</div>

      <label>Genre</label>
      <div class="pills" id="packGender">${["H", "F", "Unisexe", "Enfant"]
        .map((g) => `<button class="pill" data-val="${g}">${g}</button>`)
        .join("")}</div>

      <label>Taille</label>
      <div class="pills sizes-grid" id="packSize"></div>

      <label>Couleur</label>
      <div class="swatches" id="packColor">
        ${(CATALOG.options.colors_default || ["Bleu", "Blanc", "Noir", "Rose"])
          .map((c) => `
          <div class="swatch" data-val="${c}">
            <div class="dot" style="background:${colorToHex(c)}"></div>
            <div class="name">${c}</div>
          </div>`)
          .join("")}
      </div>

      <label>Logo (inclus)</label>
      <div class="pills" id="packLogo">${(CATALOG.options.logo || ["Tennis", "Padel", "Aucun"])
        .map((l) => `<button class="pill" data-val="${l}">${l}</button>`)
        .join("")}</div>

      <label>Flocage (inclus)</label>
      <input id="packFloc" class="inp" placeholder="Texte (ex: NOM)">
      <label>Quantité de packs</label>
      <input id="packQty" class="inp" type="number" min="1" value="1">

      <div class="actions"><button id="btnAddPack" class="btn btn-primary">🛒 Ajouter le pack</button></div>
    </div>
  `;

  const sel = { color: null, gender: null, size: null, logo: "Aucun" };

  function ensureSize() {
    const base = sel.gender === "Enfant" ? KID_SIZES : ADULT_SIZES;
    const box = $("#packSize");
    box.innerHTML = base.map((s) => `<button class="pill" data-val="${s}">${s}</button>`).join("");
    if (sel.size) {
      const match = Array.from(box.querySelectorAll(".pill")).find(
        (b) => b.dataset.val === sel.size
      );
      if (match) match.classList.add("active");
      else sel.size = null;
    }
  }
  ensureSize();

  const g0 = $("#packGender .pill");
  if (g0) {
    g0.classList.add("active");
    sel.gender = g0.dataset.val;
  }
  const l0 = $("#packLogo .pill");
  if (l0) {
    l0.classList.add("active");
    sel.logo = l0.dataset.val;
  }
  const c0 = $("#packColor .swatch");
  if (c0) {
    c0.classList.add("active");
    sel.color = c0.dataset.val;
  }

  $("#packGender").addEventListener("click", (e) => {
    const b = e.target.closest(".pill");
    if (!b) return;
    $$("#packGender .pill").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    sel.gender = b.dataset.val;
    ensureSize();
  });
  $("#packSize").addEventListener("click", (e) => {
    const b = e.target.closest(".pill");
    if (!b) return;
    $$("#packSize .pill").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    sel.size = b.dataset.val;
  });
  $("#packColor").addEventListener("click", (e) => {
    const s = e.target.closest(".swatch");
    if (!s) return;
    $$("#packColor .swatch").forEach((x) => x.classList.remove("active"));
    s.classList.add("active");
    sel.color = s.dataset.val;
  });
  $("#packLogo").addEventListener("click", (e) => {
    const b = e.target.closest(".pill");
    if (!b) return;
    $$("#packLogo .pill").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    sel.logo = b.dataset.val;
  });

  $("#btnAddPack").addEventListener("click", () => {
    const qty = Math.max(1, Number($("#packQty").value || 1));
    if (!sel.gender || !sel.size || !sel.color) {
      alert("Choisir genre, taille et couleur.");
      return;
    }
    CART.push({
      product_id: p.product_id,
      title: p.title + " — Pack",
      color: sel.color,
      gender: sel.gender,
      size: sel.size,
      qty,
      price: p.price,
      logo: sel.logo,
      flocage_text: ($("#packFloc").value || "").trim(),
      image_url: imgOrFallback(p.image_url),
      is_pack: true,
    });
    items.forEach((it) => {
      const prod = CATALOG.products.find(
        (pr) => String(pr.product_id) === String(it.product_id)
      );
      CART.push({
        product_id: it.product_id,
        title: it.title,
        color: sel.color,
        gender: sel.gender,
        size: sel.size,
        qty: (it.qty || 1) * qty,
        price: 0,
        logo: sel.logo,
        flocage_text: ($("#packFloc").value || "").trim(),
        image_url: prod ? imgOrFallback(prod.image_url) : imgOrFallback(p.image_url),
        parent_pack: p.product_id,
      });
    });
    saveCart();
    refreshCartBadge();
    show("#sectionCategories");
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
    const row = document.createElement("div");
    row.className = "cart-line";
    row.innerHTML = `
      <img src="${imgOrFallback(l.image_url)}" alt="${l.title}">
      <div class="cart-info">
        <div class="cart-title">${l.title}</div>
        <div class="cart-meta muted">${l.size || "-"} · ${l.color || "-"} · ${l.gender || "-"} · Logo: ${
      l.logo || "-"
    }${l.flocage_text ? " · Flocage: " + l.flocage_text : ""}</div>
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
    if (!name || !email || !phone) {
  alert("Nom, e-mail et téléphone sont obligatoires.");
  return;
}
    }

    $("#btnValidate").disabled = true;
    $("#result").textContent = isAppsScript
      ? "Génération du PDF…"
      : "Envoi de la commande…";

    // ---- APPS SCRIPT (inchangé) ----
    if (isAppsScript) {
      const payload = { customer: { name, email, phone }, items: CART, total: cartTotal() };

      google.script.run
        .withSuccessHandler((res) => {
          $("#doneMsg").textContent = `Commande n° ${res.order_id}. L'organisation a bien reçu votre commande.`;
          $("#donePdf").href = res.pdfUrl;
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

    // Worker expects /api/order
    const orderUrl = base.includes("workers.dev") ? base + "/api/order" : base;

    // ✅ Build payload for your Worker: { order, items }
    const order = {
      customer_name: name,
      phone: phone || "",
      total: cartTotal(),
      status: "new",
      // optionnel:
      // date: new Date().toISOString(),
      // pdf_url: ""
    };

    const items = CART.map((it, idx) => ({
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
        $("#donePdf").href = "#"; // pas de PDF pour l'instant

        $("#btnValidate").disabled = false;
        $("#result").textContent = "";

        // reset
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
