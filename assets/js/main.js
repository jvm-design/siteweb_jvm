const navLinks = document.querySelectorAll(".site-nav a");
const current = location.pathname.split("/").pop() || "index.html";
navLinks.forEach((a) => {
  const href = a.getAttribute("href").split("/").pop();
  if (href === current) a.setAttribute("aria-current", "page");
});

/* Preview convention — drop files in assets/previews/<slug>/<role>.<ext>
   and they are auto-discovered. Roles : tile (work.html + craft list),
   home (index.html hover, falls back to tile), stage-NN / thumb-NN
   (case studies). Supported extensions tried in order. */
const PREVIEW_EXTS = ["mp4", "webm", "gif", "svg", "png", "jpg", "jpeg", "webp", "json"];
const PREVIEW_VIDEO_EXTS = new Set(["mp4", "webm", "mov", "ogg", "ogv"]);
const PREVIEW_LOTTIE_EXTS = new Set(["json"]);

const PREVIEWS_BASE = (() => {
  const s = document.currentScript || document.querySelector('script[src*="main.js"]');
  if (s) return new URL("../previews/", s.src).href;
  return "/assets/previews/";
})();

const resolvePreviewUrl = async (slug, role) => {
  if (!slug || !role) return null;
  const cacheKey = `pv:${slug}/${role}`;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached === "NONE") return null;
    if (cached) return cached;
  } catch (_) {}
  for (const ext of PREVIEW_EXTS) {
    const url = `${PREVIEWS_BASE}${slug}/${role}.${ext}`;
    try {
      const r = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (r.ok) {
        try { sessionStorage.setItem(cacheKey, url); } catch (_) {}
        return url;
      }
    } catch (_) {}
  }
  try { sessionStorage.setItem(cacheKey, "NONE"); } catch (_) {}
  return null;
};

const previewExt = (url) =>
  (url.split("?")[0].split("#")[0].split(".").pop() || "").toLowerCase();

/* Animated raster images (gif / animated webp) — extract the last frame via
   ImageDecoder so we can show it as a still idle state. Returns a data URL,
   or null if the image is single-frame / decoder unsupported / fetch failed. */
const _lastFrameCache = new Map();
const extractLastFrameDataUrl = async (url) => {
  if (_lastFrameCache.has(url)) return _lastFrameCache.get(url);
  if (typeof ImageDecoder === "undefined") return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mime = res.headers.get("content-type")
      || (previewExt(url) === "gif" ? "image/gif" : "image/webp");
    const decoder = new ImageDecoder({ data: res.body, type: mime });
    await decoder.completed;
    const track = decoder.tracks.selectedTrack;
    if (!track || track.frameCount < 2) {
      _lastFrameCache.set(url, null);
      return null;
    }
    const result = await decoder.decode({ frameIndex: track.frameCount - 1 });
    const canvas = document.createElement("canvas");
    canvas.width = result.image.displayWidth;
    canvas.height = result.image.displayHeight;
    canvas.getContext("2d").drawImage(result.image, 0, 0);
    result.image.close();
    const dataUrl = canvas.toDataURL("image/png");
    _lastFrameCache.set(url, dataUrl);
    return dataUrl;
  } catch (_) {
    _lastFrameCache.set(url, null);
    return null;
  }
};

let _lottieLibPromise = null;
const loadLottieLib = () => {
  if (window.lottie) return Promise.resolve(window.lottie);
  if (_lottieLibPromise) return _lottieLibPromise;
  _lottieLibPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie_light.min.js";
    s.onload = () => resolve(window.lottie);
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return _lottieLibPromise;
};
const _lottieDataCache = new Map();
const fetchLottieData = async (url) => {
  if (_lottieDataCache.has(url)) return _lottieDataCache.get(url);
  const data = await (await fetch(url)).json();
  _lottieDataCache.set(url, data);
  return data;
};
const makeLottieEl = (url, className) => {
  const div = document.createElement("div");
  div.setAttribute("aria-hidden", "true");
  if (className) div.className = className;
  div.classList.add("preview-lottie-host");
  Promise.all([loadLottieLib(), fetchLottieData(url)]).then(([lottie, data]) => {
    if (!div.isConnected) return;
    div._lottieAnim = lottie.loadAnimation({
      container: div,
      renderer: "svg",
      loop: true,
      autoplay: true,
      animationData: data,
      rendererSettings: { preserveAspectRatio: "xMidYMid slice" },
    });
  }).catch(() => {});
  return div;
};

/* Pause animated media while it's outside the viewport. Saves decode work
   when many thumbs render at once, and matches the "trigger on view" expectation
   on touch devices where there is no hover affordance. */
