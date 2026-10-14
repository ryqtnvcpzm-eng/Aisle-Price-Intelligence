/**
 * The price-capture bookmarklet.
 *
 * The owner opens an Amazon.in product page in their own browser and clicks
 * the bookmarklet. It reads that one page's DOM, shows what it found, and
 * POSTs it to Aisle. It never fetches anything from Amazon, never runs on its
 * own and never touches any other page: one click, one page, one capture.
 *
 * The extractor is kept as plain-JavaScript source (ES2017, no imports) so the
 * exact code that ships in the bookmark is what the unit tests evaluate against
 * HTML fixtures.
 */

/** Price selectors, in the order they're tried. The one that matched is recorded with each capture. */
export const PRICE_SELECTORS = ["#corePrice_feature_div .a-offscreen", "#priceblock_ourprice", "#priceblock_dealprice", ".a-price.a-text-price .a-offscreen"] as const;

/** This selector usually holds the struck-through M.R.P., not the selling price. */
export const LIST_PRICE_FALLBACK = ".a-price.a-text-price .a-offscreen";

export interface CapturePayload {
  asin: string | null;
  title: string | null;
  priceMinor: number | null;
  currency: "INR";
  url: string;
  variantLabel: string | null;
  availability: string | null;
  capturedAt: string;
  selector: string | null;
  isDeal: boolean;
}

export const EXTRACTOR_SOURCE = String.raw`({
  selectors: ${JSON.stringify(PRICE_SELECTORS)},
  clean: function (s) {
    return s == null ? "" : String(s).replace(/[ ‎‏]/g, " ").replace(/\s+/g, " ").trim();
  },
  parsePriceMinor: function (text) {
    var t = this.clean(text);
    if (!t) return null;
    // A range ("₹199.00 - ₹499.00") is not one price.
    if (/\d\s*[-–]\s*(?:₹|Rs\.?)?\s*\d/.test(t)) return null;
    var m = t.match(/(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?/);
    if (!m) return null;
    var whole = parseInt(m[1].replace(/,/g, ""), 10);
    if (!isFinite(whole)) return null;
    var frac = m[2] ? parseInt((m[2] + "0").slice(0, 2), 10) : 0;
    return whole * 100 + frac;
  },
  detectAsin: function (doc, href) {
    var path = "";
    try { path = new URL(href).pathname; } catch (e) { path = ""; }
    var m = path.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Za-z0-9]{10})(?:[\/?#]|$)/);
    if (m) return m[1].toUpperCase();
    var el = doc.querySelector("#ASIN") || doc.querySelector("input[name='ASIN']");
    var v = el ? this.clean(el.value || el.getAttribute("value")) : "";
    return /^[A-Za-z0-9]{10}$/.test(v) ? v.toUpperCase() : null;
  },
  variantLabel: function (doc) {
    var parts = [];
    var sel = doc.querySelectorAll("[id^='variation_'] .selection");
    for (var i = 0; i < sel.length; i++) { var t = this.clean(sel[i].textContent); if (t) parts.push(t); }
    if (!parts.length) {
      var inl = doc.querySelectorAll("[id^='inline-twister-expanded-dimension-text-']");
      for (var j = 0; j < inl.length; j++) { var u = this.clean(inl[j].textContent); if (u) parts.push(u); }
    }
    return parts.length ? parts.join(" · ") : null;
  },
  extract: function (doc, href) {
    var asin = this.detectAsin(doc, href);
    var titleEl = doc.querySelector("#productTitle");
    var price = null;
    var selector = null;
    for (var i = 0; i < this.selectors.length; i++) {
      var el = doc.querySelector(this.selectors[i]);
      if (!el) continue;
      var p = this.parsePriceMinor(el.textContent);
      if (p !== null) { price = p; selector = this.selectors[i]; break; }
    }
    var badge = doc.querySelector("#dealBadge_feature_div, #dealBadgeSupportingText, .dealBadge");
    var isDeal = selector === "#priceblock_dealprice" || !!(badge && /deal/i.test(badge.textContent || ""));
    var avEl = doc.querySelector("#availability span") || doc.querySelector("#availability");
    var availability = avEl ? this.clean(avEl.textContent) : "";
    var url = "";
    try { var u = new URL(href); url = asin ? u.origin + "/dp/" + asin : u.origin + u.pathname; } catch (e) { url = String(href).split(/[?#]/)[0]; }
    return {
      asin: asin,
      title: titleEl ? this.clean(titleEl.textContent) || null : null,
      priceMinor: price,
      currency: "INR",
      url: url,
      variantLabel: this.variantLabel(doc),
      availability: availability || null,
      capturedAt: new Date().toISOString(),
      selector: selector,
      isDeal: isDeal
    };
  }
})`;

