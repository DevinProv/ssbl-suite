// =====================
// Constants & State
// =====================
const GRID = 8;
const FONTS = [
    "Rajdhani", "Oswald", "Bebas Neue", "Anton",
    "Barlow Condensed", "Teko", "Russo One",
    "Exo 2", "Orbitron", "Black Han Sans"
];
// Common system fonts — render natively if installed on the editor/OBS machine.
const SYSTEM_FONTS = [
    "Arial", "Helvetica", "Segoe UI", "Tahoma", "Verdana", "Trebuchet MS",
    "Calibri", "Times New Roman", "Georgia", "Cambria", "Garamond",
    "Courier New", "Consolas", "Impact", "Franklin Gothic Medium", "Comic Sans MS"
];
// Built-ins first, then system fonts; users can also type any installed family.
const FONT_OPTIONS = [...FONTS, ...SYSTEM_FONTS];

const SNAP_DIST = 8;   // edge-snap threshold in canvas px

let config = null;
let currentScene = null;
let selectedKey = null;
let scale = 1;
let isDirty = false;

// WebSocket for receiving scene change events from server
let editorWs = null;
function connectEditorWS() {
    editorWs = new WebSocket(`ws://${location.host}/ws/overlay`);
    editorWs.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "scene_change") {
            const newScene = msg.scene;
            if (newScene !== currentScene) {
                handleSceneChange(newScene, msg.data);
            }
        }
    };
    editorWs.onclose = () => setTimeout(connectEditorWS, 2000);
}
connectEditorWS();

function handleSceneChange(newScene, newConfig) {
    if (isDirty) {
        showToast(`⚠ Scene changed to "${newScene}" — unsaved changes lost`, "error");
    }
    currentScene = newScene;
    config = newConfig;
    isDirty = false;
    updateSceneLabel();
    setupCanvas();
    renderElementList();
    renderCanvasElements();
    syncScoreModeUI();
    drawGrid();
}

function markDirty() {
    isDirty = true;
}

function markClean() {
    isDirty = false;
}

function updateSceneLabel() {
    const label = document.getElementById("current-scene-label");
    if (label) {
        label.textContent = currentScene || "No Scene";
    }
}

// =====================
// Init
// =====================
async function init() {
    config = await fetch("/api/overlay/config").then(r => r.json());

    // Get current scene from OBS if connected
    const obsStatus = await fetch("/api/obs/status").then(r => r.json());
    if (obsStatus.connected) {
        const sceneRes = await fetch("/api/obs/current-scene").then(r => r.json()).catch(() => null);
        if (sceneRes && sceneRes.scene) {
            currentScene = sceneRes.scene;
            // Ensure scene exists in config
            if (!config.scenes) config.scenes = {};
            if (!config.scenes[currentScene]) {
                config.scenes[currentScene] = { elements: getDefaultElements() };
            }
            config.active_scene = currentScene;
        }
    } else {
        // Fallback to saved active_scene or first available
        currentScene = config.active_scene || Object.keys(config.scenes || {})[0] || null;
    }

    updateSceneLabel();

    requestAnimationFrame(() => {
        setupCanvas();
        renderElementList();
        renderCanvasElements();
        drawGrid();
    });
    setupOBSPanel();
    setupBgUpload();
    setupSaveReset();
    setupLayoutControls();
    window.addEventListener("resize", () => { setupCanvas(); drawGrid(); });
}

function getCurrentElements() {
    if (!currentScene || !config.scenes || !config.scenes[currentScene]) {
        return {};
    }
    return ensureElementKeys(config.scenes[currentScene].elements);
}