const _visibilityObserver = (() => {
  if (typeof IntersectionObserver === "undefined") return null;
  return new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const el = entry.target;
        const visible = entry.isIntersecting;
        if (el.tagName === "VIDEO") {
          if (visible) {
            el.play().catch(() => {});
          } else {
            try { el.pause(); } catch (_) {}
          }
        } else if (el._lottieAnim) {
          try {
            if (visible) el._lottieAnim.play();
            else el._lottieAnim.pause();
          } catch (_) {}
        }
      });
    },
    { rootMargin: "0px", threshold: 0.1 }
  );
})();

const gateMediaToVisibility = (el) => {
  if (!_visibilityObserver || !el) return;
  if (el.tagName === "VIDEO") {
    el.removeAttribute("autoplay");
  } else if (!el.classList.contains("preview-lottie-host")) {
    return;
  }
  // Synchronous initial state — IntersectionObserver's first callback is
  // async, and on some embedded webviews it never fires for elements that
  // are already laid out. Seeding playback here means we never get stuck
  // on a paused video that should be running.
  const r = el.getBoundingClientRect();
  const visible = r.bottom > 0 && r.top < (window.innerHeight || 0);
  if (el.tagName === "VIDEO") {
    if (visible) el.play().catch(() => {});
    else { try { el.pause(); } catch (_) {} }
  }
  _visibilityObserver.observe(el);
};