/**
 * The full bookmarklet: extract, show a toast on the page, POST to Aisle. If
 * the page's security policy blocks the request, hand the capture to a small
 * Aisle window instead (the data travels in the URL fragment, which is never
 * sent to any server; that window posts it with your Aisle session).
 */
export function bookmarkletSource(opts: { appUrl: string; token: string }) {
  const app = opts.appUrl.replace(/\/$/, "");
  return String.raw`(function () {
  var X = ${EXTRACTOR_SOURCE};
  var APP = ${JSON.stringify(app)};
  var TOKEN = ${JSON.stringify(opts.token)};
  var old = document.getElementById("aisle-capture-toast");
  if (old) old.remove();
  function money(m) { return "₹" + (m / 100).toLocaleString("en-IN", { minimumFractionDigits: m % 100 ? 2 : 0, maximumFractionDigits: 2 }); }
  function toast(lines, kind, link) {
    var prev = document.getElementById("aisle-capture-toast");
    if (prev) prev.remove();
    var box = document.createElement("div");
    box.id = "aisle-capture-toast";
    box.setAttribute("role", "status");
    box.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:360px;padding:12px 14px;border-radius:14px;font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1d1d1f;background:#fff;box-shadow:0 10px 30px rgba(0,0,0,.18),0 0 0 .5px rgba(0,0,0,.12);border-left:4px solid " + (kind === "ok" ? "#0a6fd6" : kind === "warn" ? "#b4561c" : "#86868b");
    var head = document.createElement("div");
    head.style.cssText = "font-weight:600;margin-bottom:2px";
    head.textContent = "Aisle · " + lines[0];
    box.appendChild(head);
    for (var i = 1; i < lines.length; i++) { var p = document.createElement("div"); p.style.color = "#424245"; p.textContent = lines[i]; box.appendChild(p); }
    if (link) { var a = document.createElement("a"); a.href = link.href; a.target = "_blank"; a.rel = "noopener"; a.textContent = link.text; a.style.cssText = "display:inline-block;margin-top:6px;color:#0a6fd6;font-weight:600;text-decoration:none"; box.appendChild(a); }
    box.addEventListener("click", function (e) { if (e.target === box) box.remove(); });
    document.body.appendChild(box);
    setTimeout(function () { if (box.parentNode) box.remove(); }, link ? 12000 : 7000);
  }
  if (!/(^|\.)amazon\.in$/.test(location.hostname)) { toast(["Not an Amazon.in page", "Open a product page on amazon.in, then click again."], "warn"); return; }
  var d = X.extract(document, location.href);
  if (!d.asin) { toast(["No product found", "This doesn't look like a product page. Open one product, then click again."], "warn"); return; }
  var what = (d.title || d.asin).slice(0, 90);
  if (d.priceMinor === null) toast(["Capturing " + d.asin, what, "No price on this page" + (d.availability ? " (" + d.availability + ")" : "") + " — recording availability only."], "warn");
  else toast(["Capturing…", what, money(d.priceMinor) + (d.isDeal ? " · deal" : "") + (d.variantLabel ? " · " + d.variantLabel : "")], "info");
  function handOff() {
    var w = window.open(APP + "/capture/receive#" + encodeURIComponent(JSON.stringify(d)), "aisle-capture", "width=440,height=360");
    if (!w) toast(["Couldn't reach Aisle", "This page blocked the request and the pop-up. Allow pop-ups for amazon.in and click again."], "warn");
  }
  fetch(APP + "/api/capture", { method: "POST", mode: "cors", credentials: "omit", headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN }, body: JSON.stringify(d) })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
    .then(function (res) {
      if (res.ok) {
        var c = res.j.capture || {};
        toast([c.duplicate ? "Already captured" : "Captured", what, d.priceMinor === null ? "Availability: " + (d.availability || "unknown") : money(d.priceMinor) + (d.isDeal ? " · deal price" : "") + (c.variant ? " · " + c.variant : "")], "ok");
      } else if (res.status === 404 && res.j.error === "untracked_asin") {
        toast(["Not tracked yet", d.asin + " isn't in your Aisle products."], "warn", { href: res.j.importUrl, text: "Import this product →" });
      } else if (res.status === 401) {
        toast(["Token not accepted", "Your capture token was regenerated or revoked. Reinstall the bookmarklet from Aisle → Settings → Capture."], "warn");
      } else {
        toast(["Not captured", (res.j.error && res.j.error.message) || res.j.message || "Aisle returned an error (" + res.status + ")."], "warn");
      }
    })
    .catch(handOff);
})();`;
}

/** A `javascript:` URL ready to drag to the bookmarks bar. */
export function bookmarkletHref(opts: { appUrl: string; token: string }) {
  return `javascript:${encodeURIComponent(bookmarkletSource(opts))}`;
}
