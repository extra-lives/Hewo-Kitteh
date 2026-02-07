const SHEET_PATH = "assets/3Aug2025Update_UNPAID-PREVIEW.png";
const ANIMATIONS_PATH = "cat-animations.json";

const canvas = document.getElementById("cat-canvas");
const ctx = canvas ? canvas.getContext("2d") : null;
const controlsEl = document.getElementById("controls");
const statusEl = document.getElementById("status");

const state = {
  sheet: null,
  animations: null,
  activeAnimationKey: null,
  frameIndex: 0,
  frameTimerMs: 0,
  lastTimestamp: 0,
};

function setStatus(message) {
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function makeButton(label, key) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-btn";
  button.dataset.animation = key;
  button.textContent = label;
  return button;
}

function updateActiveButton() {
  if (!controlsEl) {
    return;
  }

  const allButtons = controlsEl.querySelectorAll("button[data-animation]");
  for (const button of allButtons) {
    button.classList.toggle("is-active", button.dataset.animation === state.activeAnimationKey);
  }
}

function setAnimation(key) {
  if (!state.animations || !state.animations.animations[key]) {
    return;
  }

  state.activeAnimationKey = key;
  state.frameIndex = 0;
  state.frameTimerMs = 0;
  updateActiveButton();

  const prettyName = state.animations.animations[key].label || key;
  setStatus(`Current animation: ${prettyName}`);
}

function buildControls() {
  if (!controlsEl) {
    return;
  }

  controlsEl.innerHTML = "";

  const entries = Object.entries(state.animations.animations);
  for (const [key, animation] of entries) {
    const button = makeButton(animation.label || key, key);
    button.addEventListener("click", () => setAnimation(key));
    controlsEl.appendChild(button);
  }
}

function getCurrentFrame(animation) {
  if (!animation.frames.length) {
    return null;
  }

  return animation.frames[state.frameIndex % animation.frames.length];
}

function isValidFrame(frame) {
  return (
    frame &&
    Number.isFinite(frame.x) &&
    Number.isFinite(frame.y) &&
    Number.isFinite(frame.w) &&
    Number.isFinite(frame.h) &&
    frame.w > 0 &&
    frame.h > 0
  );
}

function buildFramesFromRow(animation, defaults) {
  const frameWidth = animation.frameWidth ?? defaults.frameWidth;
  const frameHeight = animation.frameHeight ?? defaults.frameHeight;
  const startCol = animation.startCol ?? 0;
  const frameCount = animation.frameCount;
  const row = animation.row;

  if (
    !Number.isInteger(row) ||
    !Number.isInteger(frameCount) ||
    frameCount < 1 ||
    !Number.isFinite(frameWidth) ||
    !Number.isFinite(frameHeight) ||
    frameWidth <= 0 ||
    frameHeight <= 0
  ) {
    return null;
  }

  const sheetOffsetX = animation.sheetOffsetX ?? defaults.sheetOffsetX ?? 0;
  const sheetOffsetY = animation.sheetOffsetY ?? defaults.sheetOffsetY ?? 0;

  return Array.from({ length: frameCount }, (_, index) => ({
    x: sheetOffsetX + (startCol + index) * frameWidth,
    y: sheetOffsetY + row * frameHeight,
    w: frameWidth,
    h: frameHeight,
  }));
}

function normalizeAnimations(data) {
  const defaults = {
    frameDurationMs: 120,
    scale: 4,
    frameWidth: 32,
    frameHeight: 32,
    sheetOffsetX: 0,
    sheetOffsetY: 0,
    ...(data.defaults || {}),
  };

  const normalized = {
    ...data,
    defaults,
    animations: {},
  };

  for (const [name, animation] of Object.entries(data.animations)) {
    const fallbackLabel = name.charAt(0).toUpperCase() + name.slice(1);
    const resolvedFrames = Array.isArray(animation.frames)
      ? animation.frames
      : buildFramesFromRow(animation, defaults);

    if (!Array.isArray(resolvedFrames) || resolvedFrames.length === 0) {
      throw new Error(
        `Animation '${name}' needs either a non-empty 'frames' array or valid row/frameCount data.`,
      );
    }

    if (!resolvedFrames.every(isValidFrame)) {
      throw new Error(`Animation '${name}' has invalid frame data.`);
    }

    normalized.animations[name] = {
      label: animation.label ?? fallbackLabel,
      frameDurationMs: animation.frameDurationMs ?? defaults.frameDurationMs,
      scale: animation.scale ?? defaults.scale,
      frames: resolvedFrames,
    };
  }

  return normalized;
}

function draw(deltaMs) {
  if (!ctx) {
    return;
  }

  ctx.imageSmoothingEnabled = false;

  const animation = state.animations.animations[state.activeAnimationKey];
  if (!animation) {
    return;
  }

  const frameDurationMs = animation.frameDurationMs ?? state.animations.defaults.frameDurationMs;
  state.frameTimerMs += deltaMs;

  while (state.frameTimerMs >= frameDurationMs) {
    state.frameTimerMs -= frameDurationMs;
    state.frameIndex = (state.frameIndex + 1) % animation.frames.length;
  }

  const frame = getCurrentFrame(animation);
  if (!frame) {
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const scale = animation.scale ?? state.animations.defaults.scale;
  const targetW = frame.w * scale;
  const targetH = frame.h * scale;
  const x = (canvas.width - targetW) / 2;
  const y = (canvas.height - targetH) / 2;

  ctx.drawImage(
    state.sheet,
    frame.x,
    frame.y,
    frame.w,
    frame.h,
    x,
    y,
    targetW,
    targetH,
  );
}

function tick(timestamp) {
  const deltaMs = state.lastTimestamp ? timestamp - state.lastTimestamp : 16;
  state.lastTimestamp = timestamp;

  draw(deltaMs);
  requestAnimationFrame(tick);
}

async function loadSheet() {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.src = SHEET_PATH;
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load sprite sheet: ${SHEET_PATH}`));
  });
}

async function loadAnimations() {
  const response = await fetch(ANIMATIONS_PATH);
  if (!response.ok) {
    throw new Error(`Failed to load animation JSON: ${ANIMATIONS_PATH}`);
  }

  return response.json();
}

function validateAnimations(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Animation JSON must be an object.");
  }

  if (!data.animations || typeof data.animations !== "object") {
    throw new Error("Animation JSON needs an 'animations' object.");
  }

  if (typeof data.defaults !== "undefined" && typeof data.defaults !== "object") {
    throw new Error("If provided, 'defaults' must be an object.");
  }
}

async function init() {
  try {
    if (!canvas || !ctx || !controlsEl || !statusEl) {
      throw new Error("Missing required DOM elements (#cat-canvas, #controls, #status).");
    }

    ctx.imageSmoothingEnabled = false;

    setStatus("Loading sprite sheet and animation data...");

    const [sheet, animations] = await Promise.all([loadSheet(), loadAnimations()]);
    validateAnimations(animations);

    state.sheet = sheet;
    state.animations = normalizeAnimations(animations);

    buildControls();

    const startAnimation =
      state.animations.defaultAnimation && state.animations.animations[state.animations.defaultAnimation]
        ? state.animations.defaultAnimation
        : Object.keys(state.animations.animations)[0];

    if (!startAnimation) {
      throw new Error("No animations found in JSON.");
    }

    setAnimation(startAnimation);
    requestAnimationFrame(tick);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Could not initialize app.");
  }
}

init();
