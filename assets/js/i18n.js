/* i18n.js — FR/EN/ES in-place language swap.
   Isolated from main.js: only swaps text/attrs, never touches structure or motion.
   FR is the source (inline HTML); EN/ES live in assets/i18n/<lang>.json. */
(function () {
  "use strict";

  var SUPPORTED = ["fr", "en", "es"];
  var DEFAULT = "fr";
  var STORAGE_KEY = "jvm-lang";
  var OG_LOCALE = { fr: "fr_FR", en: "en_US", es: "es_ES" };
  var HTML_LANG = { fr: "fr-FR", en: "en", es: "es" };
  var SWITCH_LABEL = { fr: "Langue", en: "Language", es: "Idioma" };
  var SWITCH_ORDER = ["es", "en", "fr"];

  var SELF = document.currentScript;
  var I18N_BASE = SELF
    ? SELF.src.replace(/js\/i18n\.js.*$/, "i18n/")
    : "/assets/i18n/";

  var dicts = {};            // lang -> parsed dict
  var headFr = null;         // captured FR head values
  var captured = false;
  var current = { lang: "fr", dict: null };
  var REDUCE_MQ = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

  function qsa(sel) {
    return Array.prototype.slice.call(document.querySelectorAll(sel));
  }
  function store(lang) {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
  }
  function metaEl(attr, val) {
    return document.querySelector('meta[' + attr + '="' + val + '"]');
  }
  function metaContent(attr, val) {
    var m = metaEl(attr, val);
    return m ? m.getAttribute("content") : null;
  }
  function setMeta(attr, val, content) {
    if (content == null) return;
    var m = metaEl(attr, val);
    if (m) m.setAttribute("content", content);
  }

  function resolveLang() {
    var q = "";
    try { q = (new URLSearchParams(location.search).get("lang") || "").toLowerCase(); } catch (e) {}
    if (SUPPORTED.indexOf(q) !== -1) { store(q); return q; }
    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (saved && SUPPORTED.indexOf(saved) !== -1) return saved;
    var nav = (navigator.language || navigator.userLanguage || "").slice(0, 2).toLowerCase();
    if (nav === "es") return "es";
    if (nav === "en") return "en";
    return DEFAULT;
  }

  function currentPageKey() {
    var p = location.pathname || "/";
    if (p.charAt(p.length - 1) === "/") p += "index.html";
    var last = p.split("/").pop();
    if (last.indexOf(".") === -1) p += ".html"; // clean URL -> add extension
    if (p.charAt(0) !== "/") p = "/" + p;
    return p;
  }

  function parseAttrSpec(spec) {
    var out = [];
    (spec || "").split(";").forEach(function (chunk) {
      chunk = chunk.trim();
      if (!chunk) return;
      var idx = chunk.indexOf(":");
      if (idx === -1) return;
      out.push({ attr: chunk.slice(0, idx).trim(), key: chunk.slice(idx + 1).trim() });
    });
    return out;
  }

  function lookup(dict, key) {
    if (!dict) return undefined;
    var pm = (dict.pages || {})[currentPageKey()];
    if (pm && pm[key] != null) return pm[key];
    if (dict.common && dict.common[key] != null) return dict.common[key];
    return undefined;
  }
  function pageMeta(dict) {
    var pm = (dict && dict.pages || {})[currentPageKey()];
    return (pm && pm._meta) || {};
  }

  function capture() {
    qsa("[data-i18n]").forEach(function (el) { el.__frText = el.textContent; });
    qsa("[data-i18n-html]").forEach(function (el) { el.__frHtml = el.innerHTML; });
    qsa("[data-i18n-attr]").forEach(function (el) {
      el.__frAttrs = {};
      parseAttrSpec(el.getAttribute("data-i18n-attr")).forEach(function (p) {
        el.__frAttrs[p.attr] = el.getAttribute(p.attr);
      });
    });
    headFr = {
      title: document.title,
      description: metaContent("name", "description"),
      ogTitle: metaContent("property", "og:title"),
      ogDescription: metaContent("property", "og:description"),
      twTitle: metaContent("name", "twitter:title"),
      twDescription: metaContent("name", "twitter:description"),
      ogLocale: metaContent("property", "og:locale")
    };
    captured = true;
  }

  function applyHead(lang, dict) {
    if (lang === "fr" || !dict) {
      document.title = headFr.title;
      setMeta("name", "description", headFr.description);
      setMeta("property", "og:title", headFr.ogTitle);
      setMeta("property", "og:description", headFr.ogDescription);
      setMeta("name", "twitter:title", headFr.twTitle);
      setMeta("name", "twitter:description", headFr.twDescription);
      setMeta("property", "og:locale", headFr.ogLocale);
      return;
    }
    var m = pageMeta(dict);
    var title = m.title || headFr.title;
    var desc = m.description || headFr.description;
    document.title = title;
    setMeta("name", "description", desc);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", desc);
    setMeta("name", "twitter:title", title);
    setMeta("name", "twitter:description", desc);
    setMeta("property", "og:locale", OG_LOCALE[lang]);
  }

  function applyEl(el, lang, dict) {
    var changed = false; // visible text/html actually changed (attrs don't count)
    if (el.hasAttribute("data-i18n")) {
      if (el.__frText == null) el.__frText = el.textContent;
      var t = lang === "fr" ? el.__frText : lookup(dict, el.getAttribute("data-i18n"));
      if (t == null) t = el.__frText;
      if (t != null && t !== el.textContent) { el.textContent = t; changed = true; }
    }
    if (el.hasAttribute("data-i18n-html")) {
      if (el.__frHtml == null) el.__frHtml = el.innerHTML;
      var h = lang === "fr" ? el.__frHtml : lookup(dict, el.getAttribute("data-i18n-html"));
      if (h == null) h = el.__frHtml;
      if (h != null && h !== el.innerHTML) { el.innerHTML = h; changed = true; }
    }
    if (el.hasAttribute("data-i18n-attr")) {
      if (el.__frAttrs == null) {
        el.__frAttrs = {};
        parseAttrSpec(el.getAttribute("data-i18n-attr")).forEach(function (p) {
          el.__frAttrs[p.attr] = el.getAttribute(p.attr);
        });
      }
      parseAttrSpec(el.getAttribute("data-i18n-attr")).forEach(function (p) {
        var v = lang === "fr" ? el.__frAttrs[p.attr] : lookup(dict, p.key);
        if (v == null) v = el.__frAttrs[p.attr];
        if (v != null) el.setAttribute(p.attr, v);
      });
    }
    return changed;
  }

  function apply(lang, dict, animate) {
    current.lang = lang;
    current.dict = dict;
    var changedEls = [];
    qsa("[data-i18n], [data-i18n-html], [data-i18n-attr]").forEach(function (el) {
      var changed = applyEl(el, lang, dict);
      // Only animate nodes whose visible text/html changed (skip attr-only and
      // unchanged proper nouns). The brand has no data-i18n text → never here.
      if (changed && (el.hasAttribute("data-i18n") || el.hasAttribute("data-i18n-html"))) {
        changedEls.push(el);
      }
    });
    applyHead(lang, dict);
    document.documentElement.lang = HTML_LANG[lang] || HTML_LANG.fr;
    document.documentElement.setAttribute("data-lang", lang);
    updateSwitcher(lang);
    if (animate) choreograph(changedEls);
  }

  /* Cinematic re-compose on user-initiated language change: each changed text
     node replays a micro ".enter" (blur + fade + rise) in a capped top→down
     wave. Reuses the site's motion grammar; never touches the brand; WAAPI
     without fill so nothing sticks. Honors prefers-reduced-motion. */
  function choreograph(els) {
    if (!els || !els.length) return;
    if (REDUCE_MQ && REDUCE_MQ.matches) return;
    // Tempo Newson-pur : un souffle unifié, contemplatif et aérien.
    // Durée allongée (840ms ≈ .enter +20%), aucun stagger (tous les nœuds
    // respirent ensemble), blur et rise légèrement plus présents. Reste dans
    // la grammaire .enter (ease-out, blur+rise+opacity).
    var EASE = "cubic-bezier(0.22, 1, 0.36, 1)"; // = --ease-out
    var DUR = 840;        // contemplatif (~.enter + 20%)
    var STEP = 0;         // souffle unifié, pas de cascade
    var CAP = 0;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.animate) continue;
      // .page-title shares `transform` with the scroll-driven title-condense
      // animation → animate it opacity+blur only (no translateY) to avoid conflict.
      var noShift = el.matches && el.matches(".page-title");
      var frames = noShift
        ? [{ opacity: 0, filter: "blur(10px)" }, { opacity: 1, filter: "blur(0)" }]
        : [{ opacity: 0, filter: "blur(10px)", transform: "translateY(12px)" },
           { opacity: 1, filter: "blur(0)", transform: "translateY(0)" }];
      el.animate(frames, { duration: DUR, easing: EASE, delay: Math.min(i * STEP, CAP) });
    }
  }

  function translateEl(el) {
    if (el) applyEl(el, current.lang, current.dict);
  }

  // Apply current language to every i18n-tagged node within a freshly injected
  // subtree (used by main.js for the lock modal and the lock invite panel).
  function translateTree(root) {
    if (!root || !root.querySelectorAll) return;
    var nodes = root.querySelectorAll("[data-i18n], [data-i18n-html], [data-i18n-attr]");
    for (var i = 0; i < nodes.length; i++) applyEl(nodes[i], current.lang, current.dict);
  }

  function loadDict(lang) {
    if (lang === "fr") return Promise.resolve(null);
    if (dicts[lang]) return Promise.resolve(dicts[lang]);
    return fetch(I18N_BASE + lang + ".json", { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("i18n " + lang + " " + r.status);
        return r.json();
      })
      .then(function (d) { dicts[lang] = d; return d; });
  }

  function setLang(lang) {
    if (SUPPORTED.indexOf(lang) === -1) lang = DEFAULT;
    var animate = lang !== current.lang; // animate only on a real change
    store(lang);
    if (lang === "fr") { apply("fr", null, animate); return; }
    loadDict(lang)
      .then(function (d) { apply(lang, d, animate); })
      .catch(function () { apply("fr", null, animate); });
  }

  function makeSwitcher(extraClass) {
    var wrap = document.createElement("div");
    wrap.className = "lang-switch" + (extraClass ? " " + extraClass : "");
    wrap.setAttribute("role", "group");
    SWITCH_ORDER.forEach(function (code, i) {
      if (i) {
        var sep = document.createElement("span");
        sep.className = "lang-switch__sep";
        sep.setAttribute("aria-hidden", "true");
        sep.textContent = "·";
        wrap.appendChild(sep);
      }
      var b = document.createElement("button");
      b.type = "button";
      b.className = "lang-switch__btn";
      b.setAttribute("data-lang", code);
      b.textContent = code.toUpperCase();
      b.addEventListener("click", function () { setLang(code); });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function buildSwitcher(lang) {
    // Main pages (site-nav): place the switcher in the header band, right-aligned
    // to the content column (CSS position:absolute, scrolls with the page).
    // Appended to <body> so it escapes the transformed .enter container (a
    // transformed ancestor would otherwise become its containing block).
    if (document.querySelector("nav.site-nav") && !document.querySelector(".lang-switch--pinned")) {
      document.body.appendChild(makeSwitcher("lang-switch--pinned"));
    }
    // Case studies: centered in the sticky case-bar.
    qsa(".case-bar").forEach(function (bar) {
      if (!bar.querySelector(".lang-switch")) bar.appendChild(makeSwitcher("lang-switch--bar"));
    });
    updateSwitcher(lang);
  }

  function updateSwitcher(lang) {
    var label = SWITCH_LABEL[lang] || SWITCH_LABEL.fr;
    qsa(".lang-switch").forEach(function (wrap) {
      wrap.setAttribute("aria-label", label);
      qsa(".lang-switch__btn").forEach(function (b) {
        var active = b.getAttribute("data-lang") === lang;
        b.setAttribute("aria-pressed", active ? "true" : "false");
        b.classList.toggle("is-active", active);
      });
    });
  }

  function init() {
    capture();
    var lang = resolveLang();
    buildSwitcher(lang);
    if (lang === "fr") apply("fr", null, false);
    else loadDict(lang).then(function (d) { apply(lang, d, false); }).catch(function () { apply("fr", null, false); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.JVMi18n = { setLang: setLang, resolve: resolveLang, translateEl: translateEl, translateTree: translateTree };
})();
