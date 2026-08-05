import "./styles.css";
import { Niivue, NVImage } from "@niivue/niivue";
import { dicomLoader } from "@niivue/dicom-loader";

const TABS = [
  { key: "t1", label: "T1", type: "dicom" },
  { key: "flair", label: "FLAIR", type: "dicom" },
  { key: "t1_overlay", label: "T1 + Overlay", type: "dicom" },
  { key: "flair_overlay", label: "FLAIR + Overlay", type: "dicom" },
  { key: "pdf", label: "PDF", type: "report" },
];

const TAB_BY_KEY = new Map(TABS.map((tab) => [tab.key, tab]));
const SLICE_TOOL = { NAVIGATE: "navigate", ZOOM: "zoom", RESET: "reset" };
const ORIENTATION = { AXIAL: 0, CORONAL: 1, SAGITTAL: 2 };
const ORTHOGONAL_ORIENTATIONS = [ORIENTATION.AXIAL, ORIENTATION.CORONAL, ORIENTATION.SAGITTAL];
const CASE_STATUS_VALUES = new Set(["", "Positive", "Negative", "Borderline"]);
const NOTES_LS_KEY = "FASTREADS_JCB_NOTES_V1";
const REVIEW_LS_KEY = "FASTREADS_JCB_REVIEW_V1";

const $ = (id) => document.getElementById(id);
const sidEl = $("sid");
const sidxEl = $("sidx");
const scountEl = $("scount");
const statusEl = $("status");
const topStatusEl = $("topStatus");
const tabsEl = $("tabs");
const gotoInput = $("gotoInput");
const gotoIndexInput = $("gotoIndexInput");
const gotoIndexMax = $("gotoIndexMax");
const prevBtn = $("prevBtn");
const nextBtn = $("nextBtn");
const goBtn = $("goBtn");
const goIndexBtn = $("goIndexBtn");
const notesEl = $("notes");
const saveBtn = $("saveBtn");
const clearBtn = $("clearBtn");
const caseStatusEl = $("caseStatus");
const flagForReviewEl = $("flagForReview");
const needsProcessingQcEl = $("needsProcessingQc");
const canvas = $("niivueCanvas");
const toolOverlay = $("toolOverlay");
const pdfFrame = $("pdfFrame");
const pdfPagesEl = $("pdfPages");
const emptyState = $("emptyState");
const glEl = $("gl");
const sliceToolNavigateBtn = $("sliceToolNavigate");
const sliceToolZoomBtn = $("sliceToolZoom");
const sliceToolResetBtn = $("sliceToolReset");
const crosshairToggleBtn = $("crosshairToggle");
const overlayControls = $("overlayControls");
const overlayControlsHr = $("overlayControlsHr");
const overlayVisibleEl = $("overlayVisible");
const overlayOpacityEl = $("overlayOpacity");
const overlayOpacityValue = $("overlayOpacityValue");
const displayControls = $("displayControls");
const displayControlsHr = $("displayControlsHr");
const displaySourceEl = $("displaySource");
const displayRangeMinEl = $("displayRangeMin");
const displayRangeMaxEl = $("displayRangeMax");
const displayRangeResetBtn = $("displayRangeReset");
const displayWindowSlider = $("displayWindowSlider");
const displayWindowInput = $("displayWindowInput");
const displayLevelSlider = $("displayLevelSlider");
const displayLevelInput = $("displayLevelInput");
const pdfControls = $("pdfControls");
const pdfControlsHr = $("pdfControlsHr");
const pdfZoomSlider = $("pdfZoomSlider");
const pdfZoomInput = $("pdfZoomInput");
const pdfFitWidthBtn = $("pdfFitWidthBtn");
const pdfActualSizeBtn = $("pdfActualSizeBtn");
const toolOverlayCtx = toolOverlay.getContext("2d");

let subjects = [];
let idx = 0;
let currentId = null;
let currentTab = "t1";
let desiredTab = currentTab;
let loadToken = 0;
let nv = null;
let viewerInitError = null;
let currentSliceTool = SLICE_TOOL.NAVIGATE;
let crosshairVisible = true;
let zoomDrag = null;
let overlayDisplayStateByTab = {
  t1_overlay: { visible: true, opacity: 1 },
  flair_overlay: { visible: true, opacity: 1 },
};
let loadedDisplaySources = [];
let selectedDisplaySourceId = "";
let pdfZoom = 1;
let notesMap = readJsonLocalStorage(NOTES_LS_KEY);
let reviewMap = normalizeReviewMap(readJsonLocalStorage(REVIEW_LS_KEY));
let sliceZoomState = {
  subjectId: null,
  byTab: createEmptySliceZoomByTab(),
};

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("isError", isError);
}

function setTopStatus(message, isError = false) {
  topStatusEl.textContent = message;
  topStatusEl.classList.toggle("isError", isError);
}

function readJsonLocalStorage(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeJsonLocalStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function defaultReviewState() {
  return { notes: "", case_status: "", flag_for_review: false, needs_processing_qc: false };
}

function normalizeReview(value) {
  const review = defaultReviewState();
  if (!value || typeof value !== "object") return review;
  const caseStatus = String(value.case_status ?? "").trim();
  review.notes = String(value.notes ?? "");
  review.case_status = CASE_STATUS_VALUES.has(caseStatus) ? caseStatus : "";
  review.flag_for_review = parseBool(value.flag_for_review);
  review.needs_processing_qc = parseBool(value.needs_processing_qc);
  return review;
}

function normalizeReviewMap(map) {
  const normalized = {};
  for (const [subjectId, review] of Object.entries(map || {})) {
    normalized[subjectId] = normalizeReview(review);
  }
  return normalized;
}

function parseBool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return ["true", "1", "yes", "y"].includes(String(value ?? "").trim().toLowerCase());
}

function isVectorLike(value) {
  return Array.isArray(value) || ArrayBuffer.isView(value);
}