function getDefaultElements() {
    return {
        "event_name": {
            "label": "Event", "type": "text", "visible": true,
            "x": 960, "y": 12, "align": "center",
            "font": "Rajdhani", "fontSize": 22, "fontColor": "#f0f0f2",
            "shadow": true, "shadowColor": "#000000",
            "background": false, "bgColor": "#000000", "bgOpacity": 0.5, "borderRadius": 4,
            "opacity": 1.0
        },
        "round_name": {
            "label": "Round", "type": "text", "visible": true,
            "x": 960, "y": 44, "align": "center",
            "font": "Rajdhani", "fontSize": 28, "fontColor": "#f0f0f2",
            "shadow": true, "shadowColor": "#000000",
            "background": false, "bgColor": "#000000", "bgOpacity": 0.5, "borderRadius": 4,
            "opacity": 1.0
        },
        "p1_score": {
            "label": "P1 Score", "type": "text", "visible": true,
            "x": 926, "y": 84, "align": "right",
            "font": "Rajdhani", "fontSize": 48, "fontColor": "#f0f0f2",
            "shadow": true, "shadowColor": "#000000",
            "background": false, "bgColor": "#000000", "bgOpacity": 0.5, "borderRadius": 4,
            "opacity": 1.0
        },
        "p2_score": {
            "label": "P2 Score", "type": "text", "visible": true,
            "x": 994, "y": 84, "align": "left",
            "font": "Rajdhani", "fontSize": 48, "fontColor": "#f0f0f2",
            "shadow": true, "shadowColor": "#000000",
            "background": false, "bgColor": "#000000", "bgOpacity": 0.5, "borderRadius": 4,
            "opacity": 1.0
        },
        "score_combined": {
            "label": "Score (Combined)", "type": "text", "visible": false,
            "x": 960, "y": 84, "align": "center",
            "font": "Rajdhani", "fontSize": 48, "fontColor": "#f0f0f2",
            "shadow": true, "shadowColor": "#000000",
            "background": false, "bgColor": "#000000", "bgOpacity": 0.5, "borderRadius": 4,
            "opacity": 1.0
        },
        "p1_name": {
            "label": "P1 Name", "type": "text", "visible": true,
            "x": 40, "y": 420, "align": "left",
            "font": "Rajdhani", "fontSize": 36, "fontColor": "#f0f0f2",
            "shadow": true, "shadowColor": "#000000",
            "background": false, "bgColor": "#000000", "bgOpacity": 0.5, "borderRadius": 4,
            "opacity": 1.0
        },
        "p2_name": {
            "label": "P2 Name", "type": "text", "visible": true,
            "x": 1880, "y": 420, "align": "right",
            "font": "Rajdhani", "fontSize": 36, "fontColor": "#f0f0f2",
            "shadow": true, "shadowColor": "#000000",
            "background": false, "bgColor": "#000000", "bgOpacity": 0.5, "borderRadius": 4,
            "opacity": 1.0
        },
        "p1_portrait": {
            "label": "P1 Portrait", "type": "image", "visible": true,
            "x": 30, "y": 460, "width": 200, "height": 200, "opacity": 1.0
        },
        "p2_portrait": {
            "label": "P2 Portrait", "type": "image", "visible": true,
            "x": 1690, "y": 460, "width": 200, "height": 200, "opacity": 1.0
        }
    };
}

// Backfill any newly-added default elements (e.g. combined score) into a scene
// loaded from an older config, without touching existing values.
function ensureElementKeys(elements) {
    if (!elements || elements.score_combined) return elements;  // already migrated
    const defaults = getDefaultElements();
    Object.keys(defaults).forEach(key => {
        if (!elements[key]) elements[key] = defaults[key];
    });
    return elements;
}

// =====================
// Canvas Setup & Scaling
// =====================
function setupCanvas() {
    const editorArea = document.getElementById("editor-area");
    const container = document.getElementById("canvas-container");
    const { width, height } = config.resolution;

    const areaW = editorArea.clientWidth;
    const areaH = editorArea.clientHeight;
    const scaleX = (areaW - 48) / width;
    const scaleY = (areaH - 48) / height;
    scale = Math.min(scaleX, scaleY);

    const renderedW = width * scale;
    const renderedH = height * scale;
    const offsetX = (areaW - renderedW) / 2;
    const offsetY = (areaH - renderedH) / 2;

    container.style.width = width + "px";
    container.style.height = height + "px";
    container.style.transformOrigin = "top left";
    container.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;

    const gridCanvas = document.getElementById("grid-canvas");
    gridCanvas.width = width;
    gridCanvas.height = height;
}

function drawGrid() {
    const canvas = document.getElementById("grid-canvas");
    const ctx = canvas.getContext("2d");
    const { width, height } = config.resolution;
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#4fc3d4";
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= width; x += GRID) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y <= height; y += GRID) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(79,195,212,0.4)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(width/2, 0); ctx.lineTo(width/2, height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, height/2); ctx.lineTo(width, height/2); ctx.stroke();
    ctx.setLineDash([]);
}

function snap(v, freeMove) {
    return freeMove ? v : Math.round(v / GRID) * GRID;
}

// =====================
// Element List (Sidebar)
// =====================
function renderElementList() {
    const list = document.getElementById("element-list");
    list.innerHTML = "";
    const elements = getCurrentElements();
    Object.entries(elements).forEach(([key, el]) => {
        const item = document.createElement("div");
        item.className = `element-item${el.visible ? "" : " hidden-el"}${selectedKey === key ? " selected" : ""}`;
        item.dataset.key = key;
        const icon = el.type === "image" ? "🖼️" : "📝";
        item.innerHTML = `
            <span class="el-icon">${icon}</span>
            <span class="el-name">${el.label}</span>
            <button class="el-vis" title="Toggle visibility">${el.visible ? "👁" : "🙈"}</button>
        `;
        item.addEventListener("click", (e) => {
            if (e.target.classList.contains("el-vis")) return;
            selectElement(key);
        });
        item.querySelector(".el-vis").addEventListener("click", () => toggleVisibility(key));
        list.appendChild(item);
    });
}

