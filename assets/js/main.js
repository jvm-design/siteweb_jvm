const navLinks = document.querySelectorAll(".site-nav a");
const current = location.pathname.split("/").pop() || "index.html";
navLinks.forEach((a) => {
  const href = a.getAttribute("href").split("/").pop();
  if (href === current) a.setAttribute("aria-current", "page");
});

const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

/* Liquid-glass hover — a single element tracks the hovered list item. */
document.querySelectorAll(".list").forEach((list) => {
  const glass = document.createElement("span");
  glass.className = "glass";
  glass.setAttribute("aria-hidden", "true");
  list.prepend(glass);

  const move = (target) => {
    const r = target.getBoundingClientRect();
    const p = list.getBoundingClientRect();
    glass.style.width = r.width + "px";
    glass.style.height = r.height + "px";
    glass.style.transform = `translate3d(${r.left - p.left}px, ${r.top - p.top}px, 0)`;
  };

  let focused = null;
  list.querySelectorAll(".list-item > a").forEach((a) => {
    a.addEventListener("pointerenter", () => {
      focused = a;
      move(a);
      list.classList.add("has-focus");
      list.querySelectorAll(".list-item.is-focused").forEach((el) => el.classList.remove("is-focused"));
      a.closest(".list-item")?.classList.add("is-focused");
    });
  });
  list.addEventListener("pointerleave", () => {
    focused = null;
    glass.style.width = "0px";
    glass.style.height = "0px";
    list.classList.remove("has-focus");
    list.querySelectorAll(".list-item.is-focused").forEach((el) => el.classList.remove("is-focused"));
  });
  window.addEventListener("resize", () => { if (focused) move(focused); });
});

/* Cursor-follow preview — shows a gradient card with the project label. */
const canHover = matchMedia("(hover: hover)").matches;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const initPreview = () => {
  if (!canHover || reducedMotion) return;
  // Skip when only craft-list items remain (those use inline thumbs + overlay).
  const targets = [...document.querySelectorAll("[data-preview]")].filter(
    (el) => !el.closest(".list.craft")
  );
  if (!targets.length) return;
  _buildPreview();
};