function createEmptySliceZoomByTab() {
  const byTab = {};
  for (const tab of TABS) {
    byTab[tab.key] = {
      [ORIENTATION.AXIAL]: null,
      [ORIENTATION.CORONAL]: null,
      [ORIENTATION.SAGITTAL]: null,
    };
  }
  return byTab;
}

function defaultPanState() {
  return [0, 0, 0, 1];
}

function normalizePanState(pan) {
  if (!isVectorLike(pan)) return defaultPanState();
  const out = defaultPanState();
  for (let i = 0; i < 4; i += 1) {
    const value = Number(pan[i]);
    if (Number.isFinite(value)) out[i] = value;
  }
  if (!(out[3] > 0)) out[3] = 1;
  return out;
}

function isDefaultPanState(pan) {
  const normalized = normalizePanState(pan);
  return normalized[0] === 0 && normalized[1] === 0 && normalized[2] === 0 && normalized[3] === 1;
}

function isOrthogonalOrientation(value) {
  return ORTHOGONAL_ORIENTATIONS.includes(value);
}

function resetSliceZoomState(subjectId) {
  sliceZoomState = { subjectId, byTab: createEmptySliceZoomByTab() };
  zoomDrag = null;
  redrawToolOverlay();
}

function getStoredSlicePan(tab, orientation) {
  return normalizePanState(sliceZoomState.byTab[tab]?.[orientation]);
}

function setStoredSlicePan(tab, orientation, pan) {
  if (!sliceZoomState.byTab[tab]) return;
  const normalized = normalizePanState(pan);
  sliceZoomState.byTab[tab][orientation] = isDefaultPanState(normalized) ? null : Array.from(normalized);
}

function clearStoredSlicePan(tab, orientation) {
  if (sliceZoomState.byTab[tab]) sliceZoomState.byTab[tab][orientation] = null;
}

function normalizePaneBounds(leftTopWidthHeight) {
  let [x, y, w, h] = leftTopWidthHeight;
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  return { x, y, w, h };
}

function syncToolOverlayCanvasSize() {
  const width = canvas.width || Math.max(1, canvas.clientWidth);
  const height = canvas.height || Math.max(1, canvas.clientHeight);
  if (toolOverlay.width !== width) toolOverlay.width = width;
  if (toolOverlay.height !== height) toolOverlay.height = height;
}

function clearToolOverlay() {
  syncToolOverlayCanvasSize();
  toolOverlayCtx.clearRect(0, 0, toolOverlay.width, toolOverlay.height);
}

function redrawToolOverlay() {
  clearToolOverlay();
  if (currentSliceTool !== SLICE_TOOL.ZOOM || !zoomDrag) return;

  const bounds = zoomDrag.pane.bounds;
  const x0 = Math.min(zoomDrag.start[0], zoomDrag.end[0]);
  const y0 = Math.min(zoomDrag.start[1], zoomDrag.end[1]);
  const x1 = Math.max(zoomDrag.start[0], zoomDrag.end[0]);
  const y1 = Math.max(zoomDrag.start[1], zoomDrag.end[1]);

  toolOverlayCtx.save();
  toolOverlayCtx.strokeStyle = "rgba(109, 181, 255, 0.95)";
  toolOverlayCtx.fillStyle = "rgba(109, 181, 255, 0.16)";
  toolOverlayCtx.lineWidth = Math.max(1.5, toolOverlay.width / 700);
  toolOverlayCtx.setLineDash([9, 6]);
  toolOverlayCtx.beginPath();
  toolOverlayCtx.rect(bounds.x, bounds.y, bounds.w, bounds.h);
  toolOverlayCtx.clip();
  toolOverlayCtx.fillRect(x0, y0, x1 - x0, y1 - y0);
  toolOverlayCtx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  toolOverlayCtx.restore();
}

function redrawViewer() {
  try {
    nv?.drawScene?.();
  } catch {
    try {
      nv?.updateGLVolume?.();
    } catch {}
  }
  redrawToolOverlay();
}

function scheduleToolOverlayRedraw() {
  requestAnimationFrame(redrawToolOverlay);
}

function wrapPerPaneDraw2D(viewer) {
  if (!viewer || viewer.__fastreadsJcbWrapped) return viewer;
  const originalDraw2D = viewer.draw2D?.bind(viewer);
  const originalDrawCrossLines = viewer.drawCrossLines?.bind(viewer);
  const originalDrawCrossLinesMM = viewer.drawCrossLinesMM?.bind(viewer);
  const originalDrawCrosshairs3D = viewer.drawCrosshairs3D?.bind(viewer);

  if (originalDraw2D) {
    viewer.draw2D = function draw2D(bounds, sliceType, ...rest) {
      if (!isOrthogonalOrientation(sliceType)) return originalDraw2D(bounds, sliceType, ...rest);
      const previousPan = normalizePanState(this.scene.pan2Dxyzmm);
      this.scene.pan2Dxyzmm = getStoredSlicePan(currentTab, sliceType);
      try {
        return originalDraw2D(bounds, sliceType, ...rest);
      } finally {
        this.scene.pan2Dxyzmm = previousPan;
      }
    };
  }

  if (originalDrawCrossLines) {
    viewer.drawCrossLines = function drawCrossLines(...args) {
      if (!crosshairVisible) return undefined;
      return originalDrawCrossLines(...args);
    };
  }

  if (originalDrawCrossLinesMM) {
    viewer.drawCrossLinesMM = function drawCrossLinesMM(...args) {
      if (!crosshairVisible) return undefined;
      return originalDrawCrossLinesMM(...args);
    };
  }

  if (originalDrawCrosshairs3D) {
    viewer.drawCrosshairs3D = function drawCrosshairs3D(...args) {
      if (!crosshairVisible) return undefined;
      return originalDrawCrosshairs3D(...args);
    };
  }

  viewer.__fastreadsJcbWrapped = true;
  return viewer;
}