// =====================
// Canvas Elements
// =====================
function renderCanvasElements() {
    const root = document.getElementById("canvas-root");
    root.innerHTML = "";
    const elements = getCurrentElements();
    Object.entries(elements).forEach(([key, el]) => {
        const node = createCanvasElement(key, el);
        root.appendChild(node);
    });
}

function createCanvasElement(key, el) {
    const node = document.createElement("div");
    node.className = `canvas-el${selectedKey === key ? " selected" : ""}`;
    node.id = `cel-${key}`;
    node.style.left = el.x + "px";
    node.style.top = el.y + "px";
    node.style.opacity = el.visible ? el.opacity : 0.3;
    node.style.display = "block";

    const label = document.createElement("div");
    label.className = "el-label";
    label.textContent = el.label;
    node.appendChild(label);

    if (el.type === "text") {
        node.classList.add("canvas-text-el");
        applyTextStyles(node, el);
        node.appendChild(document.createTextNode(getPreviewText(key)));
    } else {
        node.classList.add("canvas-image-el");
        node.style.width = el.width + "px";
        node.style.height = el.height + "px";
        const placeholder = document.createElement("div");
        placeholder.className = "img-placeholder";
        placeholder.innerHTML = `<span style="font-size:24px">🖼️</span><span>${el.label}</span>`;
        node.appendChild(placeholder);
    }

    // Corner handle: images resize width/height, text scales font size.
    const resizeHandle = document.createElement("div");
    resizeHandle.className = "resize-handle";
    node.appendChild(resizeHandle);
    resizeHandle.addEventListener("mousedown", (e) => startResize(e, key));

    node.addEventListener("mousedown", (e) => {
        if (e.target.classList.contains("resize-handle")) return;
        startDrag(e, key);
    });
    node.addEventListener("click", () => selectElement(key));
    return node;
}

function applyTextStyles(node, el) {
    node.style.fontFamily = `'${el.font}', sans-serif`;
    node.style.fontSize = el.fontSize + "px";
    node.style.color = el.fontColor;
    // Anchor on x by alignment so the canvas matches the live overlay.
    const align = el.align || "left";
    node.style.transform = align === "center" ? "translateX(-50%)"
        : align === "right" ? "translateX(-100%)" : "none";
    node.style.textAlign = align;
    node.style.textShadow = el.shadow
        ? `2px 2px 4px ${el.shadowColor}, 0 0 8px ${el.shadowColor}`
        : "none";
    if (el.background) {
        const hex = el.bgColor;
        const r = parseInt(hex.slice(1,3),16);
        const g = parseInt(hex.slice(3,5),16);
        const b = parseInt(hex.slice(5,7),16);
        node.style.background = `rgba(${r},${g},${b},${el.bgOpacity})`;
        node.style.borderRadius = el.borderRadius + "px";
        node.style.padding = "4px 10px";
    } else {
        node.style.background = "transparent";
        node.style.padding = "0";
        node.style.borderRadius = "0";
    }
}

function getPreviewText(key) {
    const map = {
        p1_name: "Player 1", p2_name: "Player 2",
        p1_score: "0", p2_score: "0", score_combined: "2 - 1",
        round_name: "Winners Finals", event_name: "SSBL Monthly"
    };
    return map[key] || key;
}

// =====================
// Layout presets & score mode
// =====================
function presetCenteredTop() {
    return getDefaultElements();   // separate scores, centered top row
}

function presetCombinedScore() {
    const e = getDefaultElements();
    e.p1_score.visible = false;
    e.p2_score.visible = false;
    e.score_combined.visible = true;
    return e;
}

function presetLowerThird() {
    const e = getDefaultElements();
    e.event_name.x = 960; e.event_name.y = 16;
    e.round_name.x = 960; e.round_name.y = 46;
    e.p1_portrait.x = 30;   e.p1_portrait.y = 820;
    e.p2_portrait.x = 1690; e.p2_portrait.y = 820;
    e.p1_name.x = 250;  e.p1_name.y = 980; e.p1_name.align = "left";
    e.p2_name.x = 1670; e.p2_name.y = 980; e.p2_name.align = "right";
    e.p1_score.x = 905;  e.p1_score.y = 968; e.p1_score.align = "right";
    e.p2_score.x = 1015; e.p2_score.y = 968; e.p2_score.align = "left";
    e.score_combined.x = 960; e.score_combined.y = 968;
    return e;
}

function presetMinimal() {
    const e = getDefaultElements();
    e.event_name.visible = false;
    e.round_name.visible = false;
    e.p1_portrait.visible = false;
    e.p2_portrait.visible = false;
    e.p1_score.visible = false;
    e.p2_score.visible = false;
    e.score_combined.visible = true;
    e.p1_name.x = 760;  e.p1_name.y = 940; e.p1_name.align = "right";
    e.p2_name.x = 1160; e.p2_name.y = 940; e.p2_name.align = "left";
    e.score_combined.x = 960; e.score_combined.y = 930;
    return e;
}

