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

/* Middle-band observer — fires when an element enters / exits the central
   third of the viewport (vertically and horizontally). On touch, this is
   the "play trigger" for tiles that would otherwise stay frozen on their
   idle frame (no hover affordance). The narrow band ensures only the item
   the user is actually looking at animates — restraint, not noise. */
const _middleBandObserver = (() => {
  if (typeof IntersectionObserver === "undefined") return null;
  return new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const cb = entry.target._onMiddleBand;
        if (cb) cb(entry.isIntersecting);
      });
    },
    { rootMargin: "-33% -25% -33% -25%", threshold: 0 }
  );
})();

const onMiddleBand = (el, callback) => {
  if (!_middleBandObserver || !el) return;
  el._onMiddleBand = callback;
  _middleBandObserver.observe(el);
};

/* Note: an earlier revision installed a global MutationObserver on
   document.body to auto-unobserve intersection observers when targets
   left the DOM. It turned out to interfere with GIF decoding on
   case-study pages — every stage swap was a body subtree mutation,
   keeping the main thread busy enough that Chrome stalled frame
   decoding. The "phantom callback" risk it guarded against is purely
   theoretical here (observed elements stay alive for the page's life),
   so we drop the watcher entirely. */

/* Same shape as gateMediaToVisibility but bound to the middle-band observer.
   The case-study thumb rail is intentionally a focal medium : only the item
   the user is actually looking at should animate. On mobile this means one
   video at a time decodes ; on tablet/desktop the play state aligns with
   the "active thumb" that drives the stage swap. */
/* Case-study thumb gate — drives play/pause off the `data-active` attribute
   that `computeActive()` puts on the matching <li>. Same intent as the
   middle-band gate (play only the focal item) but works on every layout :
   desktop vertical centre, tablet/mobile horizontal start-snap. The middle
   band assumed the rail crossed mid-viewport — false on tablet where the
   rail sits pinned at the bottom and never enters the band. */
const gateMediaToActiveAttr = (el, host) => {
  if (!el || !host) return;
  const isVideo = el.tagName === "VIDEO";
  const isLottie = el.classList.contains("preview-lottie-host");
  if (!isVideo && !isLottie) return;
  if (isVideo) el.removeAttribute("autoplay");

  const apply = (active) => {
    if (isVideo) {
      if (active) el.play().catch(() => {});
      else { try { el.pause(); } catch (_) {} }
    } else if (el._lottieAnim) {
      try {
        if (active) el._lottieAnim.play();
        else el._lottieAnim.pause();
      } catch (_) {}
    }
  };

  // makePreviewMedia queues a follow-up v.play() via microtask to defeat
  // browser autoplay heuristics. We have to apply our state AFTER that, or
  // the inactive thumbs end up playing anyway. Sync apply seeds the visible
  // state ; the microtask is the one that actually sticks.
  const seed = () => apply(host.hasAttribute("data-active"));
  seed();
  queueMicrotask(seed);

  const mo = new MutationObserver(seed);
  mo.observe(host, { attributes: true, attributeFilter: ["data-active"] });

  // Lottie attaches async — re-apply once the animation instance is ready.
  if (isLottie && !el._lottieAnim) {
    const start = Date.now();
    const tick = () => {
      if (el._lottieAnim) apply(host.hasAttribute("data-active"));
      else if (Date.now() - start < 5000) setTimeout(tick, 100);
    };
    setTimeout(tick, 100);
  }
};

