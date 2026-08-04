import "./styles.css";
import { Niivue, NVImage } from "@niivue/niivue";
import { dicomLoader } from "@niivue/dicom-loader";

const TABS = [
  { key: "t1", label: "T1", type: "dicom" },
  { key: "flair", label: "FLAIR", type: "dicom" },
  { key: "t1_overlay", label: "T1 + Overlay", type: "dicom" },
  { key: "flair_overlay", label: "FLAIR + Overlay", type: "dicom" },
  { key: "pdf", label: "PDF", type: "pdf" },
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
const emptyState = $("emptyState");
const sliceToolNavigateBtn = $("sliceToolNavigate");
const sliceToolZoomBtn = $("sliceToolZoom");
const sliceToolResetBtn = $("sliceToolReset");
const crosshairToggleBtn = $("crosshairToggle");
const toolOverlayCtx = toolOverlay.getContext("2d");

let subjects = [];
let idx = 0;
let currentId = null;
let currentTab = "t1";
let desiredTab = currentTab;
let loadToken = 0;
let nv = null;
let currentSliceTool = SLICE_TOOL.NAVIGATE;
let crosshairVisible = true;
let zoomDrag = null;
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
}

function showPdf(url) {
  removeAllVolumes();
  canvas.style.display = "none";
  toolOverlay.style.display = "none";
  pdfFrame.style.display = "block";
  pdfFrame.src = url;
}

function showEmpty(message, isError = false) {
  removeAllVolumes();
  canvas.style.display = "none";
  toolOverlay.style.display = "none";
  pdfFrame.style.display = "none";
  pdfFrame.removeAttribute("src");
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

async function loadDicomSeries(subject, tabKey, token) {
  showDicomCanvas();
  hideEmpty();
  removeAllVolumes();
  setStatus(`Loading ${TAB_BY_KEY.get(tabKey).label}...`);
  setTopStatus(`Subject ${subject.id} / ${TAB_BY_KEY.get(tabKey).label}`);

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

  removeAllVolumes();
  nv.addVolume(image);
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
    if (tab.type === "pdf") {
      showPdf(`/api/subjects/${encodeURIComponent(subject.id)}/report`);
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
  loadReviewControls(subject.id);
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
  scheduleToolOverlayRedraw();
}).observe($("gl"));

nv = await createNiivueInstance();
setSliceTool(SLICE_TOOL.NAVIGATE);
await loadInitialData();