async function createNiivueInstance() {
  const viewer = new Niivue({
    isColorbar: false,
    backColor: [0, 0, 0, 1],
    dragAndDropEnabled: false,
    show3Dcrosshair: crosshairVisible,
  });
  await viewer.attachToCanvas(canvas);
  viewer.useDicomLoader({ loader: dicomLoader });
  return wrapPerPaneDraw2D(viewer);
}

function removeAllVolumes() {
  if (!nv) return;
  try {
    if (typeof nv.removeAllVolumes === "function") {
      nv.removeAllVolumes();
      return;
    }
    if (typeof nv.removeVolume === "function" && Array.isArray(nv.volumes)) {
      for (let i = nv.volumes.length - 1; i >= 0; i -= 1) nv.removeVolume(i);
      return;
    }
    if (Array.isArray(nv.volumes)) nv.volumes.length = 0;
  } finally {
    redrawViewer();
  }
}

function setCrosshairVisible(nextVisible) {
  crosshairVisible = Boolean(nextVisible);
  if (nv?.opts) nv.opts.show3Dcrosshair = crosshairVisible;
  crosshairToggleBtn.classList.toggle("isActive", crosshairVisible);
  crosshairToggleBtn.setAttribute("aria-pressed", String(crosshairVisible));
  redrawViewer();
}

function setVolumeOpacity(index, opacity) {
  if (!nv || index < 0 || !Array.isArray(nv.volumes) || index >= nv.volumes.length) return;
  const value = Math.max(0, Math.min(1, Number(opacity)));
  try {
    nv.setOpacity(index, value);
  } catch {
    try {
      nv.volumes[index].opacity = value;
    } catch {}
  }
  redrawViewer();
}

function finiteNumber(value) {
  if (typeof value === "string" && value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validRange(min, max) {
  return Number.isFinite(min) && Number.isFinite(max) && max > min;
}

function normalizedRange(min, max) {
  const nextMin = finiteNumber(min);
  const nextMax = finiteNumber(max);
  if (nextMin === null || nextMax === null) return null;
  return validRange(nextMin, nextMax)
    ? { min: nextMin, max: nextMax }
    : { min: nextMax, max: nextMin };
}

function imageDefaultRange(image) {
  const candidates = [
    [image?.cal_min, image?.cal_max],
    [image?.robust_min, image?.robust_max],
    [image?.global_min, image?.global_max],
  ];

  for (const [min, max] of candidates) {
    const range = normalizedRange(min, max);
    if (range && validRange(range.min, range.max)) return range;
  }

  return null;
}

function displayRangeForSource(source) {
  return source?.range || source?.defaultRange || null;
}

function displayWindowLevelForRange(range) {
  if (!range || !validRange(range.min, range.max)) return null;
  return {
    window: range.max - range.min,
    level: (range.max + range.min) / 2,
  };
}

function rangeFromWindowLevel(windowValue, levelValue) {
  const width = finiteNumber(windowValue);
  const level = finiteNumber(levelValue);
  if (width === null || level === null || !(width > 0)) return null;
  return {
    min: level - width / 2,
    max: level + width / 2,
  };
}

function formatDisplayNumber(value) {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs !== 0 && abs < 0.001) return value.toExponential(3);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 100) return value.toFixed(1);
  if (abs >= 10) return value.toFixed(2);
  return value.toFixed(3);
}

function displaySliderStep(range) {
  if (!range || !validRange(range.min, range.max)) return 1;
  return Math.max((range.max - range.min) / 500, 0.001);
}

function tabSourceLabel(subject, tabKey) {
  const tab = TAB_BY_KEY.get(tabKey);
  const subjectId = subject?.id || "Subject";
  if (tabKey === "t1_overlay") return `${subjectId} T1 overlay`;
  if (tabKey === "flair_overlay") return `${subjectId} FLAIR overlay`;
  return `${subjectId} ${tab?.label || tabKey}`;
}

function makeDisplaySource(subject, tabKey, volumeIndex, image) {
  const defaultRange = imageDefaultRange(image);
  return {
    id: `${tabKey}:${volumeIndex}`,
    label: tabSourceLabel(subject, tabKey),
    volumeIndex,
    image,
    defaultRange,
    range: null,
  };
}

function currentDisplaySource() {
  return loadedDisplaySources.find((source) => source.id === selectedDisplaySourceId) || null;
}

function setLoadedDisplaySources(sources) {
  loadedDisplaySources = Array.isArray(sources) ? sources.filter(Boolean) : [];
  if (!loadedDisplaySources.some((source) => source.id === selectedDisplaySourceId)) {
    selectedDisplaySourceId = loadedDisplaySources[0]?.id || "";
  }
  renderDisplayControls();
}

function setDisplayControlInputsDisabled(disabled) {
  displayRangeMinEl.disabled = disabled;
  displayRangeMaxEl.disabled = disabled;
  displayRangeResetBtn.disabled = disabled;
  displayWindowSlider.disabled = disabled;
  displayWindowInput.disabled = disabled;
  displayLevelSlider.disabled = disabled;
  displayLevelInput.disabled = disabled;
}