const gateMediaToMiddleBand = (el) => {
  if (!_middleBandObserver || !el) return;
  const isVideo = el.tagName === "VIDEO";
  const isLottie = el.classList.contains("preview-lottie-host");
  if (!isVideo && !isLottie) return;
  if (isVideo) el.removeAttribute("autoplay");

  let lastInBand = false;
  const apply = (inBand) => {
    lastInBand = inBand;
    if (isVideo) {
      if (inBand) el.play().catch(() => {});
      else { try { el.pause(); } catch (_) {} }
    } else if (el._lottieAnim) {
      try {
        if (inBand) el._lottieAnim.play();
        else el._lottieAnim.pause();
      } catch (_) {}
    }
  };

  // Seed initial state synchronously — the observer's first callback is
  // async and unreliable on some embedded webviews for already-laid-out els.
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || 1;
  const vw = window.innerWidth || 1;
  const inBand =
    r.top < vh * 0.67 && r.bottom > vh * 0.33 &&
    r.left < vw * 0.75 && r.right > vw * 0.25;
  apply(inBand);

  // Lottie loads async — re-apply once the animation instance attaches.
  if (isLottie && !el._lottieAnim) {
    const start = Date.now();
    const tick = () => {
      if (el._lottieAnim) apply(lastInBand);
      else if (Date.now() - start < 5000) setTimeout(tick, 100);
    };
    setTimeout(tick, 100);
  }

  onMiddleBand(el, apply);
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

/* Idle motion on still photos — Ive/Newson grammar.
   • Ken Burns : CSS @keyframes drives --kb-t (0..1..0 over 16s) which
     interpolates a micro drift + scale in the transform. Random phase per
     element so a row of tiles never beats in unison.
   • Parallax : pointer position on the host updates --px-x / --px-y,
     composed into the same transform so the two effects add. One rAF
     loop per host, lerped, sleeps when settled. Mouse/pen only — touch
     would just stick the photo to the finger. */
const enableKenBurns = (img) => {
  if (!img || reducedMotion) return;
  if (img.classList.contains("kb")) return;
  img.style.animationDelay = `${-Math.random() * 16}s`;
  img.classList.add("kb");
};

const enableHoverParallax = (img, host, opts = {}) => {
  if (!img || !host || !canHover || reducedMotion) return;
  if (host._kbParallax) {
    host._kbParallax.img = img;
    return;
  }
  const state = {
    img,
    ampX: opts.ampX ?? 6,
    ampY: opts.ampY ?? 5,
    lerp: 0.12,
    tx: 0, ty: 0, cx: 0, cy: 0, rafId: null,
    rect: null,
  };
  host._kbParallax = state;
  const write = () => {
    const t = state.img;
    if (!t) return;
    t.style.setProperty("--px-x", state.cx.toFixed(2) + "px");
    t.style.setProperty("--px-y", state.cy.toFixed(2) + "px");
  };
  const tick = () => {
    state.cx += (state.tx - state.cx) * state.lerp;
    state.cy += (state.ty - state.cy) * state.lerp;
    write();
    if (Math.abs(state.tx - state.cx) < 0.04 && Math.abs(state.ty - state.cy) < 0.04) {
      state.cx = state.tx; state.cy = state.ty;
      write();
      state.rafId = null;
      return;
    }
    state.rafId = requestAnimationFrame(tick);
  };
  const wake = () => { if (!state.rafId) state.rafId = requestAnimationFrame(tick); };

  // Cache host rect — reading getBoundingClientRect on every pointermove forces
  // a layout flush each frame. ResizeObserver + scroll fallback refresh it only
  // when the actual geometry changes.
  const refreshRect = () => { state.rect = host.getBoundingClientRect(); };
  refreshRect();
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(refreshRect);
    ro.observe(host);
  }
  // pointerenter is the right moment to re-read — host may have moved since last frame.
  host.addEventListener("pointerenter", refreshRect, { passive: true });

  host.addEventListener("pointermove", (e) => {
    if (e.pointerType && e.pointerType !== "mouse" && e.pointerType !== "pen") return;
    const r = state.rect;
    if (!r || !r.width || !r.height) return;
    const nx = (e.clientX - r.left) / r.width - 0.5;
    const ny = (e.clientY - r.top) / r.height - 0.5;
    // Inverted : photo leans away from the cursor (window-pane parallax).
    state.tx = -nx * state.ampX;
    state.ty = -ny * state.ampY;
    wake();
  }, { passive: true });
  host.addEventListener("pointerleave", () => {
    state.tx = 0; state.ty = 0;
    wake();
  });
};

const enhanceStill = (img, host, opts) => {
  enableKenBurns(img);
  if (host) enableHoverParallax(img, host, opts);
};

