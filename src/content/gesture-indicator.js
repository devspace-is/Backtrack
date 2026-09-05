// @ts-check

(() => {
  "use strict";

  if (window !== window.top) {
    return;
  }

  const API_NAME = "BacktrackGestureIndicator";
  if (Object.prototype.hasOwnProperty.call(globalThis, API_NAME)) {
    return;
  }

  const HIDE_DELAY_MS = 180;
  const COMMIT_HIDE_DELAY_MS = 260;
  let host = null;
  let indicator = null;
  let progressRing = null;
  let arrow = null;
  let hideTimer = null;
  let visible = false;
  let phase = "hidden";
  let lastProgress = 0;

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function clearHideTimer() {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function ensureElements() {
    if (host?.isConnected && indicator && progressRing && arrow) {
      return true;
    }

    const root = document.documentElement;
    if (!root) {
      return false;
    }

    host = document.createElement("div");
    host.setAttribute("data-backtrack-gesture-indicator", "");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = [
      "all: initial",
      "position: fixed",
      "inset: 0",
      "z-index: 2147483647",
      "pointer-events: none",
      "contain: style",
      "width: 0",
      "height: 0",
    ].join(";");

    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }

      .indicator {
        --progress: 0;
        --travel: 0px;
        position: fixed;
        left: 50%;
        top: 50%;
        width: 90px;
        height: 90px;
        display: grid;
        place-items: center;
        opacity: 0;
        transform: translate(calc(-50% - var(--travel)), -50%) scale(.88);
        transition:
          opacity 130ms ease,
          transform 150ms cubic-bezier(.2, .8, .2, 1);
        will-change: transform, opacity;
      }

      .indicator[data-visible="true"] {
        opacity: .82;
      }

      .ring {
        position: absolute;
        inset: 0;
        border-radius: 999px;
        background: conic-gradient(
          from -90deg,
          rgba(105, 171, 255, .98) calc(var(--progress) * 1turn),
          rgba(255, 255, 255, .16) 0
        );
        -webkit-mask: radial-gradient(
          farthest-side,
          transparent calc(100% - 10px),
          #000 calc(100% - 10px)
        );
        mask: radial-gradient(
          farthest-side,
          transparent calc(100% - 10px),
          #000 calc(100% - 10px)
        );
        box-shadow:
          0 8px 28px rgba(0, 0, 0, .30),
          0 1px 3px rgba(0, 0, 0, .24);
      }

      .arrow {
        position: relative;
        width: 40px;
        height: 40px;
        color: rgba(255, 255, 255, .96);
        filter: drop-shadow(0 1px 1px rgba(0, 0, 0, .28));
        transform: translateX(1px);
        transition:
          color 120ms ease,
          transform 150ms cubic-bezier(.2, .8, .2, 1);
      }

      .indicator[data-phase="armed"] {
        transform: translate(calc(-50% - 12px), -50%) scale(1);
      }

      .indicator[data-phase="armed"] .arrow,
      .indicator[data-phase="committed"] .arrow {
        color: rgb(132, 190, 255);
      }

      .indicator[data-phase="committed"] {
        opacity: 0;
        transform: translate(calc(-50% - 36px), -50%) scale(1.12);
        transition:
          opacity 210ms ease,
          transform 240ms cubic-bezier(.16, 1, .3, 1);
      }

      .indicator[data-phase="committed"] .arrow {
        transform: translateX(-3px);
      }

      @media (prefers-reduced-motion: reduce) {
        .indicator,
        .arrow {
          transition-duration: 1ms !important;
        }

        .indicator[data-phase="committed"] {
          transform: translate(calc(-50% - 12px), -50%) scale(1);
        }
      }
    `;

    indicator = document.createElement("div");
    indicator.className = "indicator";
    indicator.dataset.visible = "false";
    indicator.dataset.phase = "hidden";

    progressRing = document.createElement("div");
    progressRing.className = "ring";

    arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    arrow.classList.add("arrow");
    arrow.setAttribute("viewBox", "0 0 24 24");
    arrow.setAttribute("fill", "none");
    arrow.setAttribute("stroke", "currentColor");
    arrow.setAttribute("stroke-width", "2.2");
    arrow.setAttribute("stroke-linecap", "round");
    arrow.setAttribute("stroke-linejoin", "round");
    arrow.innerHTML = '<path d="M19 12H5M11 18l-6-6 6-6" />';

    indicator.append(progressRing, arrow);
    shadow.append(style, indicator);
    root.append(host);
    return true;
  }

  function update(options = {}) {
    if (!ensureElements()) {
      return false;
    }

    clearHideTimer();
    lastProgress = clamp(Number(options.progress) || 0, 0, 1);
    phase = options.phase === "armed" ? "armed" : "tracking";
    visible = true;

    indicator.style.setProperty("--progress", String(lastProgress));
    indicator.style.setProperty(
      "--travel",
      `${Math.round(lastProgress * 10)}px`,
    );
    indicator.dataset.phase = phase;
    indicator.dataset.visible = "true";
    return true;
  }

  function hide(options = {}) {
    if (!indicator) {
      return false;
    }

    clearHideTimer();
    phase = "cancelled";
    indicator.dataset.phase = "tracking";
    indicator.dataset.visible = "false";
    const delayMs = Number.isFinite(options.delayMs)
      ? Math.max(0, options.delayMs)
      : HIDE_DELAY_MS;
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      visible = false;
      phase = "hidden";
      if (indicator) {
        indicator.dataset.phase = "hidden";
      }
    }, delayMs);
    return true;
  }

  function commit() {
    if (!indicator || !visible) {
      return false;
    }

    clearHideTimer();
    phase = "committed";
    indicator.style.setProperty("--progress", "1");
    indicator.dataset.phase = "committed";
    indicator.dataset.visible = "true";
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      visible = false;
      phase = "hidden";
      if (indicator) {
        indicator.dataset.visible = "false";
        indicator.dataset.phase = "hidden";
      }
    }, COMMIT_HIDE_DELAY_MS);
    return true;
  }

  function destroy() {
    clearHideTimer();
    host?.remove();
    host = null;
    indicator = null;
    progressRing = null;
    arrow = null;
    visible = false;
    phase = "hidden";
    lastProgress = 0;
  }

  Object.defineProperty(globalThis, API_NAME, {
    value: Object.freeze({
      update,
      hide,
      commit,
      destroy,
      getStatus: () => ({
        mounted: Boolean(host?.isConnected),
        visible,
        phase,
        progress: lastProgress,
        placement: "VIEWPORT_CENTER",
      }),
    }),
    writable: false,
    configurable: false,
    enumerable: false,
  });
})();