function renderDisplayControls() {
  const showControls = isOverlayTab(currentTab) && loadedDisplaySources.length > 0;
  displayControls.hidden = !showControls;
  displayControlsHr.hidden = !showControls;
  displaySourceEl.innerHTML = "";

  if (!showControls) return;

  for (const source of loadedDisplaySources) {
    const option = document.createElement("option");
    option.value = source.id;
    option.textContent = source.label;
    displaySourceEl.appendChild(option);
  }
  displaySourceEl.value = selectedDisplaySourceId;

  const source = currentDisplaySource();
  const range = displayRangeForSource(source);
  const windowLevel = displayWindowLevelForRange(range);
  if (!source || !range || !windowLevel) {
    setDisplayControlInputsDisabled(true);
    displayRangeMinEl.value = "";
    displayRangeMaxEl.value = "";
    displayWindowSlider.value = "";
    displayWindowInput.value = "";
    displayLevelSlider.value = "";
    displayLevelInput.value = "";
    return;
  }

  setDisplayControlInputsDisabled(false);
  const defaultRange = source.defaultRange || range;
  const defaultWidth = Math.max(defaultRange.max - defaultRange.min, displaySliderStep(defaultRange));
  const minBound = defaultRange.min - defaultWidth;
  const maxBound = defaultRange.max + defaultWidth;
  const maxWindow = Math.max(defaultWidth * 3, windowLevel.window);
  const step = displaySliderStep(defaultRange);

  displayRangeMinEl.value = formatDisplayNumber(range.min);
  displayRangeMaxEl.value = formatDisplayNumber(range.max);

  displayWindowSlider.min = String(step);
  displayWindowSlider.max = String(maxWindow);
  displayWindowSlider.step = String(step);
  displayWindowSlider.value = String(windowLevel.window);
  displayWindowInput.value = formatDisplayNumber(windowLevel.window);

  displayLevelSlider.min = String(minBound);
  displayLevelSlider.max = String(maxBound);
  displayLevelSlider.step = String(step);
  displayLevelSlider.value = String(windowLevel.level);
  displayLevelInput.value = formatDisplayNumber(windowLevel.level);
}

function applyDisplayRangeToSource(source) {
  const range = displayRangeForSource(source);
  if (!source || !range || !nv?.volumes?.[source.volumeIndex]) return;
  try {
    nv.volumes[source.volumeIndex].cal_min = range.min;
    nv.volumes[source.volumeIndex].cal_max = range.max;
    nv.updateGLVolume?.();
  } catch {
    redrawViewer();
  }
  redrawViewer();
}

function updateCurrentDisplayRange(range) {
  const source = currentDisplaySource();
  const normalized = normalizedRange(range?.min, range?.max);
  if (!source || !normalized || !validRange(normalized.min, normalized.max)) return;
  source.range = normalized;
  applyDisplayRangeToSource(source);
  renderDisplayControls();
}

function resetCurrentDisplayRange() {
  const source = currentDisplaySource();
  if (!source) return;
  source.range = null;
  applyDisplayRangeToSource(source);
  renderDisplayControls();
}

function applyTransparentOverlayBackground(image) {
  const source = image?.img;
  if (!source || !ArrayBuffer.isView(source)) return image;
  const bytes = source instanceof Uint8Array
    ? source
    : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  if (bytes.length < 4) return image;

  let transparent = 0;
  let opaque = 0;
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    const red = bytes[i];
    const green = bytes[i + 1];
    const blue = bytes[i + 2];
    const maxChannel = Math.max(red, green, blue);
    const minChannel = Math.min(red, green, blue);
    const saturation = maxChannel - minChannel;
    const isColoredOverlay = saturation >= 18 && maxChannel >= 40;
    bytes[i + 3] = isColoredOverlay ? 255 : 0;
    if (isColoredOverlay) opaque += 1;
    else transparent += 1;
  }

  image.__fastreadsJcbTransparentOverlay = { transparent, opaque };
  return image;
}

function setPdfControlsVisible(visible) {
  pdfControls.hidden = !visible;
  pdfControlsHr.hidden = !visible;
}

function setPdfZoom(nextZoom) {
  pdfZoom = Math.max(0.5, Math.min(2.5, Number(nextZoom) || 1));
  pdfZoomSlider.value = String(pdfZoom);
  pdfZoomInput.value = String(Math.round(pdfZoom * 100));
  updatePdfPageSizes();
}

function updatePdfPageSizes() {
  for (const image of pdfPagesEl.querySelectorAll(".pdfPageImage")) {
    const naturalWidth = image.naturalWidth || Number(image.dataset.naturalWidth) || 900;
    image.dataset.naturalWidth = String(naturalWidth);
    image.style.width = `${naturalWidth * pdfZoom}px`;
  }
}

function fitPdfWidth() {
  const firstImage = pdfPagesEl.querySelector(".pdfPageImage");
  if (!firstImage) return;
  const naturalWidth = firstImage.naturalWidth || Number(firstImage.dataset.naturalWidth) || 1;
  const availableWidth = Math.max(120, pdfPagesEl.clientWidth - 48);
  setPdfZoom(availableWidth / naturalWidth);
}

function setSliceTool(nextTool) {
  if (!Object.values(SLICE_TOOL).includes(nextTool)) return;
  currentSliceTool = nextTool;
  zoomDrag = null;

  const isNavigate = nextTool === SLICE_TOOL.NAVIGATE;
  const isZoom = nextTool === SLICE_TOOL.ZOOM;
  const isReset = nextTool === SLICE_TOOL.RESET;

  sliceToolNavigateBtn.classList.toggle("isActive", isNavigate);
  sliceToolZoomBtn.classList.toggle("isActive", isZoom);
  sliceToolResetBtn.classList.toggle("isActive", isReset);
  sliceToolNavigateBtn.setAttribute("aria-pressed", String(isNavigate));
  sliceToolZoomBtn.setAttribute("aria-pressed", String(isZoom));
  sliceToolResetBtn.setAttribute("aria-pressed", String(isReset));
  toolOverlay.style.pointerEvents = isNavigate ? "none" : "auto";
  toolOverlay.style.cursor = isZoom ? "crosshair" : isReset ? "cell" : "default";
  redrawToolOverlay();
}

function getOrthogonalPanes() {
  const panes = [];
  const slices = Array.isArray(nv?.screenSlices) ? nv.screenSlices : [];
  for (let index = 0; index < slices.length; index += 1) {
    const slice = slices[index];
    if (!isOrthogonalOrientation(slice?.axCorSag)) continue;
    panes.push({
      index,
      orientation: slice.axCorSag,
      bounds: normalizePaneBounds(slice.leftTopWidthHeight || [0, 0, 0, 0]),
    });
  }
  return panes;
}

function findPaneAtCanvasPoint(x, y) {
  return getOrthogonalPanes().find((pane) => (
    x >= pane.bounds.x
    && y >= pane.bounds.y
    && x <= pane.bounds.x + pane.bounds.w
    && y <= pane.bounds.y + pane.bounds.h
  )) || null;
}