const applyPreviewConvention = async () => {
  const tasks = [];

  // 1) Craft list tiles (work.html). Static formats render persistently.
  //    Animated formats (video / Lottie) render their last frame as idle
  //    state. Desktop : hover plays from start. Touch : scroll-driven, the
  //    tile plays once it crosses the middle band of the viewport — gives
  //    the page momentum on scroll without needing a hover affordance.
  document.querySelectorAll(".list.craft .list-item[id]").forEach((li) => {
    const a = li.querySelector("a");
    const thumb = li.querySelector(".thumb");
    if (!a || !thumb) return;
    if (thumb.querySelector("video, img, .preview-lottie-host")) return;
    tasks.push((async () => {
      const url = await resolvePreviewUrl(li.id, "tile");
      if (!url) return;
      // A preview was resolved : release the placeholder so the museum-plate
      // caption ("Visuels — mise à jour en cours") dissolves into real media.
      thumb.removeAttribute("data-media");
      const ext = previewExt(url);
      const isVideo = PREVIEW_VIDEO_EXTS.has(ext);
      const isLottie = PREVIEW_LOTTIE_EXTS.has(ext);
      const isMaybeAnimImg = ext === "gif" || ext === "webp";
      const hoverPlayable = canHover && !reducedMotion;
      const scrollPlayable = !canHover && !reducedMotion;
      if (!isVideo && !isLottie && !isMaybeAnimImg) {
        const media = makePreviewMedia(url, "thumb-media");
        if (!media) return;
        thumb.textContent = "";
        thumb.appendChild(media);
        if (media.tagName === "IMG") enhanceStill(media, a);
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
          if (media.tagName === "IMG") enhanceStill(media, a);
          return;
        }
        const still = document.createElement("img");
        still.className = "thumb-media";
        still.alt = "";
        still.decoding = "async";
        still.src = lastFrame;
        thumb.textContent = "";
        thumb.appendChild(still);
        enhanceStill(still, a);
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
        } else if (scrollPlayable) {
          let live = null;
          onMiddleBand(li, (inBand) => {
            if (inBand && !live) {
              live = document.createElement("img");
              live.className = "thumb-media";
              live.alt = "";
              live.decoding = "async";
              live.src = url;
              thumb.appendChild(live);
            } else if (!inBand && live) {
              live.remove();
              live = null;
            }
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
        } else if (scrollPlayable) {
          onMiddleBand(li, (inBand) => {
            if (inBand) {
              v.loop = true;
              try { v.currentTime = 0; } catch (_) {}
              v.play().catch(() => {});
            } else {
              try { v.pause(); } catch (_) {}
              v.loop = false;
              seekToEnd();
            }
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
        } else if (scrollPlayable) {
          onMiddleBand(li, (inBand) => {
            try {
              if (inBand) {
                anim.loop = true;
                anim.goToAndPlay(0, true);
              } else {
                anim.loop = false;
                goToIdle();
              }
            } catch (_) {}
          });
        }
      }).catch(() => {});
    })());
  });

  // 2) Case-study thumbs — stage media + (optional) static thumb frame.
  //    Animated media only plays while the thumb sits in the middle band of
  //    the viewport. On mobile : one video at a time. On tablet/desktop :
  //    matches the "active thumb" semantics that drive the stage swap.
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
              frame.removeAttribute("data-media");
              frame.appendChild(media);
              gateMediaToActiveAttr(media, li);
              // Ken Burns only on truly static images. Animated rasters
              // (gif / animated webp / apng) own their visible motion and
              // mustn't get the drift overlaid on top.
              const isAnimImg = /\.(gif|apng|webp)(\?|#|$)/i.test(thumbUrl);
              if (media.tagName === "IMG" && !isAnimImg) enhanceStill(media, li);
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

/* Cursor-follow preview — shows a gradient card with the project label.
   `?forceTouch=1` URL flag forces canHover=false so we can verify the mobile
   path (touch preview, scroll-driven tile animations) on desktop, since
   matchMedia hover can't be emulated. */
const canHover = !location.search.includes("forceTouch=1")
  && matchMedia("(hover: hover)").matches;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const initPreview = () => {
  if (reducedMotion) return;
  // Skip when only craft-list items remain (those use inline thumbs + overlay).
  const targets = [...document.querySelectorAll("[data-preview]")].filter(
    (el) => !el.closest(".list.craft")
  );
  if (!targets.length) return;
  if (canHover) _buildPreview();
  else _buildTouchPreview(targets);
};

/* Mobile / touch fallback for the home hover preview. The card pins to the
   bottom-right and tracks which item the finger is over (pointerenter fires
   on drag-into, same as the cursor-follow on desktop).
   Ive/Newson motion intent : confident fade-in on contact, snappy media
   cross-fade while the finger glides, then a deliberate hold-after-release
   so the eye can settle on the last item before the card retires. */
const _buildTouchPreview = (targets) => {
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
  enableKenBurns(imgEl);

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

  // Hold-after-release : when the finger lifts or wanders off the list, keep
  // the current preview visible for a beat so the eye can settle on the last
  // item before the card retires. Confidence over haste — pure Ive/Newson.
  const HOLD_MS = 1500;
  let holdTimer = null;
  const cancelHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };
  const scheduleHold = () => {
    cancelHold();
    holdTimer = setTimeout(() => { holdTimer = null; swap(null); }, HOLD_MS);
  };

  // Resolve which target sits under a screen point. We can't trust
  // pointerenter on touch — the initial touch captures the pointer, so
  // subsequent moves don't bubble enter events on items the finger glides
  // over. Reading elementFromPoint each move recovers the desktop-hover
  // semantics for touch.
  const targetUnder = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    return targets.find((t) => t === el || t.contains(el)) || null;
  };

  const onPointerActivity = (e) => {
    if (e.pointerType !== "touch") return;
    const t = targetUnder(e.clientX, e.clientY);
    if (t) { cancelHold(); swap(t); }
    else { scheduleHold(); }
  };

  document.addEventListener("pointerdown", onPointerActivity, { passive: true });
  document.addEventListener("pointermove", onPointerActivity, { passive: true });
  document.addEventListener("pointerup", (e) => {
    if (e.pointerType !== "touch") return;
    scheduleHold();
  }, { passive: true });
  document.addEventListener("pointercancel", (e) => {
    if (e.pointerType !== "touch") return;
    scheduleHold();
  }, { passive: true });
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
  enableKenBurns(imgEl);

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
  let rafId = null;
  if (!anchored) { tx = ty = targetX = targetY = -9999; }

  const SETTLE_EPS = 0.05;
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
    // Sleep once the spring is settled. wake() relaunches on the next interaction.
    const settled =
      Math.abs(tx - targetX) < SETTLE_EPS && Math.abs(ty - targetY) < SETTLE_EPS &&
      Math.abs(vx) < SETTLE_EPS && Math.abs(vy) < SETTLE_EPS;
    if (settled && !active) { rafId = null; return; }
    rafId = requestAnimationFrame(tick);
  };
  const wake = () => {
    if (rafId) return;
    lastT = performance.now();
    rafId = requestAnimationFrame(tick);
  };
  wake();

  if (!anchored) {
    document.addEventListener("pointermove", (e) => {
      targetX = e.clientX + OFFSET_X;
      targetY = e.clientY + OFFSET_Y;
      wake();
    }, { passive: true });
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
      wake();

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
      wake();
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
        enhanceStill(media, a);
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

/* Case study — scroll-driven big-stage swap from a thumb rail.
   Each swap builds a fresh layer, waits for it to be decoded / first-frame ready,
   then reveals it BENEATH the outgoing one. The outgoing dissolves on top,
   so the user never sees a half-loaded image mid-fade. */
const initCaseStudy = () => {
  const stage = document.querySelector("[data-stage]");
  if (!stage) return;
  const thumbs = [...document.querySelectorAll(".case-thumbs > li")];
  if (!thumbs.length) return;

  // The static <img>/<video> in the template are placeholders for the first paint —
  // we own the layer DOM dynamically from here on.
  stage.querySelector(".stage-img")?.remove();
  stage.querySelector(".stage-video")?.remove();

  const counterEl = stage.querySelector(".stage-counter");
  const total = thumbs.length;
  const VIDEO_RE = /\.(mp4|webm|mov|ogg|ogv)(\?|#|$)/i;
  const LOTTIE_RE = /\.(json|lottie)(\?|#|$)/i;

  // Animated raster formats own their own playback like video/Lottie. We
  // tag them with a distinct type so they don't get Ken Burns (would steal
  // the visible motion) and don't get .settled (releasing the GPU layer
  // freezes frame decoding in Chrome/Safari).
  // webp is included because case-study stages use animated webp; static
  // webps would also fall here but pay nothing extra — Ken Burns on a
  // single-frame webp is just a no-op visually.
  const ANIM_IMG_RE = /\.(gif|apng|webp)(\?|#|$)/i;

  const fmt = (n) => String(n).padStart(2, "0");

  let activeIdx = -1;
  let pendingIdx = -1;
  let currentLayer = null;

  const buildLayer = (src) => {
    if (!src) return null;
    if (VIDEO_RE.test(src)) {
      const v = document.createElement("video");
      v.className = "stage-media stage-video";
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.setAttribute("playsinline", "");
      v.preload = "auto";
      v.setAttribute("aria-hidden", "true");
      v.src = src;
      return { el: v, type: "video", src };
    }
    if (LOTTIE_RE.test(src)) {
      const d = document.createElement("div");
      d.className = "stage-media stage-lottie";
      d.setAttribute("aria-hidden", "true");
      return { el: d, type: "lottie", src };
    }
    const img = document.createElement("img");
    img.className = "stage-media stage-img";
    img.alt = "";
    img.decoding = "async";
    img.src = src;
    const type = ANIM_IMG_RE.test(src) ? "anim-image" : "image";
    return { el: img, type, src };
  };

  const whenReady = (layer) => new Promise((resolve) => {
    if (!layer) return resolve();
    if (layer.type === "image" || layer.type === "anim-image") {
      const img = layer.el;
      const done = () => resolve();
      if (img.decode) img.decode().then(done, done);
      else if (img.complete) done();
      else {
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      }
    } else if (layer.type === "video") {
      const v = layer.el;
      if (v.readyState >= 2) return resolve();
      const done = () => {
        v.removeEventListener("loadeddata", done);
        v.removeEventListener("error", done);
        resolve();
      };
      v.addEventListener("loadeddata", done, { once: true });
      v.addEventListener("error", done, { once: true });
      // Safety net : never block the swap on a wedged video.
      setTimeout(done, 1500);
    } else if (layer.type === "lottie") {
      Promise.all([loadLottieLib(), fetchLottieData(layer.src)])
        .then(([lottie, data]) => {
          if (layer.cancelled) return resolve();
          layer.anim = lottie.loadAnimation({
            container: layer.el,
            renderer: "svg",
            loop: true,
            autoplay: true,
            animationData: data,
            rendererSettings: { preserveAspectRatio: "xMidYMid slice" },
          });
          resolve();
        })
        .catch(() => resolve());
    } else {
      resolve();
    }
  });

  const destroyLayer = (layer) => {
    if (!layer || !layer.el) return;
    layer.cancelled = true;
    if (layer.type === "video") {
      try { layer.el.pause(); } catch (_) {}
      layer.el.removeAttribute("src");
      try { layer.el.load(); } catch (_) {}
    }
    if (layer.anim) { try { layer.anim.destroy(); } catch (_) {} }
    layer.el.remove();
  };

  const swap = async (idx) => {
    if (idx === activeIdx && idx === pendingIdx) return;
    pendingIdx = idx;
    activeIdx = idx;

    thumbs.forEach((li, i) => {
      if (i === idx) li.setAttribute("data-active", "");
      else li.removeAttribute("data-active");
    });
    if (counterEl) counterEl.textContent = `${fmt(idx + 1)} / ${fmt(total)}`;

    // Mobile : stage is `display: none` — don't fetch media at all.
    if (getComputedStyle(stage).display === "none") {
      if (currentLayer) { destroyLayer(currentLayer); currentLayer = null; }
      return;
    }

    const li = thumbs[idx];
    const src = li?.dataset.stageSrc || "";
    const nextLayer = buildLayer(src);

    if (nextLayer) {
      // First real media on the stage : release the placeholder caption.
      // Subsequent swaps may show empty interludes between scenes — but once
      // the case study has surfaced any real visual we don't reinstate the
      // "mise à jour" plate, the silence reads as composition, not absence.
      stage.removeAttribute("data-media");
      // Insert BENEATH the current layer so the outgoing dissolves above it.
      if (currentLayer?.el && currentLayer.el.parentNode === stage) {
        stage.insertBefore(nextLayer.el, currentLayer.el);
      } else if (counterEl) {
        stage.insertBefore(nextLayer.el, counterEl);
      } else {
        stage.appendChild(nextLayer.el);
      }
    }

    await whenReady(nextLayer);

    // A newer swap raced ahead — drop this one cleanly.
    if (pendingIdx !== idx) { destroyLayer(nextLayer); return; }

    if (nextLayer?.type === "video") {
      try { await nextLayer.el.play(); } catch (_) {}
    }

    // Two rAFs : let the initial styles commit before flipping to .active,
    // so the transform/blur/opacity actually animate instead of snapping.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (pendingIdx !== idx) { destroyLayer(nextLayer); return; }
      const outgoing = currentLayer;
      if (nextLayer?.el) nextLayer.el.classList.add("active");
      currentLayer = nextLayer;
      // Hand transform control to .kb (Ken Burns + cursor parallax) once the
      // entry transition settles. Images only — videos and Lottie animate
      // themselves. Length matches the longest entry transition (1.1s).
      if (nextLayer?.type === "image") {
        const layer = nextLayer;
        // Matches the unified 0.8s entry transition + a tiny settle buffer.
        layer._kbTimer = setTimeout(() => {
          if (currentLayer === layer && layer.el?.isConnected) {
            enhanceStill(layer.el, stage);
          }
        }, 850);
        // After the entry transition completes, mark the image .settled so
        // CSS can drop `will-change` / `filter` / `transform`. A permanent
        // compositing layer stalls GIF frame decoding in Chrome/Safari.
        // Restricted to images : video and Lottie manage their own playback
        // and must keep their compositing surface intact — releasing it on
        // them causes the animation to be treated as a static frame.
        layer._settleTimer = setTimeout(() => {
          if (currentLayer === layer && layer.el?.isConnected) {
            layer.el.classList.add("settled");
          }
        }, 820);
      }
      if (outgoing?.el) {
        if (outgoing._kbTimer) { clearTimeout(outgoing._kbTimer); outgoing._kbTimer = null; }
        if (outgoing._settleTimer) { clearTimeout(outgoing._settleTimer); outgoing._settleTimer = null; }
        outgoing.el.classList.remove("kb"); // let .leaving own the transform
        outgoing.el.classList.remove("settled");
        outgoing.el.classList.remove("active");
        outgoing.el.classList.add("leaving");
        const cleanup = () => destroyLayer(outgoing);
        outgoing.el.addEventListener("transitionend", cleanup, { once: true });
        // Fallback in case transitionend never fires (tab hidden, prefers-reduced-motion edge cases).
        setTimeout(cleanup, 900);
      }
    }));
  };

  // Pick the active thumb. Vertical (desktop) : closest to viewport center.
  // Horizontal (tablet rail) : closest to the start snap-point (matches scroll-snap-align: start).
  const rail = thumbs[0].parentElement;
  // Cache layout-mode hints. Refreshed on resize (rail flex-direction is
  // driven by media query, padding rarely changes). Avoids two
  // getComputedStyle() calls per scroll frame.
  let railHorizontal = false;
  let railPadLeft = 0;
  const refreshRailLayout = () => {
    const cs = getComputedStyle(rail);
    railHorizontal = cs.flexDirection === "row";
    railPadLeft = parseFloat(cs.scrollPaddingInlineStart) || 0;
  };
  refreshRailLayout();
  const computeActive = () => {
    let bestIdx = 0, bestDist = Infinity;
    if (railHorizontal) {
      const target = rail.getBoundingClientRect().left + railPadLeft;
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

  // Throttle: rAF alone fires at 60Hz, and each call reads N boundingClientRect
  // for N thumbs. Capping at ~33ms (≈30Hz) halves the layout cost during fast
  // scroll without any perceptible lag in the active-thumb swap.
  let rafId = null;
  let lastTs = 0;
  const THROTTLE_MS = 33;
  const onScroll = () => {
    if (rafId) return;
    rafId = requestAnimationFrame((ts) => {
      rafId = null;
      if (ts - lastTs < THROTTLE_MS) {
        // Re-arm for next frame so we don't miss the final position when scroll stops.
        rafId = requestAnimationFrame(() => { rafId = null; lastTs = performance.now(); computeActive(); });
        return;
      }
      lastTs = ts;
      computeActive();
    });
  };
  const onResize = () => { refreshRailLayout(); onScroll(); };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize, { passive: true });
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

/* ——— Lock manager — soft-gate for projects on invitation only.
   Auto-detected : a project is locked when its tile is missing OR any of
   its four stages (stage-01..04) lacks a photo/video/asset. Add the missing
   files in assets/previews/<slug>/ and the lock releases on the next visit.
   Soft-gate only — anyone reading source can find the hash. Never commit
   client visuals under NDA, even after a lock.  */
const LOCK_STORAGE_KEY = "jvm:unlocked";
const LOCK_MAILTO = "jaime.vile@gmail.com";
/* Master switch — flip to false to disable the "J'ai déjà une clé" path.
   Visitors can still request a key, but the entry input disappears.
   Useful if you want to handle every access manually for a period. */
const LOCK_KEY_ENTRY_ENABLED = true;
/* Per-recipient SHA-256 hashes. One entry = one issued key.
   Issue a new key :  npm run issue-key -- "Label du destinataire"
   The script prints the plaintext (à transmettre) and the hash (à coller ici).
   Keep plaintext keys in a private vault — intentionally absent from the repo.
   Revoke a key = delete its hash line below. */
const LOCK_MAGICKEY_HASHES = new Set([
  "c6d13af9b9e2f23c32caa8970df3c7daf693c633dafc93440f17f8f36f54e9ec", // 2026-05-18 · legacy
]);

const lockIsUnlocked = () => {
  try { return localStorage.getItem(LOCK_STORAGE_KEY) === "1"; } catch (_) { return false; }
};
const lockSetUnlocked = () => {
  try { localStorage.setItem(LOCK_STORAGE_KEY, "1"); } catch (_) {}
};

const sha256Hex = async (text) => {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const lockVerifyKey = async (input) => {
  if (!input) return false;
  try {
    const hash = await sha256Hex(input.trim());
    return LOCK_MAGICKEY_HASHES.has(hash);
  } catch (_) { return false; }
};

const lockIsSlugLocked = async (slug) => {
  // Locked when tile is missing OR any of the 4 stages lacks media.
  // Tile is checked first as a fast-fail short-circuit.
  const tile = await resolvePreviewUrl(slug, "tile");
  if (!tile) return true;
  const stages = await Promise.all(
    [1, 2, 3, 4].map((n) => resolvePreviewUrl(slug, `stage-${String(n).padStart(2, "0")}`))
  );
  return stages.some((url) => !url);
};

const lockResolveLockedSet = async () => {
  // Auto-detect candidates : every project listed on /work.html plus the
  // current case-study slug if we're on one. Reuses sessionStorage cache.
  const slugs = new Set();
  document.querySelectorAll(".list.craft .list-item[id]").forEach((li) => slugs.add(li.id));
  const body = document.body;
  if (body.classList.contains("case-study")) {
    const s = body.getAttribute("data-slug");
    if (s) slugs.add(s);
  }
  const results = await Promise.all(
    [...slugs].map(async (slug) => [slug, await lockIsSlugLocked(slug)])
  );
  return new Set(results.filter(([, locked]) => locked).map(([slug]) => slug));
};

let lockModalEl = null;
const lockEnsureModal = () => {
  if (lockModalEl) return lockModalEl;
  const html = `
<div class="lock-modal" hidden role="dialog" aria-modal="true" aria-labelledby="lock-title">
  <div class="lock-modal__backdrop" data-lock-close></div>
  <div class="lock-modal__panel" data-lock-view="request">
    <button class="lock-modal__close" type="button" data-lock-close aria-label="Fermer">
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1 1 L13 13 M13 1 L1 13" stroke="currentColor" stroke-width="1" fill="none"/></svg>
    </button>

    <section data-lock-pane="request">
      <h2 class="lock-modal__title" id="lock-title">Demander la clé</h2>
      <p class="lock-modal__lede">Sous accord de confidentialité. Précisez votre demande, je vous transmets la clé à l'email indiqué.</p>
      <form class="lock-form" data-lock-form="request" novalidate>
        <label class="lock-field">
          <span class="lock-field__label">Email</span>
          <input type="email" name="email" required autocomplete="email" placeholder="vous@exemple.com" />
        </label>
        <label class="lock-field">
          <span class="lock-field__label">Téléphone</span>
          <input type="tel" name="phone" required pattern="0[67][\\s.\\-]?([0-9][\\s.\\-]?){8}" placeholder="06 12 34 56 78" />
        </label>
        <label class="lock-field">
          <span class="lock-field__label">Demande</span>
          <textarea name="why" rows="4" required placeholder="Qui vous êtes, et ce que vous proposez."></textarea>
        </label>
        <label class="lock-field lock-field--check">
          <input type="checkbox" name="consent" required />
          <span>J'accepte d'être recontacté·e par téléphone à propos de cette demande.</span>
        </label>
        <div class="lock-field lock-field--hp" aria-hidden="true">
          <label>Ne rien remplir<input type="text" name="hp" tabindex="-1" autocomplete="off" /></label>
        </div>
        <div class="lock-form__actions">
          <button type="submit" class="lock-btn" data-lock-submit>Envoyer</button>
        </div>
        <div class="lock-form__alt">
          <button type="button" class="lock-link" data-lock-switch="key">J'ai déjà une clé</button>
        </div>
      </form>
    </section>

    <section data-lock-pane="thanks" hidden>
      <h2 class="lock-modal__title">Demande envoyée</h2>
      <p class="lock-modal__lede">Merci. Je reviens vers vous rapidement avec la clé d'accès, à l'adresse indiquée.</p>
      <div class="lock-form__actions">
        <button type="button" class="lock-btn" data-lock-close>Fermer</button>
      </div>
    </section>

    <section data-lock-pane="key" hidden>
      <h2 class="lock-modal__title">Saisir la clé</h2>
      <p class="lock-modal__lede">La clé déverrouille les cas d'étude protégés en une fois.</p>
      <form class="lock-form" data-lock-form="key" novalidate>
        <label class="lock-field">
          <span class="lock-field__label">Clé</span>
          <input type="password" name="key" required autocomplete="off" autocapitalize="off" spellcheck="false" />
        </label>
        <p class="lock-error" data-lock-error hidden>Clé non reconnue.</p>
        <div class="lock-form__actions">
          <button type="submit" class="lock-btn">Déverrouiller</button>
        </div>
        <div class="lock-form__alt">
          <button type="button" class="lock-link" data-lock-switch="request">Demander une clé</button>
        </div>
      </form>
    </section>
  </div>
</div>`;
  const tpl = document.createElement("div");
  tpl.innerHTML = html.trim();
  lockModalEl = tpl.firstElementChild;
  document.body.appendChild(lockModalEl);

  // Master switch — when key entry is disabled, the "key" pane is removed and
  // the link from the request view that would jump to it is hidden too.
  if (!LOCK_KEY_ENTRY_ENABLED) {
    lockModalEl.querySelectorAll('[data-lock-pane="key"]').forEach((el) => el.remove());
    lockModalEl.querySelectorAll('[data-lock-switch="key"]').forEach((el) => el.remove());
  }

  lockModalEl.querySelectorAll("[data-lock-close]").forEach((el) => {
    el.addEventListener("click", lockCloseModal);
  });
  lockModalEl.querySelectorAll("[data-lock-switch]").forEach((el) => {
    el.addEventListener("click", () => lockSwitchView(el.getAttribute("data-lock-switch")));
  });

  lockModalEl.querySelector('[data-lock-form="request"]').addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.checkValidity()) { f.reportValidity(); return; }
    const submitBtn = f.querySelector("[data-lock-submit]");
    const submitLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Envoi…";
    try {
      const r = await fetch("/api/request-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: f.elements.email.value.trim(),
          phone: f.elements.phone.value.trim(),
          why: f.elements.why.value.trim(),
          consent: f.elements.consent.checked,
          hp: f.elements.hp ? f.elements.hp.value : "",
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.ok) {
        f.reset();
        lockSwitchView("thanks");
      }
    } catch (_) {
      // Silent fail — re-enable the button and let the user retry.
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = submitLabel;
    }
  });

  const keyForm = lockModalEl.querySelector('[data-lock-form="key"]');
  if (keyForm) {
    keyForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = lockModalEl.querySelector("[data-lock-error]");
      errEl.hidden = true;
      const ok = await lockVerifyKey(keyForm.elements.key.value);
      if (ok) {
        lockSetUnlocked();
        keyForm.reset();
        lockCloseModal();
        lockRemoveAllLocks();
      } else {
        errEl.hidden = false;
        keyForm.classList.remove("is-shaking");
        void keyForm.offsetWidth;
        keyForm.classList.add("is-shaking");
      }
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lockModalEl && !lockModalEl.hidden) lockCloseModal();
  });

  return lockModalEl;
};