const PRESETS = {
    centered_top:   { label: "Centered Top",   build: presetCenteredTop },
    combined_score: { label: "Combined Score", build: presetCombinedScore },
    lower_third:    { label: "Lower Third",     build: presetLowerThird },
    minimal:        { label: "Minimal",         build: presetMinimal },
};

function applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset || !currentScene) { showToast("No active scene", "error"); return; }
    if (!confirm(`Apply the "${preset.label}" layout to "${currentScene}"? This replaces the current element positions.`)) return;
    config.scenes[currentScene].elements = preset.build();
    selectedKey = null;
    renderElementList();
    renderCanvasElements();
    syncScoreModeUI();
    document.getElementById("props-title").textContent = "Select an element";
    document.getElementById("props-body").innerHTML = `<div class="no-selection">Click an element on the canvas to edit its properties</div>`;
    markDirty();
    showToast(`Applied "${preset.label}" layout`, "success");
}

function isCombinedMode() {
    const e = getCurrentElements();
    return !!(e.score_combined && e.score_combined.visible);
}

function setScoreMode(combined) {
    const e = getCurrentElements();
    if (!e.score_combined) return;
    e.score_combined.visible = combined;
    if (e.p1_score) e.p1_score.visible = !combined;
    if (e.p2_score) e.p2_score.visible = !combined;
    if (selectedKey && (!e[selectedKey] || !e[selectedKey].visible)) selectedKey = null;
    renderElementList();
    renderCanvasElements();
    syncScoreModeUI();
    markDirty();
}

function syncScoreModeUI() {
    const combined = isCombinedMode();
    const sep  = document.getElementById("score-mode-sep");
    const comb = document.getElementById("score-mode-comb");
    if (sep)  sep.classList.toggle("active", !combined);
    if (comb) comb.classList.toggle("active", combined);
}

function setupLayoutControls() {
    const sel = document.getElementById("preset-select");
    if (sel) {
        sel.innerHTML = Object.entries(PRESETS)
            .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
    }
    const applyBtn = document.getElementById("preset-apply");
    if (applyBtn) applyBtn.addEventListener("click", () => applyPreset(sel.value));
    const sep  = document.getElementById("score-mode-sep");
    const comb = document.getElementById("score-mode-comb");
    if (sep)  sep.addEventListener("click", () => setScoreMode(false));
    if (comb) comb.addEventListener("click", () => setScoreMode(true));
    syncScoreModeUI();
}

// =====================
// Selection
// =====================
function selectElement(key) {
    selectedKey = key;
    document.querySelectorAll(".canvas-el").forEach(n => n.classList.remove("selected"));
    document.querySelectorAll(".element-item").forEach(n => n.classList.remove("selected"));
    const cel = document.getElementById(`cel-${key}`);
    if (cel) cel.classList.add("selected");
    const item = document.querySelector(`.element-item[data-key="${key}"]`);
    if (item) item.classList.add("selected");
    renderPropsPanel(key);
}

// =====================
// Edge snapping ("bump")
// =====================
function elVisualLeft(el, w) {
    // Where the element's left edge actually sits (text honors its align anchor).
    if (el.type === "text") {
        const a = el.align || "left";
        return a === "center" ? el.x - w / 2 : a === "right" ? el.x - w : el.x;
    }
    return el.x;  // images anchor top-left
}

function collectSnapTargets(excludeKey) {
    const { width, height } = config.resolution;
    const xs = [0, width / 2, width];     // canvas left / center / right
    const ys = [0, height / 2, height];   // canvas top / middle / bottom
    Object.entries(getCurrentElements()).forEach(([k, el]) => {
        if (k === excludeKey || !el.visible) return;
        const n = document.getElementById(`cel-${k}`);
        if (!n) return;
        const w = n.offsetWidth, h = n.offsetHeight;
        const left = elVisualLeft(el, w);
        xs.push(left, left + w / 2, left + w);
        ys.push(el.y, el.y + h / 2, el.y + h);
    });
    return { xs, ys };
}

function clearGuides() {
    document.querySelectorAll(".snap-guide").forEach(n => n.remove());
}

function drawGuide(orientation, pos) {
    const root = document.getElementById("canvas-root");
    if (!root) return;
    const { width, height } = config.resolution;
    const t = Math.max(1, 1.5 / scale);   // keep ~1.5px on screen regardless of zoom
    const line = document.createElement("div");
    line.className = "snap-guide";
    line.style.cssText = orientation === "v"
        ? `position:absolute;top:0;left:${pos}px;width:${t}px;height:${height}px;background:#ff3b6b;pointer-events:none;z-index:50;`
        : `position:absolute;left:0;top:${pos}px;height:${t}px;width:${width}px;background:#ff3b6b;pointer-events:none;z-index:50;`;
    root.appendChild(line);
}