function eventToCanvasPoint(ev) {
  syncToolOverlayCanvasSize();
  const rect = toolOverlay.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const scaleX = toolOverlay.width / rect.width;
  const scaleY = toolOverlay.height / rect.height;
  return [(ev.clientX - rect.left) * scaleX, (ev.clientY - rect.top) * scaleY];
}

function clampPointToPane(point, pane) {
  return [
    Math.min(Math.max(point[0], pane.bounds.x), pane.bounds.x + pane.bounds.w),
    Math.min(Math.max(point[1], pane.bounds.y), pane.bounds.y + pane.bounds.h),
  ];
}

function canvasPointToMm(point, pane) {
  const mm = nv?.screenXY2mm ? nv.screenXY2mm(point[0], point[1], pane.index) : [NaN, NaN, NaN];
  return isVectorLike(mm) ? Array.from(mm) : [NaN, NaN, NaN];
}

function finishZoomDrag() {
  if (!zoomDrag) return;
  const drag = zoomDrag;
  zoomDrag = null;

  const x0 = Math.min(drag.start[0], drag.end[0]);
  const y0 = Math.min(drag.start[1], drag.end[1]);
  const x1 = Math.max(drag.start[0], drag.end[0]);
  const y1 = Math.max(drag.start[1], drag.end[1]);
  const rectWidth = x1 - x0;
  const rectHeight = y1 - y0;
  if (rectWidth < 8 || rectHeight < 8 || !(drag.pane.bounds.w > 0) || !(drag.pane.bounds.h > 0)) {
    redrawToolOverlay();
    return;
  }

  const factor = Math.min(drag.pane.bounds.w / rectWidth, drag.pane.bounds.h / rectHeight);
  const currentPan = getStoredSlicePan(currentTab, drag.pane.orientation);
  const currentZoom = currentPan[3];
  const newZoom = Math.min(10, Math.max(0.1, currentZoom * factor));

  const paneCenterPoint = [
    drag.pane.bounds.x + drag.pane.bounds.w * 0.5,
    drag.pane.bounds.y + drag.pane.bounds.h * 0.5,
  ];
  const selectionCenterPoint = [x0 + rectWidth * 0.5, y0 + rectHeight * 0.5];
  const paneCenterMm = canvasPointToMm(paneCenterPoint, drag.pane);
  const selectionCenterMm = canvasPointToMm(selectionCenterPoint, drag.pane);
  if (!paneCenterMm.slice(0, 3).every(Number.isFinite) || !selectionCenterMm.slice(0, 3).every(Number.isFinite)) {
    redrawToolOverlay();
    return;
  }

  const centeredPan = [
    currentPan[0] + currentZoom * (paneCenterMm[0] - selectionCenterMm[0]),
    currentPan[1] + currentZoom * (paneCenterMm[1] - selectionCenterMm[1]),
    currentPan[2] + currentZoom * (paneCenterMm[2] - selectionCenterMm[2]),
  ];
  const zoomDelta = currentZoom - newZoom;
  setStoredSlicePan(currentTab, drag.pane.orientation, [
    centeredPan[0] + zoomDelta * selectionCenterMm[0],
    centeredPan[1] + zoomDelta * selectionCenterMm[1],
    centeredPan[2] + zoomDelta * selectionCenterMm[2],
    newZoom,
  ]);
  redrawViewer();
}

function currentSubject() {
  return subjects[idx] || null;
}

function isOverlayTab(tabKey) {
  return tabKey === "t1_overlay" || tabKey === "flair_overlay";
}

function baseTabForOverlay(tabKey) {
  if (tabKey === "t1_overlay") return "t1";
  if (tabKey === "flair_overlay") return "flair";
  return null;
}

function currentOverlayDisplayState() {
  return overlayDisplayStateByTab[currentTab] || { visible: true, opacity: 1 };
}

function firstAvailableTab(subject) {
  return TABS.find((tab) => subject?.available?.[tab.key])?.key || null;
}

function chooseTabForSubject(subject) {
  if (subject?.available?.[desiredTab]) return desiredTab;
  return firstAvailableTab(subject);
}

function renderTabs(subject) {
  tabsEl.innerHTML = "";
  for (const tab of TABS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tabBtn";
    button.textContent = tab.label;
    button.disabled = !subject?.available?.[tab.key];
    button.classList.toggle("isActive", currentTab === tab.key);
    button.addEventListener("click", () => {
      if (button.disabled || currentTab === tab.key) return;
      desiredTab = tab.key;
      loadCurrentSubject();
    });
    tabsEl.appendChild(button);
  }
}

function showDicomCanvas() {
  canvas.style.display = "block";
  toolOverlay.style.display = "block";
  pdfFrame.style.display = "none";
  pdfFrame.removeAttribute("src");
  pdfPagesEl.style.display = "none";
  pdfPagesEl.innerHTML = "";
  setPdfControlsVisible(false);
}

function showPdf(url) {
  glEl.classList.add("isReportView");
  setLoadedDisplaySources([]);
  removeAllVolumes();
  canvas.style.display = "none";
  toolOverlay.style.display = "none";
  pdfPagesEl.style.display = "none";
  pdfPagesEl.innerHTML = "";
  pdfFrame.style.display = "block";
  pdfFrame.src = url;
  setPdfControlsVisible(true);
  setPdfZoom(pdfZoom);
}