const lockSwitchView = (view) => {
  if (!lockModalEl) return;
  // Master switch fallback : if key entry is disabled, force the request view.
  if (view === "key" && !LOCK_KEY_ENTRY_ENABLED) view = "request";
  const panel = lockModalEl.querySelector(".lock-modal__panel");
  panel.setAttribute("data-lock-view", view);
  lockModalEl.querySelectorAll("[data-lock-pane]").forEach((p) => {
    p.hidden = p.getAttribute("data-lock-pane") !== view;
  });
  const input = lockModalEl.querySelector(`[data-lock-pane="${view}"] input`);
  if (input) setTimeout(() => input.focus(), 60);
};

const lockOpenModal = (initialView = "request") => {
  lockEnsureModal();
  lockModalEl.hidden = false;
  requestAnimationFrame(() => lockModalEl.setAttribute("data-open", ""));
  document.body.classList.add("no-scroll");
  lockSwitchView(initialView);
};

const lockCloseModal = () => {
  if (!lockModalEl || lockModalEl.hidden) return;
  lockModalEl.removeAttribute("data-open");
  document.body.classList.remove("no-scroll");
  setTimeout(() => { if (lockModalEl) lockModalEl.hidden = true; }, 320);
};

const lockApplyToGrid = (lockedSet) => {
  document.querySelectorAll(".list.craft .list-item[id]").forEach((li) => {
    if (!lockedSet.has(li.id)) return;
    li.classList.add("is-locked");
    const a = li.querySelector("a");
    if (a && !a.dataset.lockBound) {
      a.dataset.lockBound = "1";
      a.addEventListener("click", (e) => {
        if (lockIsUnlocked()) return;
        e.preventDefault();
        lockOpenModal("request");
      });
    }
  });
};