// =====================
// Drag
// =====================
function startDrag(e, key) {
    e.preventDefault();
    e.stopPropagation();
    selectElement(key);

    const el = getCurrentElements()[key];
    const node = document.getElementById(`cel-${key}`);
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startX = el.x;
    const startY = el.y;

    // Geometry is fixed while dragging — measure once.
    const w = node.offsetWidth, h = node.offsetHeight;
    const align = el.type === "text" ? (el.align || "left") : "left";
    const leftOff = align === "center" ? -w / 2 : align === "right" ? -w : 0;
    const xOffsets = [leftOff, leftOff + w / 2, leftOff + w];  // left / center / right
    const yOffsets = [0, h / 2, h];                            // top / middle / bottom
    const targets = collectSnapTargets(key);

    node.classList.add("dragging");

    function onMove(e) {
        const freeMove = e.shiftKey;          // hold Shift to disable all snapping
        const dx = (e.clientX - startMouseX) / scale;
        const dy = (e.clientY - startMouseY) / scale;
        let newX = snap(startX + dx, freeMove);
        let newY = snap(startY + dy, freeMove);

        clearGuides();
        if (!freeMove) {
            let bx = null;
            for (const off of xOffsets) for (const t of targets.xs) {
                const d = Math.abs((newX + off) - t);
                if (d <= SNAP_DIST && (bx === null || d < bx.d)) bx = { d, x: t - off, g: t };
            }
            if (bx) { newX = bx.x; drawGuide("v", bx.g); }

            let by = null;
            for (const off of yOffsets) for (const t of targets.ys) {
                const d = Math.abs((newY + off) - t);
                if (d <= SNAP_DIST && (by === null || d < by.d)) by = { d, y: t - off, g: t };
            }
            if (by) { newY = by.y; drawGuide("h", by.g); }
        }

        el.x = newX;
        el.y = newY;
        node.style.left = newX + "px";
        node.style.top = newY + "px";
        node.classList.toggle("snapping", !freeMove);
        updatePosDisplay(newX, newY);
        markDirty();
    }

    function onUp() {
        clearGuides();
        node.classList.remove("dragging", "snapping");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
}

// =====================
// Resize
// =====================
function startResize(e, key) {
    e.preventDefault();
    e.stopPropagation();

    const el = getCurrentElements()[key];
    const node = document.getElementById(`cel-${key}`);
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;

    let onMove;
    if (el.type === "text") {
        // Text has no box — corner drag scales the font size proportionally.
        const startFont = el.fontSize;
        const startH = node.offsetHeight || (startFont * 1.2);
        onMove = (e) => {
            const dy = (e.clientY - startMouseY) / scale;
            const ratio = Math.max(0.1, (startH + dy) / startH);
            el.fontSize = Math.min(400, Math.max(8, Math.round(startFont * ratio)));
            node.style.fontSize = el.fontSize + "px";
            const inp = document.getElementById("prop-font-size");
            if (inp) inp.value = el.fontSize;
            markDirty();
        };
    } else {
        const startW = el.width;
        const startH = el.height;
        onMove = (e) => {
            const freeMove = e.shiftKey;
            const dw = (e.clientX - startMouseX) / scale;
            const dh = (e.clientY - startMouseY) / scale;
            el.width = Math.max(20, snap(startW + dw, freeMove));
            el.height = Math.max(20, snap(startH + dh, freeMove));
            node.style.width = el.width + "px";
            node.style.height = el.height + "px";
            updateSizeInputs(el.width, el.height);
            markDirty();
        };
    }

    function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
}

// =====================
// Visibility Toggle
// =====================
function toggleVisibility(key) {
    const elements = getCurrentElements();
    elements[key].visible = !elements[key].visible;
    const node = document.getElementById(`cel-${key}`);
    if (node) node.style.opacity = elements[key].visible ? elements[key].opacity : 0.3;
    renderElementList();
    if (selectedKey === key) renderPropsPanel(key);
    markDirty();
}

// =====================
// Properties Panel
// =====================
function renderPropsPanel(key) {
    const el = getCurrentElements()[key];
    const header = document.getElementById("props-title");
    const body = document.getElementById("props-body");
    header.textContent = el.label;

    let html = `
        <div class="prop-group">
            <div class="prop-group-title">Position</div>
            <div class="field-row">
                <div style="flex:1">
                    <label class="field-label">X</label>
                    <input type="number" class="prop-input" id="prop-x" value="${el.x}" step="${GRID}">
                </div>
                <div style="flex:1">
                    <label class="field-label">Y</label>
                    <input type="number" class="prop-input" id="prop-y" value="${el.y}" step="${GRID}">
                </div>
            </div>
            <div class="pos-display" id="pos-display">X: ${el.x} Y: ${el.y}</div>
        </div>
        <div class="prop-group">
            <div class="prop-group-title">Visibility</div>
            <div class="prop-toggle">
                <label>Visible</label>
                <label class="toggle-switch">
                    <input type="checkbox" id="prop-visible" ${el.visible ? "checked" : ""}>
                    <span class="toggle-slider"></span>
                </label>
            </div>
            <div>
                <label class="field-label">Opacity</label>
                <div class="field-row">
                    <input type="range" class="prop-range" id="prop-opacity" min="0" max="1" step="0.05" value="${el.opacity}">
                    <span style="font-size:11px;color:var(--on-surface-dim);min-width:32px;text-align:right">${Math.round(el.opacity*100)}%</span>
                </div>
            </div>
        </div>
    `;

    if (el.type === "text") {
        html += `
        <div class="prop-group">
            <div class="prop-group-title">Typography</div>
            <div>
                <label class="field-label">Font</label>
                <input class="prop-input" id="prop-font" list="font-list" value="${el.font}" placeholder="Pick or type any installed font" autocomplete="off">
                <datalist id="font-list">
                    ${FONT_OPTIONS.map(f => `<option value="${f}"></option>`).join("")}
                </datalist>
            </div>
            <div>
                <label class="field-label">Size</label>
                <input type="number" class="prop-input" id="prop-font-size" value="${el.fontSize}" min="8" max="200">
            </div>
            <div>
                <label class="field-label">Color</label>
                <div class="field-row">
                    <input type="color" class="prop-color" id="prop-font-color" value="${el.fontColor}">
                    <input type="text" class="prop-input" id="prop-font-color-hex" value="${el.fontColor}">
                </div>
            </div>
            <div>
                <label class="field-label">Alignment</label>
                <div class="align-seg" id="prop-align">
                    <button type="button" data-align="left"   class="${(el.align||'left')==='left'?'active':''}">Left</button>
                    <button type="button" data-align="center" class="${el.align==='center'?'active':''}">Center</button>
                    <button type="button" data-align="right"  class="${el.align==='right'?'active':''}">Right</button>
                </div>
            </div>
        </div>
        <div class="prop-group">
            <div class="prop-group-title">Shadow</div>
            <div class="prop-toggle">
                <label>Enable Shadow</label>
                <label class="toggle-switch">
                    <input type="checkbox" id="prop-shadow" ${el.shadow?"checked":""}>
                    <span class="toggle-slider"></span>
                </label>
            </div>
            <div id="shadow-color-row" ${!el.shadow?"style='opacity:0.4;pointer-events:none'":""}>
                <label class="field-label">Shadow Color</label>
                <div class="field-row">
                    <input type="color" class="prop-color" id="prop-shadow-color" value="${el.shadowColor}">
                    <input type="text" class="prop-input" id="prop-shadow-color-hex" value="${el.shadowColor}">
                </div>
            </div>
        </div>
        <div class="prop-group">
            <div class="prop-group-title">Background</div>
            <div class="prop-toggle">
                <label>Enable Background</label>
                <label class="toggle-switch">
                    <input type="checkbox" id="prop-bg" ${el.background?"checked":""}>
                    <span class="toggle-slider"></span>
                </label>
            </div>
            <div id="bg-options" ${!el.background?"style='opacity:0.4;pointer-events:none'":""}>
                <div>
                    <label class="field-label">Color</label>
                    <div class="field-row">
                        <input type="color" class="prop-color" id="prop-bg-color" value="${el.bgColor}">
                        <input type="text" class="prop-input" id="prop-bg-color-hex" value="${el.bgColor}">
                    </div>
                </div>
                <div>
                    <label class="field-label">Opacity</label>
                    <div class="field-row">
                        <input type="range" class="prop-range" id="prop-bg-opacity" min="0" max="1" step="0.05" value="${el.bgOpacity}">
                        <span style="font-size:11px;color:var(--on-surface-dim);min-width:32px;text-align:right" id="bg-opacity-label">${Math.round(el.bgOpacity*100)}%</span>
                    </div>
                </div>
                <div>
                    <label class="field-label">Border Radius</label>
                    <input type="number" class="prop-input" id="prop-border-radius" value="${el.borderRadius}" min="0" max="50">
                </div>
            </div>
        </div>`;
    } else {
        html += `
        <div class="prop-group">
            <div class="prop-group-title">Size</div>
            <div class="field-row">
                <div style="flex:1">
                    <label class="field-label">Width</label>
                    <input type="number" class="prop-input" id="prop-width" value="${el.width}" min="20">
                </div>
                <div style="flex:1">
                    <label class="field-label">Height</label>
                    <input type="number" class="prop-input" id="prop-height" value="${el.height}" min="20">
                </div>
            </div>
        </div>`;
    }

    body.innerHTML = html;
    bindPropEvents(key);
}

function updatePosDisplay(x, y) {
    const d = document.getElementById("pos-display");
    if (d) d.textContent = `X: ${x}  Y: ${y}`;
    const px = document.getElementById("prop-x");
    const py = document.getElementById("prop-y");
    if (px) px.value = x;
    if (py) py.value = y;
}

function updateSizeInputs(w, h) {
    const pw = document.getElementById("prop-width");
    const ph = document.getElementById("prop-height");
    if (pw) pw.value = w;
    if (ph) ph.value = h;
}

function bindPropEvents(key) {
    const el = getCurrentElements()[key];
    const node = document.getElementById(`cel-${key}`);

    function bind(id, fn) {
        const input = document.getElementById(id);
        if (input) input.addEventListener("input", (e) => { fn(e); markDirty(); });
    }

    bind("prop-x", e => { el.x = parseInt(e.target.value) || 0; node.style.left = el.x + "px"; updatePosDisplay(el.x, el.y); });
    bind("prop-y", e => { el.y = parseInt(e.target.value) || 0; node.style.top = el.y + "px"; updatePosDisplay(el.x, el.y); });
    bind("prop-visible", e => { el.visible = e.target.checked; node.style.opacity = el.visible ? el.opacity : 0.3; renderElementList(); });
    bind("prop-opacity", e => { el.opacity = parseFloat(e.target.value); node.style.opacity = el.visible ? el.opacity : 0.3; e.target.nextElementSibling.textContent = Math.round(el.opacity*100) + "%"; });

    if (el.type === "text") {
        bind("prop-font", e => { el.font = e.target.value; node.style.fontFamily = `'${el.font}', sans-serif`; });
        bind("prop-font-size", e => { el.fontSize = parseInt(e.target.value) || 16; node.style.fontSize = el.fontSize + "px"; });
        bind("prop-font-color", e => { el.fontColor = e.target.value; node.style.color = el.fontColor; document.getElementById("prop-font-color-hex").value = el.fontColor; });
        bind("prop-font-color-hex", e => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) { el.fontColor = e.target.value; node.style.color = el.fontColor; document.getElementById("prop-font-color").value = el.fontColor; }});
        const alignSeg = document.getElementById("prop-align");
        if (alignSeg) {
            alignSeg.querySelectorAll("button").forEach(btn => {
                btn.addEventListener("click", () => {
                    el.align = btn.dataset.align;
                    alignSeg.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
                    applyTextStyles(node, el);
                    markDirty();
                });
            });
        }
        bind("prop-shadow", e => { el.shadow = e.target.checked; const row = document.getElementById("shadow-color-row"); if (row) { row.style.opacity = el.shadow ? "1" : "0.4"; row.style.pointerEvents = el.shadow ? "" : "none"; } applyTextStyles(node, el); });
        bind("prop-shadow-color", e => { el.shadowColor = e.target.value; document.getElementById("prop-shadow-color-hex").value = el.shadowColor; applyTextStyles(node, el); });
        bind("prop-shadow-color-hex", e => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) { el.shadowColor = e.target.value; document.getElementById("prop-shadow-color").value = el.shadowColor; applyTextStyles(node, el); }});
        bind("prop-bg", e => { el.background = e.target.checked; const opts = document.getElementById("bg-options"); if (opts) { opts.style.opacity = el.background ? "1" : "0.4"; opts.style.pointerEvents = el.background ? "" : "none"; } applyTextStyles(node, el); });
        bind("prop-bg-color", e => { el.bgColor = e.target.value; document.getElementById("prop-bg-color-hex").value = el.bgColor; applyTextStyles(node, el); });
        bind("prop-bg-color-hex", e => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) { el.bgColor = e.target.value; document.getElementById("prop-bg-color").value = el.bgColor; applyTextStyles(node, el); }});
        bind("prop-bg-opacity", e => { el.bgOpacity = parseFloat(e.target.value); document.getElementById("bg-opacity-label").textContent = Math.round(el.bgOpacity*100) + "%"; applyTextStyles(node, el); });
        bind("prop-border-radius", e => { el.borderRadius = parseInt(e.target.value) || 0; applyTextStyles(node, el); });
    } else {
        bind("prop-width", e => { el.width = Math.max(20, parseInt(e.target.value) || 20); node.style.width = el.width + "px"; });
        bind("prop-height", e => { el.height = Math.max(20, parseInt(e.target.value) || 20); node.style.height = el.height + "px"; });
    }
}