async function showReportPages(subject, token) {
  const pagesPayload = await fetchJson(`/api/subjects/${encodeURIComponent(subject.id)}/report-pages`);
  if (token !== loadToken) return false;
  const pages = Array.isArray(pagesPayload.pages) ? pagesPayload.pages : [];
  if (!pages.length) throw new Error("No report pages found.");

  glEl.classList.add("isReportView");
  setLoadedDisplaySources([]);
  removeAllVolumes();
  canvas.style.display = "none";
  toolOverlay.style.display = "none";
  pdfFrame.style.display = "none";
  pdfFrame.removeAttribute("src");
  pdfPagesEl.innerHTML = "";
  pdfPagesEl.style.display = "block";
  setPdfControlsVisible(true);

  const imageLoads = [];
  for (const page of pages) {
    const pageEl = document.createElement("div");
    pageEl.className = "pdfPage";
    const image = document.createElement("img");
    image.className = "pdfPageImage";
    image.alt = page.name || `Report page ${Number(page.index) + 1}`;
    image.addEventListener("load", updatePdfPageSizes, { once: true });
    imageLoads.push(new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    }));
    image.src = page.url;
    pageEl.appendChild(image);
    pdfPagesEl.appendChild(pageEl);
  }

  setPdfZoom(pdfZoom);
  await Promise.all(imageLoads);
  if (token !== loadToken) return false;
  updatePdfPageSizes();
  pdfPagesEl.scrollTo({ top: 0, left: 0 });
  return true;
}

function showEmpty(message, isError = false) {
  glEl.classList.remove("isReportView");
  setLoadedDisplaySources([]);
  removeAllVolumes();
  canvas.style.display = "none";
  toolOverlay.style.display = "none";
  pdfFrame.style.display = "none";
  pdfFrame.removeAttribute("src");
  pdfPagesEl.style.display = "none";
  pdfPagesEl.innerHTML = "";
  setPdfControlsVisible(false);
  emptyState.textContent = message;
  emptyState.style.display = "flex";
  setStatus(message, isError);
}

function hideEmpty() {
  emptyState.style.display = "none";
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || response.statusText);
  return payload;
}

async function loadSeriesImage(subject, tabKey, token) {
  if (!nv) {
    throw new Error(viewerInitError?.message || "DICOM viewer unavailable because WebGL2 could not initialize.");
  }

  const manifestUrl = `/api/subjects/${encodeURIComponent(subject.id)}/series/${encodeURIComponent(tabKey)}/manifest`;
  const manifestResponse = await fetch(manifestUrl);
  if (!manifestResponse.ok) throw new Error(`Manifest unavailable for ${TAB_BY_KEY.get(tabKey).label}.`);
  const manifestText = await manifestResponse.text();
  const fileUrls = manifestText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!fileUrls.length) throw new Error(`No DICOM files listed for ${TAB_BY_KEY.get(tabKey).label}.`);
  if (token !== loadToken) return;

  const dicomData = [];
  const manifestBase = new URL(manifestUrl, window.location.href);
  for (const fileUrl of fileUrls) {
    if (token !== loadToken) return;
    const resolvedUrl = new URL(fileUrl, manifestBase);
    const response = await fetch(resolvedUrl);
    if (!response.ok) throw new Error(`DICOM file unavailable: ${response.statusText}`);
    dicomData.push({
      name: resolvedUrl.searchParams.get("name") || resolvedUrl.pathname.split("/").pop() || "dicom",
      data: await response.arrayBuffer(),
    });
  }

  if (token !== loadToken) return;
  const converted = await dicomLoader(dicomData);
  if (token !== loadToken) return;
  if (!Array.isArray(converted) || converted.length === 0) {
    throw new Error("DICOM conversion produced no volume.");
  }
  if (converted.length > 1) {
    const names = converted.map((image) => image?.name || "unnamed volume").join(", ");
    throw new Error(`DICOM conversion produced multiple volumes (${names}). A deterministic choice is not yet configured.`);
  }

  const image = await NVImage.loadFromUrl({
    url: converted[0].data,
    name: converted[0].name || `${subject.id}-${tabKey}.nii`,
  });
  if (token !== loadToken) return;
  return image;
}

function applyOverlayDisplaySettings() {
  if (!isOverlayTab(currentTab)) return;
  const state = currentOverlayDisplayState();
  const overlayOpacity = state.visible ? state.opacity : 0;
  setVolumeOpacity(0, 1);
  setVolumeOpacity(1, overlayOpacity);
}

async function loadDicomSeries(subject, tabKey, token) {
  if (!nv) {
    throw new Error(viewerInitError?.message || "DICOM viewer unavailable because WebGL2 could not initialize.");
  }

  showDicomCanvas();
  hideEmpty();
  setLoadedDisplaySources([]);
  removeAllVolumes();
  setStatus(`Loading ${TAB_BY_KEY.get(tabKey).label}...`);
  setTopStatus(`Subject ${subject.id} / ${TAB_BY_KEY.get(tabKey).label}`);

  glEl.classList.toggle("isReportView", tabKey === "pdf");

  if (isOverlayTab(tabKey)) {
    const baseKey = baseTabForOverlay(tabKey);
    const baseImage = await loadSeriesImage(subject, baseKey, token);
    if (token !== loadToken) return;
    const overlayImage = await loadSeriesImage(subject, tabKey, token);
    if (token !== loadToken) return;
    applyTransparentOverlayBackground(overlayImage);

    removeAllVolumes();
    nv.addVolume(baseImage);
    nv.addVolume(overlayImage);
    setLoadedDisplaySources([
      makeDisplaySource(subject, baseKey, 0, baseImage),
      makeDisplaySource(subject, tabKey, 1, overlayImage),
    ]);
    applyOverlayDisplaySettings();
    redrawViewer();
    setStatus(`Ready: ${TAB_BY_KEY.get(tabKey).label}.`);
    return;
  }

  const image = await loadSeriesImage(subject, tabKey, token);
  if (token !== loadToken) return;
  removeAllVolumes();
  nv.addVolume(image);
  setLoadedDisplaySources([makeDisplaySource(subject, tabKey, 0, image)]);
  redrawViewer();
  setStatus(`Ready: ${TAB_BY_KEY.get(tabKey).label}.`);
}