const lockApplyToCaseStudy = (lockedSet) => {
  const body = document.body;
  if (!body.classList.contains("case-study")) return;
  const slug = body.getAttribute("data-slug");
  if (!slug || !lockedSet.has(slug)) return;

  const grid = document.querySelector(".case-grid");
  if (grid) grid.classList.add("is-locked-veil");

  if (document.querySelector(".lock-invite")) return;
  const panel = document.createElement("aside");
  panel.className = "lock-invite";
  const keyEntryHtml = LOCK_KEY_ENTRY_ENABLED
    ? `<button type="button" class="lock-link" data-lock-open="key">J'ai déjà une clé</button>`
    : "";
  panel.innerHTML = `
    <div class="lock-invite__inner">
      <p class="lock-invite__eyebrow">Projet sur invitation</p>
      <h2 class="lock-invite__title">Sous accord de confidentialité</h2>
      <p class="lock-invite__lede">Le détail de ce projet n'est partagé que sur demande. Précisez votre intention et je vous transmets la clé.</p>
      <div class="lock-invite__actions">
        <button type="button" class="lock-btn" data-lock-open="request">Demander la clé</button>
        ${keyEntryHtml}
      </div>
    </div>`;
  body.appendChild(panel);
  panel.querySelectorAll("[data-lock-open]").forEach((b) => {
    b.addEventListener("click", () => lockOpenModal(b.getAttribute("data-lock-open")));
  });
};