const makePreviewMedia = (url, className) => {
  const ext = previewExt(url);
  if (PREVIEW_LOTTIE_EXTS.has(ext)) return makeLottieEl(url, className);
  if (PREVIEW_VIDEO_EXTS.has(ext)) {
    const v = document.createElement("video");
    v.muted = true;
    v.setAttribute("muted", "");
    v.setAttribute("autoplay", "");
    v.setAttribute("loop", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("preload", "metadata");
    v.setAttribute("aria-hidden", "true");
    if (className) v.className = className;
    v.src = url;
    queueMicrotask(() => { v.play().catch(() => {}); });
    return v;
  }
  const img = document.createElement("img");
  img.src = url; img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  if (className) img.className = className;
  return img;
};

const applyPreviewConvention = async () => {
  const tasks = [];

  // 1) Craft list tiles (work.html). Static formats render persistently.
  //    Animated formats (video / Lottie) render their last frame as idle
  //    state and only play on hover (desktop). On touch / reduced-motion the
  //    last frame stays visible without playback.
  document.querySelectorAll(".list.craft .list-item[id]").forEach((li) => {
    const a = li.querySelector("a");
    const thumb = li.querySelector(".thumb");
    if (!a || !thumb) return;
    if (thumb.querySelector("video, img, .preview-lottie-host")) return;
    tasks.push((async () => {
      const url = await resolvePreviewUrl(li.id, "tile");
      if (!url) return;
      const ext = previewExt(url);
      const isVideo = PREVIEW_VIDEO_EXTS.has(ext);
      const isLottie = PREVIEW_LOTTIE_EXTS.has(ext);
      const isMaybeAnimImg = ext === "gif" || ext === "webp";
      const hoverPlayable = canHover && !reducedMotion;
      if (!isVideo && !isLottie && !isMaybeAnimImg) {
        const media = makePreviewMedia(url, "thumb-media");
        if (!media) return;
        thumb.textContent = "";
        thumb.appendChild(media);
        return;
      }
      if (isMaybeAnimImg) {
        const lastFrame = await extractLastFrameDataUrl(url);
        if (!lastFrame) {
          // Single-frame / decoder unsupported : keep static behavior.
          const media = makePreviewMedia(url, "thumb-media");
          if (!media) return;
          thumb.textContent = "";
          thumb.appendChild(media);
          return;
        }
        const still = document.createElement("img");
        still.className = "thumb-media";
        still.alt = "";
        still.decoding = "async";
        still.src = lastFrame;
        thumb.textContent = "";
        thumb.appendChild(still);
        if (hoverPlayable) {
          let live = null;
          a.addEventListener("pointerenter", () => {
            if (live) return;
            live = document.createElement("img");
            live.className = "thumb-media";
            live.alt = "";
            live.decoding = "async";
            live.src = url;
            thumb.appendChild(live);
          });
          a.addEventListener("pointerleave", () => {
            if (!live) return;
            live.remove();
            live = null;
          });
        }
        return;
      }
      if (isVideo) {
        const v = document.createElement("video");
        v.className = "thumb-media";
        v.muted = true;
        v.setAttribute("muted", "");
        v.setAttribute("playsinline", "");
        v.setAttribute("preload", "metadata");
        v.setAttribute("aria-hidden", "true");
        v.loop = false;
        v.src = url;
        const seekToEnd = () => {
          if (!isFinite(v.duration)) return;
          try { v.currentTime = Math.max(0, v.duration - 0.05); } catch (_) {}
        };
        v.addEventListener("loadedmetadata", seekToEnd, { once: true });
        thumb.textContent = "";
        thumb.appendChild(v);
        if (hoverPlayable) {
          a.addEventListener("pointerenter", () => {
            v.loop = true;
            try { v.currentTime = 0; } catch (_) {}
            v.play().catch(() => {});
          });
          a.addEventListener("pointerleave", () => {
            try { v.pause(); } catch (_) {}
            v.loop = false;
            seekToEnd();
          });
        }
        return;
      }
      // Lottie
      const div = document.createElement("div");
      div.className = "thumb-media preview-lottie-host";
      div.setAttribute("aria-hidden", "true");
      thumb.textContent = "";
      thumb.appendChild(div);
      const fitMode = li.hasAttribute("data-fit") && li.getAttribute("data-fit") !== "false";
      const idleFrameAttr = li.getAttribute("data-idle-frame");
      const idleFrameOverride = idleFrameAttr !== null ? Number(idleFrameAttr) : null;
      Promise.all([loadLottieLib(), fetchLottieData(url)]).then(([lottie, data]) => {
        if (!div.isConnected) return;
        const anim = lottie.loadAnimation({
          container: div,
          renderer: "svg",
          loop: false,
          autoplay: false,
          animationData: data,
          rendererSettings: { preserveAspectRatio: fitMode ? "xMidYMid meet" : "xMidYMid slice" },
        });
        div._lottieAnim = anim;
        try { anim.goToAndStop(0, true); } catch (_) {}
        const goToIdle = () => {
          try { anim.pause(); } catch (_) {}
          const last = Math.max(0, (anim.totalFrames || 1) - 1);
          const target = (idleFrameOverride !== null && Number.isFinite(idleFrameOverride))
            ? Math.min(Math.max(0, idleFrameOverride), last)
            : last;
          try { anim.goToAndStop(target, true); } catch (_) {}
        };
        anim.addEventListener("data_ready", goToIdle);
        anim.addEventListener("DOMLoaded", goToIdle);
        if (hoverPlayable) {
          a.addEventListener("pointerenter", () => {
            try { anim.loop = true; } catch (_) {}
            try { anim.goToAndPlay(0, true); } catch (_) {}
          });
          a.addEventListener("pointerleave", () => {
            try { anim.loop = false; } catch (_) {}
            goToIdle();
          });
        }
      }).catch(() => {});
    })());
  });

  // 2) Case-study thumbs — stage media + (optional) static thumb frame.
  //    Animated media only plays while the thumb is in view, so we don't
  //    burn battery decoding a dozen offscreen videos in parallel.
  const csSlug = document.body.dataset.slug;
  if (csSlug) {
    document.querySelectorAll(".case-thumbs > li").forEach((li, i) => {
      const n = String(i + 1).padStart(2, "0");
      const frame = li.querySelector(".thumb-frame");
      tasks.push((async () => {
        let stageUrl = li.dataset.stageSrc;
        if (!stageUrl) {
          const resolved = await resolvePreviewUrl(csSlug, `stage-${n}`);
          if (resolved) {
            li.dataset.stageSrc = resolved;
            stageUrl = resolved;
          }
        }
        if (frame && !frame.querySelector("video, img")) {
          let thumbUrl = await resolvePreviewUrl(csSlug, `thumb-${n}`);
          if (!thumbUrl) thumbUrl = stageUrl || null;
          if (thumbUrl) {
            const media = makePreviewMedia(thumbUrl, "");
            if (media) {
              frame.style.background = "#000";
              frame.appendChild(media);
              gateMediaToVisibility(media);
            }
          }
        }
      })());
    });
  }

  // 3) Home hover previews (index.html) — honor explicit data-preview-src.
  document.querySelectorAll("[data-preview][data-slug]").forEach((el) => {
    if (el.dataset.previewSrc) return;
    tasks.push((async () => {
      let url = await resolvePreviewUrl(el.dataset.slug, "home");
      if (!url) url = await resolvePreviewUrl(el.dataset.slug, "tile");
      if (url) el.dataset.previewSrc = url;
    })());
  });

  await Promise.all(tasks);
};

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
  if (reducedMotion) return;
  // Skip when only craft-list items remain (those use inline thumbs + overlay).
  const targets = [...document.querySelectorAll("[data-preview]")].filter(
    (el) => !el.closest(".list.craft")
  );
  if (!targets.length) return;
  if (canHover) _buildPreview();
  else _buildScrollPreview(targets);
};

/* Mobile / touch fallback for the home hover preview. No cursor, so the
   item closest to the viewport center drives a fixed mini preview card.
   Stays consistent with the desktop affordance — same media, same label —
   but reads as a passive companion to scrolling, not an interaction. */