async function loadCurrentSubject() {
  const subject = currentSubject();
  const token = ++loadToken;
  if (!subject) {
    showEmpty("No subjects found in data/.", true);
    return;
  }

  const nextTab = chooseTabForSubject(subject);
  if (!nextTab) {
    currentTab = desiredTab;
    renderSubjectShell(subject);
    showEmpty(`Subject ${subject.id} has no available views.`, true);
    return;
  }

  currentTab = nextTab;
  desiredTab = nextTab;
  renderSubjectShell(subject);

  try {
    const tab = TAB_BY_KEY.get(currentTab);
    if (tab.type === "report") {
      setCrosshairVisible(false);
      const reportUrl = `/api/subjects/${encodeURIComponent(subject.id)}/report`;
      const reportResponse = await fetch(reportUrl, { method: "GET" });
      if (reportResponse.ok) {
        showPdf(reportUrl);
        hideEmpty();
        setStatus("Ready: PDF.");
        setTopStatus(`Subject ${subject.id} / PDF`);
        return;
      }
      await showReportPages(subject, token);
      if (token !== loadToken) return;
      hideEmpty();
      setStatus("Ready: PDF.");
      setTopStatus(`Subject ${subject.id} / PDF`);
      return;
    }
    await loadDicomSeries(subject, currentTab, token);
  } catch (error) {
    if (token !== loadToken) return;
    showEmpty(error?.message || "Unable to load this view.", true);
    setTopStatus(`Subject ${subject.id} / ${TAB_BY_KEY.get(currentTab)?.label || currentTab}`, true);
  }
}

function renderSubjectShell(subject) {
  const subjectChanged = currentId !== subject.id;
  currentId = subject.id;
  if (subjectChanged || sliceZoomState.subjectId !== subject.id) resetSliceZoomState(subject.id);
  sidEl.textContent = subject.id;
  sidxEl.textContent = String(idx + 1);
  scountEl.textContent = String(subjects.length);
  gotoIndexMax.textContent = subjects.length ? String(subjects.length) : "?";
  gotoInput.placeholder = subjects[0]?.id ? `e.g., ${subjects[0].id}` : "Enter subject ID";
  gotoIndexInput.placeholder = subjects.length ? `1-${subjects.length}` : "Enter index";
  prevBtn.disabled = idx <= 0;
  nextBtn.disabled = idx >= subjects.length - 1;
  renderTabs(subject);
  renderOverlayControls();
  loadReviewControls(subject.id);
}

function renderOverlayControls() {
  const showControls = isOverlayTab(currentTab);
  const state = currentOverlayDisplayState();
  overlayControls.hidden = !showControls;
  overlayControlsHr.hidden = !showControls;
  overlayVisibleEl.checked = state.visible;
  overlayOpacityEl.value = String(state.opacity);
  overlayOpacityValue.textContent = state.opacity.toFixed(2);
}

function loadReviewControls(subjectId) {
  const review = normalizeReview(reviewMap[subjectId]);
  const localNote = notesMap[subjectId];
  notesEl.value = localNote !== undefined ? String(localNote) : review.notes;
  caseStatusEl.value = review.case_status;
  flagForReviewEl.checked = review.flag_for_review;
  needsProcessingQcEl.checked = review.needs_processing_qc;
}

function saveCurrentReviewToMemory() {
  if (!currentId) return;
  notesMap[currentId] = notesEl.value;
  reviewMap[currentId] = {
    notes: notesEl.value,
    case_status: CASE_STATUS_VALUES.has(caseStatusEl.value) ? caseStatusEl.value : "",
    flag_for_review: flagForReviewEl.checked,
    needs_processing_qc: needsProcessingQcEl.checked,
  };
  writeJsonLocalStorage(NOTES_LS_KEY, notesMap);
  writeJsonLocalStorage(REVIEW_LS_KEY, reviewMap);
}

async function saveReviewsToServer() {
  saveCurrentReviewToMemory();
  const response = await fetch("/api/reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reviews: reviewMap }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || response.statusText);
  setStatus(`Saved ${payload.count} review entr${payload.count === 1 ? "y" : "ies"}.`);
}

function goToIndex(nextIndex) {
  if (!subjects.length) return;
  idx = Math.max(0, Math.min(nextIndex, subjects.length - 1));
  loadCurrentSubject();
}

function goToSubjectId(subjectId) {
  const nextIndex = subjects.findIndex((subject) => subject.id === subjectId);
  if (nextIndex < 0) {
    setStatus(`Subject ID not found: ${subjectId}`, true);
    return;
  }
  goToIndex(nextIndex);
}

function readIndexInput() {
  const text = gotoIndexInput.value.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isInteger(value) ? value : null;
}

async function loadInitialData() {
  try {
    const [subjectPayload, reviewPayload] = await Promise.all([
      fetchJson("/api/subjects"),
      fetchJson("/api/reviews"),
    ]);
    subjects = Array.isArray(subjectPayload.subjects) ? subjectPayload.subjects : [];
    reviewMap = normalizeReviewMap({ ...reviewPayload.reviews, ...reviewMap });
    writeJsonLocalStorage(REVIEW_LS_KEY, reviewMap);
    scountEl.textContent = String(subjects.length);

    if (!subjects.length) {
      showEmpty("No subjects found. Add local data under data/<subject_id>/.", true);
      return;
    }
    idx = 0;
    desiredTab = chooseTabForSubject(subjects[0]) || "t1";
    await loadCurrentSubject();
  } catch (error) {
    showEmpty(error?.message || "Unable to initialize viewer.", true);
  }
}

sliceToolNavigateBtn.addEventListener("click", () => setSliceTool(SLICE_TOOL.NAVIGATE));
sliceToolZoomBtn.addEventListener("click", () => setSliceTool(SLICE_TOOL.ZOOM));
sliceToolResetBtn.addEventListener("click", () => setSliceTool(SLICE_TOOL.RESET));
crosshairToggleBtn.addEventListener("click", () => setCrosshairVisible(!crosshairVisible));

toolOverlay.addEventListener("pointerdown", (ev) => {
  if (currentSliceTool === SLICE_TOOL.NAVIGATE) return;
  const point = eventToCanvasPoint(ev);
  if (!point) return;
  const pane = findPaneAtCanvasPoint(point[0], point[1]);
  if (!pane) return;
  ev.preventDefault();

  if (currentSliceTool === SLICE_TOOL.RESET) {
    clearStoredSlicePan(currentTab, pane.orientation);
    redrawViewer();
    return;
  }

  zoomDrag = {
    pointerId: ev.pointerId,
    pane,
    start: clampPointToPane(point, pane),
    end: clampPointToPane(point, pane),
  };
  toolOverlay.setPointerCapture?.(ev.pointerId);
  redrawToolOverlay();
});

toolOverlay.addEventListener("pointermove", (ev) => {
  if (!zoomDrag || currentSliceTool !== SLICE_TOOL.ZOOM || zoomDrag.pointerId !== ev.pointerId) return;
  const point = eventToCanvasPoint(ev);
  if (!point) return;
  zoomDrag.end = clampPointToPane(point, zoomDrag.pane);
  redrawToolOverlay();
});

toolOverlay.addEventListener("pointerup", (ev) => {
  if (!zoomDrag || zoomDrag.pointerId !== ev.pointerId) return;
  toolOverlay.releasePointerCapture?.(ev.pointerId);
  const point = eventToCanvasPoint(ev);
  if (point) zoomDrag.end = clampPointToPane(point, zoomDrag.pane);
  finishZoomDrag();
});

toolOverlay.addEventListener("pointercancel", (ev) => {
  if (!zoomDrag || zoomDrag.pointerId !== ev.pointerId) return;
  toolOverlay.releasePointerCapture?.(ev.pointerId);
  zoomDrag = null;
  redrawToolOverlay();
});

prevBtn.addEventListener("click", () => goToIndex(idx - 1));
nextBtn.addEventListener("click", () => goToIndex(idx + 1));
goBtn.addEventListener("click", () => goToSubjectId(gotoInput.value.trim()));
goIndexBtn.addEventListener("click", () => {
  const value = readIndexInput();
  if (value === null || value < 1 || value > subjects.length) {
    setStatus(`Enter an index from 1 to ${subjects.length}.`, true);
    return;
  }
  goToIndex(value - 1);
});

gotoInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") goToSubjectId(gotoInput.value.trim());
});

gotoIndexInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") goIndexBtn.click();
});

notesEl.addEventListener("input", () => {
  saveCurrentReviewToMemory();
  setStatus("Review autosaved locally.");
});

caseStatusEl.addEventListener("change", saveCurrentReviewToMemory);
flagForReviewEl.addEventListener("change", saveCurrentReviewToMemory);
needsProcessingQcEl.addEventListener("change", saveCurrentReviewToMemory);

overlayVisibleEl.addEventListener("change", () => {
  const state = currentOverlayDisplayState();
  state.visible = overlayVisibleEl.checked;
  applyOverlayDisplaySettings();
});

overlayOpacityEl.addEventListener("input", () => {
  const state = currentOverlayDisplayState();
  state.opacity = Number(overlayOpacityEl.value);
  overlayOpacityValue.textContent = state.opacity.toFixed(2);
  applyOverlayDisplaySettings();
});

displaySourceEl.addEventListener("change", () => {
  selectedDisplaySourceId = displaySourceEl.value;
  renderDisplayControls();
});

displayRangeMinEl.addEventListener("change", () => {
  updateCurrentDisplayRange({
    min: Number(displayRangeMinEl.value),
    max: Number(displayRangeMaxEl.value),
  });
});

displayRangeMaxEl.addEventListener("change", () => {
  updateCurrentDisplayRange({
    min: Number(displayRangeMinEl.value),
    max: Number(displayRangeMaxEl.value),
  });
});

displayWindowSlider.addEventListener("input", () => {
  const range = rangeFromWindowLevel(displayWindowSlider.value, displayLevelSlider.value || displayLevelInput.value);
  if (range) updateCurrentDisplayRange(range);
});

displayWindowInput.addEventListener("change", () => {
  const range = rangeFromWindowLevel(displayWindowInput.value, displayLevelInput.value || displayLevelSlider.value);
  if (range) updateCurrentDisplayRange(range);
});

displayLevelSlider.addEventListener("input", () => {
  const range = rangeFromWindowLevel(displayWindowSlider.value || displayWindowInput.value, displayLevelSlider.value);
  if (range) updateCurrentDisplayRange(range);
});

displayLevelInput.addEventListener("change", () => {
  const range = rangeFromWindowLevel(displayWindowInput.value || displayWindowSlider.value, displayLevelInput.value);
  if (range) updateCurrentDisplayRange(range);
});

displayRangeResetBtn.addEventListener("click", resetCurrentDisplayRange);

pdfZoomSlider.addEventListener("input", () => setPdfZoom(Number(pdfZoomSlider.value)));

pdfZoomInput.addEventListener("change", () => setPdfZoom(Number(pdfZoomInput.value) / 100));

pdfFitWidthBtn.addEventListener("click", fitPdfWidth);

pdfActualSizeBtn.addEventListener("click", () => setPdfZoom(1));

clearBtn.addEventListener("click", () => {
  if (!currentId) return;
  notesEl.value = "";
  caseStatusEl.value = "";
  flagForReviewEl.checked = false;
  needsProcessingQcEl.checked = false;
  saveCurrentReviewToMemory();
  setStatus(`Cleared local review for ${currentId}.`);
});

saveBtn.addEventListener("click", () => {
  saveReviewsToServer().catch((error) => setStatus(error?.message || "Unable to save reviews.", true));
});

new ResizeObserver(() => {
  try {
    nv?.resizeListener?.();
  } catch {}
  updatePdfPageSizes();
  scheduleToolOverlayRedraw();
}).observe($("gl"));

setSliceTool(SLICE_TOOL.NAVIGATE);
try {
  nv = await createNiivueInstance();
} catch (error) {
  viewerInitError = error;
  canvas.style.display = "none";
  toolOverlay.style.display = "none";
  setTopStatus("DICOM viewer unavailable.", true);
}
await loadInitialData();