// Persistent "Accès" entry point in the site nav so a key-holder can re-enter
// the key after cache clear without hunting for a locked card. Hidden when the
// site is already unlocked or when key entry is disabled by the master switch.
const lockInjectKeyEntryLink = () => {
  if (!LOCK_KEY_ENTRY_ENABLED) return;
  if (lockIsUnlocked()) return;
  const nav = document.querySelector(".site-nav");
  if (!nav || nav.querySelector("[data-lock-entry]")) return;
  const a = document.createElement("a");
  a.href = "#";
  a.setAttribute("data-lock-entry", "");
  a.className = "site-nav__access";
  a.textContent = "Accès";
  a.addEventListener("click", (e) => {
    e.preventDefault();
    lockOpenModal("key");
  });
  nav.appendChild(a);
};

const lockRemoveAllLocks = () => {
  document.querySelectorAll(".list.craft .list-item.is-locked").forEach((li) => {
    li.classList.remove("is-locked");
  });
  document.querySelectorAll(".case-grid.is-locked-veil").forEach((g) => g.classList.remove("is-locked-veil"));
  document.querySelectorAll(".lock-invite").forEach((p) => p.remove());
  document.querySelectorAll("[data-lock-entry]").forEach((a) => a.remove());
};

const initLockManager = async () => {
  if (lockIsUnlocked()) return;
  lockInjectKeyEntryLink();
  const lockedSet = await lockResolveLockedSet();
  if (lockedSet.size === 0) return;
  lockApplyToGrid(lockedSet);
  lockApplyToCaseStudy(lockedSet);
};

initLockManager();