// =====================
// OBS Panel
// =====================
function setupOBSPanel() {
    fetch("/api/obs/status").then(r => r.json()).then(res => {
        if (res.connected) {
            fetch("/api/obs/config").then(r => r.json()).then(cfg => {
                document.getElementById("obs-dot").className = "status-dot connected";
                document.getElementById("obs-label").textContent = `${cfg.host}:${cfg.port}`;
                document.getElementById("obs-connect-btn").textContent = "Disconnect";
                startScreenshotPolling();
                fetch("/api/obs/resolution").then(r => r.json()).then(vRes => {
                    if (vRes.width) {
                        config.resolution = { width: vRes.width, height: vRes.height };
                        setupCanvas();
                        drawGrid();
                    }
                }).catch(() => {});
            });
        }
    });

    const connectBtn = document.getElementById("obs-connect-btn");
    const panel = document.getElementById("obs-connect-panel");
    connectBtn.addEventListener("click", () => {
        panel.style.display = panel.style.display === "none" ? "flex" : "none";
    });

    document.getElementById("obs-do-connect").addEventListener("click", async () => {
        const host = document.getElementById("obs-host").value;
        const port = parseInt(document.getElementById("obs-port").value);
        const password = document.getElementById("obs-password").value;
        const res = await fetch("/api/obs/connect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ host, port, password })
        }).then(r => r.json());

        if (res.connected) {
            document.getElementById("obs-dot").className = "status-dot connected";
            document.getElementById("obs-label").textContent = `${host}:${port}`;
            panel.style.display = "none";
            connectBtn.textContent = "Disconnect";
            startScreenshotPolling();
            const vRes = await fetch("/api/obs/resolution").then(r => r.json()).catch(() => null);
            if (vRes) {
                config.resolution = { width: vRes.width, height: vRes.height };
                setupCanvas();
                drawGrid();
            }
            // Load current scene
            const sceneRes = await fetch("/api/obs/current-scene").then(r => r.json()).catch(() => null);
            if (sceneRes && sceneRes.scene) {
                currentScene = sceneRes.scene;
                if (!config.scenes) config.scenes = {};
                if (!config.scenes[currentScene]) {
                    config.scenes[currentScene] = { elements: getDefaultElements() };
                }
                updateSceneLabel();
                renderElementList();
                renderCanvasElements();
            }
            showToast("Connected to OBS", "success");
        } else {
            document.getElementById("obs-dot").className = "status-dot error";
            document.getElementById("obs-label").textContent = "Connection failed";
            showToast("Failed to connect to OBS", "error");
        }
    });
}