const _buildPreview = () => {
  const previewZone = document.querySelector(".preview-zone");
  const wide = matchMedia("(min-width: 1080px)").matches;
  const anchored = wide && !!previewZone;

  const preview = document.createElement("div");
  preview.className = anchored ? "preview anchored" : "preview cursor";
  preview.innerHTML = `
    <div class="preview-inner">
      <video class="preview-media preview-video" muted loop playsinline preload="metadata" aria-hidden="true"></video>
      <img class="preview-media preview-img" alt="" />
      <div class="preview-media preview-lottie" aria-hidden="true"></div>
      <span class="preview-label"></span>
    </div>
  `;
  (anchored ? previewZone : document.body).appendChild(preview);
  const labelEl = preview.querySelector(".preview-label");
  const videoEl = preview.querySelector(".preview-video");
  const imgEl = preview.querySelector(".preview-img");
  const lottieEl = preview.querySelector(".preview-lottie");

  const OFFSET_X = 28, OFFSET_Y = -90;
  const STIFFNESS = 120, DAMPING = 14, MASS = 1;
  const VIDEO_RE = /\.(mp4|webm|mov|ogg|ogv)(\?|#|$)/i;
  const LOTTIE_RE = /\.(json|lottie)(\?|#|$)/i;

  let lottiePromise = null;
  const loadLottieLib = () => {
    if (window.lottie) return Promise.resolve(window.lottie);
    if (lottiePromise) return lottiePromise;
    lottiePromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie_light.min.js";
      s.onload = () => resolve(window.lottie);
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return lottiePromise;
  };
  const lottieCache = new Map();
  let lottieAnim = null;
  let tx = 0, ty = 0, targetX = 0, targetY = 0;
  let vx = 0, vy = 0, lastT = performance.now();
  let active = null;
  if (!anchored) { tx = ty = targetX = targetY = -9999; }

  const tick = (t) => {
    const dt = Math.min((t - lastT) / 1000, 1 / 30);
    lastT = t;
    const ax = (-STIFFNESS * (tx - targetX) - DAMPING * vx) / MASS;
    const ay = (-STIFFNESS * (ty - targetY) - DAMPING * vy) / MASS;
    vx += ax * dt;
    vy += ay * dt;
    tx += vx * dt;
    ty += vy * dt;
    if (anchored) {
      preview.style.transform = `translate3d(0, ${ty}px, 0) scale(${active ? 1 : 0.96})`;
    } else {
      preview.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${active ? 1 : 0.92})`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  if (!anchored) {
    document.addEventListener("pointermove", (e) => {
      targetX = e.clientX + OFFSET_X;
      targetY = e.clientY + OFFSET_Y;
    });
  }

  const clearMedia = () => {
    videoEl.classList.remove("active");
    imgEl.classList.remove("active");
    lottieEl.classList.remove("active");
    try { videoEl.pause(); } catch (_) {}
    videoEl.removeAttribute("src"); videoEl.load();
    imgEl.removeAttribute("src");
    if (lottieAnim) { try { lottieAnim.stop(); } catch (_) {} }
  };

  document.querySelectorAll("[data-preview]").forEach((el) => {
    if (el.closest(".list.craft")) return;
    el.addEventListener("pointerenter", (e) => {
      const firstEntry = !preview.classList.contains("show");
      active = el;
      preview.style.background = el.dataset.previewBg || "#111";
      labelEl.textContent = el.dataset.previewLabel || "";
      preview.classList.add("show");

      if (anchored) {
        const iRect = el.getBoundingClientRect();
        const pRect = preview.getBoundingClientRect();
        const itemCenter = iRect.top + iRect.height / 2;
        const previewCenter = pRect.top + pRect.height / 2;
        targetY = ty + (itemCenter - previewCenter);
        if (firstEntry) { ty = targetY; vy = 0; }
      } else {
        targetX = e.clientX + OFFSET_X;
        targetY = e.clientY + OFFSET_Y;
        if (firstEntry) { tx = targetX; ty = targetY; vx = 0; vy = 0; }
      }

      clearMedia();
      const src = el.dataset.previewSrc;
      if (!src) return;

      if (VIDEO_RE.test(src)) {
        videoEl.addEventListener("loadeddata", () => {
          if (active === el) videoEl.classList.add("active");
        }, { once: true });
        videoEl.src = src;
        videoEl.play().catch(() => {});
      } else if (LOTTIE_RE.test(src)) {
        loadLottieLib().then(async (lottie) => {
          if (active !== el) return;
          let data = lottieCache.get(src);
          if (!data) {
            try {
              const res = await fetch(src);
              data = await res.json();
              lottieCache.set(src, data);
            } catch (_) { return; }
          }
          if (active !== el) return;
          if (lottieAnim) { try { lottieAnim.destroy(); } catch (_) {} lottieAnim = null; }
          lottieEl.innerHTML = "";
          lottieAnim = lottie.loadAnimation({
            container: lottieEl,
            renderer: "svg",
            loop: true,
            autoplay: true,
            animationData: data,
            rendererSettings: { preserveAspectRatio: "xMidYMid slice" },
          });
          lottieEl.classList.add("active");
        }).catch(() => {});
      } else {
        imgEl.addEventListener("load", () => {
          if (active === el) imgEl.classList.add("active");
        }, { once: true });
        imgEl.src = src;
      }
    });
  });

  // List-level leave: fade preview when cursor exits the whole list (avoids flicker
  // between adjacent items and enables cross-fade on media swaps).
  document.querySelectorAll(".list").forEach((list) => {
    list.addEventListener("pointerleave", () => {
      active = null;
      preview.classList.remove("show");
      clearMedia();
    });
  });
};

if ("requestIdleCallback" in window) {
  requestIdleCallback(initPreview, { timeout: 1000 });
} else {
  setTimeout(initPreview, 0);
}

/* Craft list — autoplay video/img inline in each thumb on hover. */
const initCraftThumbs = () => {
  if (!canHover || reducedMotion) return;
  const VIDEO_RE = /\.(mp4|webm|mov|ogg|ogv)(\?|#|$)/i;
  const IMG_RE = /\.(png|jpe?g|webp|avif|gif)(\?|#|$)/i;

  document.querySelectorAll(".list.craft .list-item > a").forEach((a) => {
    const thumb = a.querySelector(".thumb");
    const src = a.dataset.previewSrc;
    if (!thumb || !src) return;
    let media = null;

    a.addEventListener("pointerenter", () => {
      if (media) return;
      if (VIDEO_RE.test(src)) {
        media = document.createElement("video");
        media.src = src;
        media.muted = true;
        media.loop = true;
        media.playsInline = true;
        media.autoplay = true;
        media.preload = "metadata";
        media.className = "thumb-media";
        thumb.appendChild(media);
        media.play().catch(() => {});
      } else if (IMG_RE.test(src)) {
        media = document.createElement("img");
        media.src = src;
        media.alt = "";
        media.className = "thumb-media";
        thumb.appendChild(media);
      }
      // Lottie skipped in thumbs — too heavy at this size.
    });

    a.addEventListener("pointerleave", () => {
      if (!media) return;
      if (media.tagName === "VIDEO") { try { media.pause(); } catch (_) {} }
      media.remove();
      media = null;
    });
  });
};

/* Project overlay — clicking a craft item opens the matching .project article in a modal. */
const initOverlay = () => {
  const overlay = document.querySelector(".overlay");
  if (!overlay) return;
  const content = overlay.querySelector(".overlay-content");
  let lastFocus = null;

  const open = (id) => {
    const article = document.querySelector(`.project[aria-labelledby="${id}-h"]`);
    if (!article) return;
    lastFocus = document.activeElement;
    content.innerHTML = "";
    content.appendChild(article.cloneNode(true));
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.setAttribute("data-open", ""));
    document.body.classList.add("no-scroll");
    overlay.querySelector(".overlay-close")?.focus();
    if (location.hash !== "#" + id) {
      history.replaceState(null, "", "#" + id);
    }
  };

  const close = () => {
    if (!overlay.hasAttribute("data-open")) return;
    overlay.removeAttribute("data-open");
    document.body.classList.remove("no-scroll");
    setTimeout(() => {
      overlay.hidden = true;
      content.innerHTML = "";
    }, 320);
    if (location.hash) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  };

  document.querySelectorAll(".list.craft .list-item > a").forEach((a) => {
    a.addEventListener("click", (e) => {
      const href = a.getAttribute("href") || "";
      if (!href.startsWith("#")) return;
      e.preventDefault();
      open(href.slice(1));
    });
  });

  overlay.querySelectorAll("[data-overlay-close]").forEach((el) => {
    el.addEventListener("click", close);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  // Deep link: open from initial hash.
  if (location.hash) {
    const id = location.hash.slice(1);
    if (document.querySelector(`.project[aria-labelledby="${id}-h"]`)) {
      open(id);
    }
  }
};

/* Experience filter — scopes the craft grid to a single experience via ?exp=<slug>. */
const initExperienceFilter = () => {
  const list = document.querySelector(".list.craft");
  if (!list) return;
  const filter = document.querySelector(".work-filter");
  const labelEl = filter?.querySelector(".work-filter-label");
  const countEl = filter?.querySelector(".work-filter-count");
  const dismissEl = filter?.querySelector(".work-filter-dismiss");
  const emptyEl = document.querySelector(".work-empty");

  const META = {
    tns: "Autoya — TNS",
    merim: "Merim Groupe",
    tdc: "The Design Crew",
    eximion: "Eximion",
    restoapp: "Restoapp",
  };

  const apply = (key) => {
    const items = list.querySelectorAll(".list-item");
    let visible = 0;
    items.forEach((li) => {
      const match = !key || li.dataset.exp === key;
      li.hidden = !match;
      if (match) visible++;
    });

    if (key && META[key]) {
      if (labelEl) labelEl.textContent = META[key];
      if (countEl) countEl.textContent = visible === 1 ? "1 projet" : `${visible} projets`;
      if (filter) filter.hidden = false;
      if (emptyEl) emptyEl.hidden = visible !== 0;
      list.hidden = visible === 0;
    } else {
      if (filter) filter.hidden = true;
      if (emptyEl) emptyEl.hidden = true;
      list.hidden = false;
    }
  };

  const currentKey = () => new URLSearchParams(location.search).get("exp");
  apply(currentKey());

  dismissEl?.addEventListener("click", (e) => {
    e.preventDefault();
    history.pushState(null, "", location.pathname);
    apply(null);
  });

  window.addEventListener("popstate", () => apply(currentKey()));
};

/* Case study — scroll-driven big-stage swap from a thumb rail. */
const initCaseStudy = () => {
  const stage = document.querySelector("[data-stage]");
  if (!stage) return;
  const thumbs = [...document.querySelectorAll(".case-thumbs > li")];
  if (!thumbs.length) return;

  const imgEl = stage.querySelector(".stage-img");
  const videoEl = stage.querySelector(".stage-video");
  const counterEl = stage.querySelector(".stage-counter");
  const total = thumbs.length;
  const VIDEO_RE = /\.(mp4|webm|mov|ogg|ogv)(\?|#|$)/i;

  const fmt = (n) => String(n).padStart(2, "0");

  let activeIdx = -1;

  const swap = (idx) => {
    if (idx === activeIdx) return;
    activeIdx = idx;

    thumbs.forEach((li, i) => {
      if (i === idx) li.setAttribute("data-active", "");
      else li.removeAttribute("data-active");
    });
    if (counterEl) counterEl.textContent = `${fmt(idx + 1)} / ${fmt(total)}`;

    const li = thumbs[idx];
    const src = li?.dataset.stageSrc || "";

    // Always reset both layers so we don't pile up.
    imgEl.classList.remove("active");
    videoEl.classList.remove("active");
    try { videoEl.pause(); } catch (_) {}

    if (!src) {
      // Placeholder thumbnail — keep stage empty (frame bg shows).
      imgEl.removeAttribute("src");
      videoEl.removeAttribute("src");
      videoEl.load();
      return;
    }

    if (VIDEO_RE.test(src)) {
      videoEl.src = src;
      videoEl.play().catch(() => {});
      videoEl.classList.add("active");
    } else {
      imgEl.addEventListener("load", () => {
        if (activeIdx === idx) imgEl.classList.add("active");
      }, { once: true });
      imgEl.src = src;
    }
  };

  // Pick the active thumb. Vertical (desktop) : closest to viewport center.
  // Horizontal (tablet rail) : closest to the start snap-point (matches scroll-snap-align: start).
  const rail = thumbs[0].parentElement;
  const computeActive = () => {
    const horizontal = getComputedStyle(rail).flexDirection === "row";
    let bestIdx = 0, bestDist = Infinity;
    if (horizontal) {
      const railRect = rail.getBoundingClientRect();
      const padLeft = parseFloat(getComputedStyle(rail).scrollPaddingInlineStart) || 0;
      const target = railRect.left + padLeft;
      thumbs.forEach((li, i) => {
        const r = li.getBoundingClientRect();
        const d = Math.abs(r.left - target);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      });
    } else {
      const center = window.innerHeight / 2;
      thumbs.forEach((li, i) => {
        const r = li.getBoundingClientRect();
        const c = r.top + r.height / 2;
        const d = Math.abs(c - center);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      });
    }
    if (bestIdx !== activeIdx) swap(bestIdx);
  };

  swap(0);
  computeActive();

  let rafId = null;
  const onScroll = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      computeActive();
    });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  rail.addEventListener("scroll", onScroll, { passive: true });
};

/* Smart back — if user came from inside the site, use history.back() to preserve filter + scroll. */
const initCaseBack = () => {
  const links = document.querySelectorAll("[data-case-back]");
  if (!links.length) return;
  links.forEach((back) => {
    back.addEventListener("click", (e) => {
      if (document.referrer && document.referrer.startsWith(location.origin)) {
        e.preventDefault();
        history.back();
      }
      // else : default href navigation handles direct landings (preserves ?exp= filter).
    });
  });
};

/* Case-study detail — single-page reveal of long-form content from the
   sidebar CTA. Cross-fade with the gallery, ESC closes, scroll resets. */
const initCaseDetail = () => {
  const toggle = document.querySelector("[data-detail-toggle]");
  const panel = document.querySelector("[data-detail-panel]");
  const grid = document.querySelector("[data-detail-grid]");
  if (!toggle || !panel || !grid) return;
  const scroller = panel.querySelector("[data-detail-scroll]") || panel;

  const setOpen = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    panel.setAttribute("aria-hidden", String(!open));
    if (open) {
      panel.dataset.open = "";
      grid.dataset.detailOpen = "";
      panel.removeAttribute("inert");
      // Reset internal scroll on each open so users land at the top.
      try { scroller.scrollTo({ top: 0, behavior: "instant" }); }
      catch (_) { scroller.scrollTop = 0; }
    } else {
      delete panel.dataset.open;
      delete grid.dataset.detailOpen;
      panel.setAttribute("inert", "");
    }
  };

  toggle.addEventListener("click", () => {
    const isOpen = toggle.getAttribute("aria-expanded") === "true";
    setOpen(!isOpen);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
      setOpen(false);
    }
  });
};

/* Media thumbs — still image by default, swap to animated GIF on hover (desktop)
   or when scrolled into the central viewport band (touch). */
const initMediaThumbs = () => {
  const thumbs = document.querySelectorAll(".list.craft .thumb-media[data-anim]");
  if (!thumbs.length || reducedMotion) return;

  const play = (img) => {
    const anim = img.dataset.anim;
    if (anim && img.src !== anim) img.src = anim;
  };
  const stop = (img) => {
    const still = img.dataset.still;
    if (still && img.src !== still) img.src = still;
  };

  if (canHover) {
    thumbs.forEach((img) => {
      const a = img.closest("a");
      if (!a) return;
      a.addEventListener("pointerenter", () => play(img));
      a.addEventListener("pointerleave", () => stop(img));
    });
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        const img = e.target.querySelector(".thumb-media[data-anim]");
        if (!img) return;
        if (e.isIntersecting) play(img);
        else stop(img);
      });
    },
    { threshold: 0, rootMargin: "-35% 0px -35% 0px" }
  );
  thumbs.forEach((img) => {
    const item = img.closest(".list-item");
    if (item) io.observe(item);
  });
};

initExperienceFilter();
initCraftThumbs();
initMediaThumbs();
initOverlay();
initCaseStudy();
initCaseBack();
initCaseDetail();