const _buildScrollPreview = (targets) => {
  const preview = document.createElement("div");
  preview.className = "preview scroll";
  preview.innerHTML = `
    <div class="preview-inner">
      <video class="preview-media preview-video" muted loop playsinline preload="metadata" aria-hidden="true"></video>
      <img class="preview-media preview-img" alt="" />
      <div class="preview-media preview-lottie" aria-hidden="true"></div>
      <span class="preview-label"></span>
    </div>
  `;
  document.body.appendChild(preview);
  const labelEl = preview.querySelector(".preview-label");
  const videoEl = preview.querySelector(".preview-video");
  const imgEl = preview.querySelector(".preview-img");
  const lottieEl = preview.querySelector(".preview-lottie");

  const VIDEO_RE = /\.(mp4|webm|mov|ogg|ogv)(\?|#|$)/i;
  const LOTTIE_RE = /\.(json|lottie)(\?|#|$)/i;
  let lottieAnim = null;
  let active = null;
  let activeSrc = null;

  const clearMedia = () => {
    videoEl.classList.remove("active");
    imgEl.classList.remove("active");
    lottieEl.classList.remove("active");
    try { videoEl.pause(); } catch (_) {}
    videoEl.removeAttribute("src"); videoEl.load();
    imgEl.removeAttribute("src");
    if (lottieAnim) { try { lottieAnim.destroy(); } catch (_) {} lottieAnim = null; }
    lottieEl.innerHTML = "";
  };

  const swap = (el) => {
    if (el === active) return;
    active = el;
    if (!el) {
      preview.classList.remove("show");
      activeSrc = null;
      // Defer media reset so the fade-out reads as a single beat.
      setTimeout(() => { if (!active) clearMedia(); }, 280);
      return;
    }
    preview.classList.add("show");
    preview.style.background = el.dataset.previewBg || "#111";
    labelEl.textContent = el.dataset.previewLabel || "";
    const src = el.dataset.previewSrc;
    if (src === activeSrc) return;
    activeSrc = src;
    clearMedia();
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
        let data;
        try { data = await fetchLottieData(src); } catch (_) { return; }
        if (active !== el) return;
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
  };

  let rafId = null;
  const pick = () => {
    rafId = null;
    const center = window.innerHeight / 2;
    let best = null, bestDist = Infinity;
    for (const el of targets) {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      const c = r.top + r.height / 2;
      const d = Math.abs(c - center);
      if (d < bestDist) { bestDist = d; best = el; }
    }
    // Generous tolerance — if any candidate is within ~half a viewport, show it.
    if (best && bestDist < window.innerHeight * 0.5) swap(best);
    else swap(null);
  };

  const onScroll = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(pick);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  pick();
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
  const LOTTIE_RE = /\.(json|lottie)(\?|#|$)/i;
  let lottieEl = null;
  let lottieAnim = null;

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

    // Mobile : stage is `display: none`, so loading + decoding stage media is pure waste
    // (battery, bandwidth). The thumbs themselves are the gallery in that layout.
    if (getComputedStyle(stage).display === "none") {
      try { videoEl.pause(); } catch (_) {}
      videoEl.removeAttribute("src"); videoEl.load();
      return;
    }

    const li = thumbs[idx];
    const src = li?.dataset.stageSrc || "";

    // Always reset all layers so we don't pile up.
    imgEl.classList.remove("active");
    videoEl.classList.remove("active");
    try { videoEl.pause(); } catch (_) {}
    if (lottieEl) {
      lottieEl.classList.remove("active");
      if (lottieAnim) { try { lottieAnim.stop(); } catch (_) {} }
    }

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
    } else if (LOTTIE_RE.test(src)) {
      if (!lottieEl) {
        lottieEl = document.createElement("div");
        lottieEl.className = "stage-media stage-lottie";
        lottieEl.setAttribute("aria-hidden", "true");
        stage.appendChild(lottieEl);
      }
      Promise.all([loadLottieLib(), fetchLottieData(src)]).then(([lottie, data]) => {
        if (activeIdx !== idx) return;
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

  // Mobile / tablet : the panel is `position: fixed` and covers the toggle,
  // so the user has no way back. Inject a sticky close affordance at the top
  // of the scroll. Hidden on desktop where the in-place toggle is reachable.
  const inner = scroller.querySelector(".case-detail__inner");
  if (inner && !scroller.querySelector("[data-detail-close]")) {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "case-detail__close";
    close.setAttribute("data-detail-close", "");
    close.textContent = "← Revenir à la galerie";
    scroller.insertBefore(close, inner);
    close.addEventListener("click", () => setOpen(false));
  }
};

initExperienceFilter();
initOverlay();
initCaseBack();
initCaseDetail();
applyPreviewConvention().then(() => {
  initCraftThumbs();
  initCaseStudy();
});
