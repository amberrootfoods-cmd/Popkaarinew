(function initPopkaariStore() {
  "use strict";

  const CONFIG = {
    orderEndpoint: "/.netlify/functions/orders",
    whatsappNumber: "919910657383",
    cartKey: "popkaari_cart_v1",
    draftKey: "popkaari_checkout_draft_v1",
    pendingOrdersKey: "popkaari_pending_orders_v1",
    maxQuantityPerSku: 10,
  };

  const PRODUCTS = Object.freeze({
    "raw-makhana-100g": Object.freeze({
      sku: "raw-makhana-100g",
      name: "Raw Makhana",
      variant: "100g",
      pricePaise: 24900,
      image: "images/AdobeStock_1660218720.jpeg",
      inStock: true,
    }),
  });

  const state = {
    cart: loadCart(),
    coupon: "",
    lastFocused: null,
  };

  const drawer = document.getElementById("cartDrawer");
  const backdrop = document.getElementById("cartBackdrop");
  const closeButton = document.getElementById("closeCart");
  const cartItems = document.getElementById("cartItems");
  const emptyState = document.getElementById("cartEmpty");
  const checkoutWrap = document.getElementById("cartCheckout");
  const checkoutForm = document.getElementById("checkoutForm");
  const checkoutStatus = document.getElementById("checkoutStatus");
  const successBox = document.getElementById("orderSuccess");
  const successKicker = document.getElementById("orderSuccessKicker");
  const successTitle = document.getElementById("orderSuccessTitle");
  const successCopy = document.getElementById("orderSuccessCopy");
  const successWhatsApp = document.getElementById("orderWhatsApp");
  const couponInput = document.getElementById("couponInput");
  const applyCouponButton = document.getElementById("applyCoupon");

  if (!drawer || !backdrop || !closeButton || !cartItems || !checkoutForm) {
    console.warn("[Popkaari store] Cart markup is missing; direct ordering was not initialised.");
    return;
  }

  restoreDraft();
  renderCart();

  document.addEventListener("click", (event) => {
    const addButton = event.target.closest("[data-add-to-cart]");
    if (addButton) {
      event.preventDefault();
      addToCart(addButton.getAttribute("data-add-to-cart"));
      return;
    }

    const trigger = event.target.closest(".cart-trigger");
    if (trigger) {
      event.preventDefault();
      openCart(trigger);
      return;
    }

    const quantityButton = event.target.closest("[data-cart-quantity]");
    if (quantityButton) {
      const sku = quantityButton.getAttribute("data-sku");
      const delta = Number(quantityButton.getAttribute("data-cart-quantity"));
      changeQuantity(sku, delta);
      return;
    }

    const removeButton = event.target.closest("[data-remove-from-cart]");
    if (removeButton) {
      removeFromCart(removeButton.getAttribute("data-remove-from-cart"));
    }
  });

  closeButton.addEventListener("click", closeCart);
  backdrop.addEventListener("click", closeCart);
  drawer.addEventListener("keydown", trapFocus);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && drawer.classList.contains("open")) closeCart();
  });

  applyCouponButton?.addEventListener("click", applyCoupon);
  couponInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyCoupon();
    }
  });

  checkoutForm.addEventListener("input", debounce(saveDraft, 250));
  checkoutForm.addEventListener("submit", submitOrder);

  function addToCart(sku) {
    const product = PRODUCTS[sku];
    if (!product || !product.inStock) return;
    const current = state.cart.find((item) => item.sku === sku);
    if (current) {
      current.quantity = Math.min(CONFIG.maxQuantityPerSku, current.quantity + 1);
    } else {
      state.cart.push({ sku, quantity: 1 });
    }
    saveCart();
    renderCart();
    openCart(document.activeElement);
    track("add_to_cart", { currency: "INR", value: product.pricePaise / 100, items: [analyticsItem(product, 1)] });
  }

  function changeQuantity(sku, delta) {
    const item = state.cart.find((entry) => entry.sku === sku);
    if (!item || !PRODUCTS[sku]) return;
    const next = Math.max(0, Math.min(CONFIG.maxQuantityPerSku, item.quantity + delta));
    if (next === 0) {
      removeFromCart(sku);
      return;
    }
    item.quantity = next;
    saveCart();
    renderCart();
  }

  function removeFromCart(sku) {
    const product = PRODUCTS[sku];
    const existing = state.cart.find((item) => item.sku === sku);
    state.cart = state.cart.filter((item) => item.sku !== sku);
    saveCart();
    renderCart();
    if (product && existing) {
      track("remove_from_cart", {
        currency: "INR",
        value: (product.pricePaise * existing.quantity) / 100,
        items: [analyticsItem(product, existing.quantity)],
      });
    }
  }

  function renderCart() {
    cartItems.replaceChildren();
    const itemCount = state.cart.reduce((total, item) => total + item.quantity, 0);
    document.querySelectorAll(".cart-count").forEach((element) => {
      element.textContent = String(itemCount);
      element.setAttribute("aria-label", `${itemCount} ${itemCount === 1 ? "item" : "items"}`);
    });

    state.cart.forEach((item) => {
      const product = PRODUCTS[item.sku];
      if (!product) return;
      cartItems.appendChild(createCartLine(product, item.quantity));
    });

    const hasItems = state.cart.length > 0;
    emptyState.hidden = hasItems;
    checkoutWrap.hidden = !hasItems;
    if (hasItems) {
      checkoutForm.hidden = false;
      successBox.hidden = true;
    }
    updateTotals();
  }

  function createCartLine(product, quantity) {
    const article = document.createElement("article");
    article.className = "cart-line";

    const image = document.createElement("img");
    image.src = product.image;
    image.alt = `${product.name} ${product.variant}`;
    image.loading = "lazy";

    const details = document.createElement("div");
    const title = document.createElement("div");
    title.className = "cart-line-title";
    title.textContent = product.name;
    const meta = document.createElement("div");
    meta.className = "cart-line-meta";
    meta.textContent = `${product.variant} • ${formatINR(product.pricePaise)} each`;
    const quantityControl = document.createElement("div");
    quantityControl.className = "quantity-control";
    quantityControl.setAttribute("aria-label", `Quantity for ${product.name}`);
    quantityControl.append(
      quantityButton("−", product.sku, -1, `Reduce ${product.name} quantity`),
      quantityOutput(quantity),
      quantityButton("+", product.sku, 1, `Increase ${product.name} quantity`),
    );
    details.append(title, meta, quantityControl);

    const price = document.createElement("div");
    price.className = "cart-line-price";
    const amount = document.createElement("div");
    amount.textContent = formatINR(product.pricePaise * quantity);
    const remove = document.createElement("button");
    remove.className = "cart-remove";
    remove.type = "button";
    remove.textContent = "Remove";
    remove.setAttribute("data-remove-from-cart", product.sku);
    remove.setAttribute("aria-label", `Remove ${product.name} from cart`);
    price.append(amount, remove);

    article.append(image, details, price);
    return article;
  }

  function quantityButton(label, sku, delta, ariaLabel) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("data-sku", sku);
    button.setAttribute("data-cart-quantity", String(delta));
    button.setAttribute("aria-label", ariaLabel);
    return button;
  }

  function quantityOutput(quantity) {
    const output = document.createElement("output");
    output.textContent = String(quantity);
    output.setAttribute("aria-label", `Quantity ${quantity}`);
    return output;
  }

  function applyCoupon() {
    const code = String(couponInput?.value || "").trim().toUpperCase();
    const subtotal = calculateSubtotal();
    if (!code) {
      state.coupon = "";
      setStatus("");
    } else if (code === "POPKAARI50" && subtotal >= 24900) {
      state.coupon = code;
      couponInput.value = code;
      setStatus("₹50 discount applied.", false);
      track("select_promotion", { promotion_name: code });
    } else {
      state.coupon = "";
      setStatus("This coupon is not valid for the current cart.");
      updateTotals();
      saveDraft();
      return false;
    }
    updateTotals();
    saveDraft();
    return true;
  }

  function updateTotals() {
    const subtotal = calculateSubtotal();
    const discount = calculateDiscount(subtotal);
    const total = Math.max(0, subtotal - discount);
    document.getElementById("cartSubtotal").textContent = formatINR(subtotal);
    document.getElementById("cartDiscount").textContent = `−${formatINR(discount)}`;
    document.getElementById("cartTotal").textContent = formatINR(total);
  }

  async function submitOrder(event) {
    event.preventDefault();
    setStatus("");
    if (!applyCoupon()) return;
    if (!checkoutForm.reportValidity()) return;
    if (!state.cart.length) {
      setStatus("Your cart is empty.");
      return;
    }

    const formData = new FormData(checkoutForm);
    if (String(formData.get("company") || "").trim()) return;

    const phone = normalisePhone(formData.get("phone"));
    if (!phone) {
      setStatus("Please enter a valid 10-digit Indian mobile number.");
      checkoutForm.elements.phone.focus();
      return;
    }

    const customer = {
      name: clean(formData.get("name"), 80),
      phone,
      email: clean(formData.get("email"), 254).toLowerCase(),
      address1: clean(formData.get("address1"), 240),
      city: clean(formData.get("city"), 80),
      state: clean(formData.get("state"), 80),
      pincode: clean(formData.get("pincode"), 6),
      notes: clean(formData.get("notes"), 300),
    };

    const payload = {
      clientOrderId: createId(),
      items: state.cart.map((item) => ({ sku: item.sku, quantity: item.quantity })),
      coupon: state.coupon || null,
      customer,
      consent: true,
      source: "website_cart",
    };

    const submitButton = checkoutForm.querySelector("button[type='submit']");
    submitButton.disabled = true;
    submitButton.textContent = "Placing order…";
    setStatus("Saving your order securely…", false);
    track("begin_checkout", analyticsCheckoutPayload());

    try {
      const response = await fetchWithTimeout(CONFIG.orderEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      }, 9000);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new OrderError(data.message || "Order storage is unavailable.", response.status, data.code);
      finishOrder({ payload, orderNumber: data.orderNumber, stored: true });
    } catch (error) {
      if (error instanceof OrderError && error.status >= 400 && error.status < 500 && error.status !== 503) {
        setStatus(error.message || "Please check your order details and try again.");
        return;
      }
      savePendingOrder(payload);
      finishOrder({ payload, orderNumber: localReference(payload.clientOrderId), stored: false });
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Place order request";
    }
  }

  function finishOrder({ payload, orderNumber, stored }) {
    const totals = calculateTotals();
    const purchasedItems = payload.items.map((item) => analyticsItem(PRODUCTS[item.sku], item.quantity));
    const whatsappUrl = buildWhatsAppUrl(payload, orderNumber, totals, stored);
    checkoutForm.hidden = true;
    successBox.hidden = false;
    successKicker.textContent = stored ? "Saved securely" : "WhatsApp fallback";
    successTitle.textContent = stored ? `Order ${orderNumber} received` : "Finish your order on WhatsApp";
    successCopy.textContent = stored
      ? "Your order request is saved. Send the order number on WhatsApp so Popkaari can confirm delivery and share the payment link."
      : "The secure order database is not connected yet. Your cart and delivery draft remain on this device; send the details on WhatsApp to complete the order.";
    successWhatsApp.href = whatsappUrl;
    successWhatsApp.textContent = stored ? "Confirm order on WhatsApp" : "Send order on WhatsApp";
    setStatus("");

    if (stored) {
      state.cart = [];
      state.coupon = "";
      saveCart();
      clearDraft();
      document.querySelectorAll(".cart-count").forEach((element) => {
        element.textContent = "0";
        element.setAttribute("aria-label", "0 items");
      });
      track("purchase", {
        transaction_id: orderNumber,
        currency: "INR",
        value: totals.totalPaise / 100,
        coupon: payload.coupon || undefined,
        items: purchasedItems,
      });
    } else {
      track("generate_lead", { method: "whatsapp_order_fallback", value: totals.totalPaise / 100, currency: "INR" });
    }
  }

  function openCart(source) {
    state.lastFocused = source instanceof HTMLElement ? source : document.activeElement;
    drawer.classList.add("open");
    backdrop.classList.add("show");
    drawer.setAttribute("aria-hidden", "false");
    backdrop.setAttribute("aria-hidden", "false");
    document.body.classList.add("store-open");
    window.setTimeout(() => closeButton.focus(), 20);
    track("view_cart", analyticsCheckoutPayload());
  }

  function closeCart() {
    drawer.classList.remove("open");
    backdrop.classList.remove("show");
    drawer.setAttribute("aria-hidden", "true");
    backdrop.setAttribute("aria-hidden", "true");
    document.body.classList.remove("store-open");
    if (state.lastFocused instanceof HTMLElement) state.lastFocused.focus();
  }

  function trapFocus(event) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(drawer.querySelectorAll("button:not([disabled]), a[href], input:not([disabled]):not([tabindex='-1']), textarea:not([disabled])"))
      .filter((element) => !element.hidden && element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function saveCart() {
    try {
      localStorage.setItem(CONFIG.cartKey, JSON.stringify(state.cart));
    } catch (_) { /* Browsers may block storage; cart still works for this page view. */ }
  }

  function loadCart() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CONFIG.cartKey) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => PRODUCTS[item?.sku] && Number.isInteger(Number(item.quantity)))
        .map((item) => ({ sku: item.sku, quantity: Math.max(1, Math.min(CONFIG.maxQuantityPerSku, Number(item.quantity))) }));
    } catch (_) {
      return [];
    }
  }

  function saveDraft() {
    const formData = new FormData(checkoutForm);
    const draft = {};
    ["name", "phone", "email", "address1", "city", "state", "pincode", "notes", "coupon"].forEach((key) => {
      draft[key] = clean(formData.get(key), key === "address1" ? 240 : 300);
    });
    draft.updatedAt = new Date().toISOString();
    try { localStorage.setItem(CONFIG.draftKey, JSON.stringify(draft)); } catch (_) {}
  }

  function restoreDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(CONFIG.draftKey) || "null");
      if (!draft || typeof draft !== "object") return;
      ["name", "phone", "email", "address1", "city", "state", "pincode", "notes", "coupon"].forEach((key) => {
        if (checkoutForm.elements[key] && typeof draft[key] === "string") checkoutForm.elements[key].value = draft[key];
      });
      const savedCoupon = String(draft.coupon || "").toUpperCase();
      if (savedCoupon === "POPKAARI50") state.coupon = savedCoupon;
    } catch (_) {}
  }

  function clearDraft() {
    try { localStorage.removeItem(CONFIG.draftKey); } catch (_) {}
    checkoutForm.reset();
  }

  function savePendingOrder(payload) {
    try {
      const pending = JSON.parse(localStorage.getItem(CONFIG.pendingOrdersKey) || "[]");
      const safePending = Array.isArray(pending) ? pending.slice(-4) : [];
      safePending.push({ ...payload, savedAt: new Date().toISOString() });
      localStorage.setItem(CONFIG.pendingOrdersKey, JSON.stringify(safePending));
    } catch (_) {}
  }

  function calculateSubtotal() {
    return state.cart.reduce((sum, item) => sum + (PRODUCTS[item.sku]?.pricePaise || 0) * item.quantity, 0);
  }

  function calculateDiscount(subtotal) {
    return state.coupon === "POPKAARI50" && subtotal >= 24900 ? Math.min(5000, subtotal) : 0;
  }

  function calculateTotals() {
    const subtotalPaise = calculateSubtotal();
    const discountPaise = calculateDiscount(subtotalPaise);
    return { subtotalPaise, discountPaise, totalPaise: Math.max(0, subtotalPaise - discountPaise) };
  }

  function analyticsCheckoutPayload() {
    const totals = calculateTotals();
    return {
      currency: "INR",
      value: totals.totalPaise / 100,
      coupon: state.coupon || undefined,
      items: state.cart.map((item) => analyticsItem(PRODUCTS[item.sku], item.quantity)),
    };
  }

  function analyticsItem(product, quantity) {
    return {
      item_id: product.sku,
      item_name: product.name,
      item_variant: product.variant,
      price: product.pricePaise / 100,
      quantity,
    };
  }

  function track(eventName, params) {
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ event: eventName, ecommerce: params });
      if (typeof window.gtag === "function") window.gtag("event", eventName, params);
    } catch (_) {}
  }

  function buildWhatsAppUrl(payload, orderNumber, totals, stored) {
    const lines = [
      "Hi Popkaari! I want to confirm my website order.",
      `Order: ${orderNumber}`,
      stored ? "Status: Saved on website" : "Status: Website storage pending",
      "",
      ...payload.items.map((item) => {
        const product = PRODUCTS[item.sku];
        return `${product.name} ${product.variant} × ${item.quantity} — ${formatINR(product.pricePaise * item.quantity)}`;
      }),
      `Subtotal: ${formatINR(totals.subtotalPaise)}`,
      `Discount: ${formatINR(totals.discountPaise)}`,
      `Product total: ${formatINR(totals.totalPaise)}`,
      "Delivery/shipping: Please confirm",
      "",
      `Name: ${payload.customer.name}`,
      `Mobile: ${payload.customer.phone}`,
      `Pincode: ${payload.customer.pincode}`,
      `Address: ${payload.customer.address1}, ${payload.customer.city}, ${payload.customer.state}`,
      payload.customer.notes ? `Note: ${payload.customer.notes}` : "",
    ].filter(Boolean);
    return `https://wa.me/${CONFIG.whatsappNumber}?text=${encodeURIComponent(lines.join("\n"))}`;
  }

  function normalisePhone(value) {
    const digits = String(value || "").replace(/\D/g, "");
    const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
    return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : "";
  }

  function formatINR(paise) {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format((paise || 0) / 100);
  }

  function clean(value, maxLength) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
  }

  function createId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `pk-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function localReference(clientOrderId) {
    return `LOCAL-${String(clientOrderId).replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`;
  }

  function setStatus(message, isError = true) {
    checkoutStatus.textContent = message;
    checkoutStatus.style.color = isError ? "var(--popkaari-red)" : "#2f6b4f";
  }

  function debounce(fn, wait) {
    let timeout;
    return function debounced(...args) {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => fn.apply(this, args), wait);
    };
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function OrderError(message, status, code) {
    this.name = "OrderError";
    this.message = message;
    this.status = status;
    this.code = code;
  }
  OrderError.prototype = Object.create(Error.prototype);
})();