let screenshotInterval = null;
function startScreenshotPolling() {
    if (screenshotInterval) clearInterval(screenshotInterval);
    screenshotInterval = setInterval(async () => {
        const res = await fetch("/api/obs/screenshot").then(r => r.json()).catch(() => null);
        if (res && res.image) {
            const bg = document.getElementById("bg-image");
            bg.src = res.image;
            bg.style.display = "block";
        }
    }, 2000);
}

// =====================
// Background Upload
// =====================
function setupBgUpload() {
    document.getElementById("bg-upload").addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const bg = document.getElementById("bg-image");
            bg.src = ev.target.result;
            bg.style.display = "block";
        };
        reader.readAsDataURL(file);
    });
    document.getElementById("bg-clear-btn").addEventListener("click", () => {
        const bg = document.getElementById("bg-image");
        bg.src = "";
        bg.style.display = "none";
    });
}

// =====================
// Save & Reset
// =====================
function setupSaveReset() {
    document.getElementById("save-btn").addEventListener("click", async () => {
        if (!currentScene) {
            showToast("No active scene to save", "error");
            return;
        }
        await fetch(`/api/overlay/scene/${encodeURIComponent(currentScene)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Persist the (OBS-synced) canvas resolution so the live overlay
            // renders in the same coordinate space as the editor.
            body: JSON.stringify({ elements: getCurrentElements(), resolution: config.resolution })
        });
        markClean();
        showToast(`Saved "${currentScene}"`, "success");
    });

    document.getElementById("reset-btn").addEventListener("click", async () => {
        if (!confirm(`Reset "${currentScene}" to defaults? This cannot be undone.`)) return;
        const result = await fetch("/api/overlay/config/reset", { method: "POST" }).then(r => r.json());
        config = result;
        markClean();
        renderElementList();
        renderCanvasElements();
        drawGrid();
        showToast("Reset to defaults", "success");
    });
}

// =====================
// Toast
// =====================
function showToast(msg, type = "") {
    let toast = document.getElementById("toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "toast";
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = `show ${type}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.className = "", 3000);
}

// =====================
// Deselect on canvas click
// =====================
document.getElementById("canvas-root").addEventListener("click", (e) => {
    if (e.target.id === "canvas-root") {
        selectedKey = null;
        document.querySelectorAll(".canvas-el").forEach(n => n.classList.remove("selected"));
        document.querySelectorAll(".element-item").forEach(n => n.classList.remove("selected"));
        document.getElementById("props-title").textContent = "Select an element";
        document.getElementById("props-body").innerHTML = `<div class="no-selection">Click an element on the canvas to edit its properties</div>`;
    }
});

init();