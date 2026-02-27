const DEFAULT_UI_WIDTH = 360;
const UI_MIN_WIDTH = 300;
const UI_MAX_WIDTH = 520;
const UI_MIN_HEIGHT = 180;
const UI_MAX_HEIGHT = 900;
let uiWidth = DEFAULT_UI_WIDTH;

figma.showUI(__html__, { width: uiWidth, height: 420 });

const STORAGE_PREFIX = "decision-note:";
const CANVAS_CONTEXT_ID = "__canvas__";
const STATE_OPTIONS = [
  {
    id: "needs_clarification",
    label: "Needs Clarification",
    pill: { bg: "#FFF3CD", text: "#856404" }
  },
  {
    id: "in_progress",
    label: "In Progress",
    pill: { bg: "#FFD6E0", text: "#9B2C4E" }
  },
  {
    id: "in_review",
    label: "In Review",
    pill: { bg: "#D0E8FF", text: "#1A5276" }
  },
  {
    id: "completed",
    label: "Completed",
    pill: { bg: "#D4EDDA", text: "#276749" }
  }
];
const DEFAULT_STATE_ID = STATE_OPTIONS[0].id;
const STATE_BY_ID = {};
const LEGACY_STATE_LABEL_TO_ID = {};
for (const option of STATE_OPTIONS) {
  STATE_BY_ID[option.id] = option;
  LEGACY_STATE_LABEL_TO_ID[option.label] = option.id;
}
LEGACY_STATE_LABEL_TO_ID["Needs Iteration"] = "in_progress";
LEGACY_STATE_LABEL_TO_ID["Confirmed"] = "completed";
LEGACY_STATE_LABEL_TO_ID["Complete"] = "completed";
LEGACY_STATE_LABEL_TO_ID["In process"] = "in_progress";
LEGACY_STATE_LABEL_TO_ID["In Process"] = "in_progress";
LEGACY_STATE_LABEL_TO_ID["❓ Needs Clarification"] = "needs_clarification";
LEGACY_STATE_LABEL_TO_ID["⏳ In Progress"] = "in_progress";
LEGACY_STATE_LABEL_TO_ID["👀 In Review"] = "in_review";
LEGACY_STATE_LABEL_TO_ID["✅ Completed"] = "completed";
STATE_BY_ID.needs_iteration = STATE_BY_ID.in_progress;
STATE_BY_ID.confirmed = STATE_BY_ID.completed;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function isFrameOrSection(node) {
  return !!node && (node.type === "FRAME" || node.type === "SECTION");
}

function isDecisionNoteContainer(node) {
  if (!node || node.type !== "FRAME") return false;
  const mode = node.getPluginData("decisionNoteMode");
  return mode === "target" || mode === "canvas";
}

function getSelectionContext() {
  const node = figma.currentPage.selection[0];
  if (!isFrameOrSection(node)) {
    return { targetNode: null, selectedNoteContainer: null };
  }

  if (!isDecisionNoteContainer(node)) {
    return { targetNode: node, selectedNoteContainer: null };
  }

  const linkedTargetId = node.getPluginData("decisionNoteTargetId");
  const linkedTarget = linkedTargetId ? figma.getNodeById(linkedTargetId) : null;
  return {
    targetNode: isFrameOrSection(linkedTarget) ? linkedTarget : null,
    selectedNoteContainer: node
  };
}

async function loadData(nodeId) {
  return await figma.clientStorage.getAsync(STORAGE_PREFIX + nodeId);
}

async function saveData(nodeId, data) {
  await figma.clientStorage.setAsync(STORAGE_PREFIX + nodeId, data);
}

function getContextId(selectionContext) {
  if (selectionContext.targetNode) return selectionContext.targetNode.id;
  if (selectionContext.selectedNoteContainer) return selectionContext.selectedNoteContainer.id;
  return CANVAS_CONTEXT_ID;
}

function normalizeStateId(value, fallbackStateId) {
  const normalizedValue = String(value || "").trim();
  if (STATE_BY_ID[normalizedValue]) return normalizedValue;
  if (LEGACY_STATE_LABEL_TO_ID[normalizedValue]) return LEGACY_STATE_LABEL_TO_ID[normalizedValue];
  return STATE_BY_ID[fallbackStateId] ? fallbackStateId : DEFAULT_STATE_ID;
}

function getStateLabel(stateId) {
  const option = STATE_BY_ID[stateId];
  return option ? option.label : STATE_BY_ID[DEFAULT_STATE_ID].label;
}

function normalizeStoredData(data, defaults) {
  const normalized = Object.assign({}, defaults, data || {});
  normalized.decision = String(normalized.decision || "").trim();
  normalized.status = normalizeStateId(normalized.status, defaults.status);
  normalized.source = String(normalized.source || "");
  normalized.date = String(normalized.date || defaults.date);
  normalized.theme = normalized.theme === "dark" ? "dark" : "light";

  // Remove accidental dev placeholder text from older stored payloads.
  if (normalized.decision === "sdfsdfsdf") normalized.decision = "";
  return normalized;
}

function clearChildren(node) {
  while (node.children && node.children.length > 0) node.children[0].remove();
}

function rgbFromHex(hex) {
  const h = hex.replace("#", "").trim();
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255
  };
}

function getNotePalette(theme) {
  const isDark = theme === "dark";
  return {
    surface: isDark ? "#000000" : "#FFFFFF",
    ink: isDark ? "#FFFFFF" : "#000000"
  };
}

function getStatusPill(stateId) {
  const option = STATE_BY_ID[stateId];
  return option ? option.pill : { bg: "#E8E8E8", text: "#444444" };
}

let NOTE_FONT_FAMILY = "Roboto Mono";

async function ensureFonts() {
  try {
    await figma.loadFontAsync({ family: "Roboto Mono", style: "Regular" });
    await figma.loadFontAsync({ family: "Roboto Mono", style: "Bold" });
    NOTE_FONT_FAMILY = "Roboto Mono";
  } catch (e) {
    // fallback (Figma runtime doesn't support `catch {}`)
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    await figma.loadFontAsync({ family: "Inter", style: "Bold" });
    NOTE_FONT_FAMILY = "Inter";
  }
}

function applyShadow(node) {
  node.effects = [
    {
      type: "DROP_SHADOW",
      color: { r: 0, g: 0, b: 0, a: 1 },
      offset: { x: 4, y: 4 },
      radius: 0,
      spread: 0,
      visible: true,
      blendMode: "NORMAL"
    }
  ];
}

function unclip(node) {
  node.clipsContent = false;
}

// Sets the correct “Hug height” mode for a frame depending on layout direction.
function setHugHeight(frame) {
  if (frame.layoutMode === "VERTICAL") {
    frame.primaryAxisSizingMode = "AUTO"; // height hugs
  } else if (frame.layoutMode === "HORIZONTAL") {
    frame.counterAxisSizingMode = "AUTO"; // height hugs
  }
}

// Fix width without touching height
function setFixedWidth(frame, width) {
  frame.resizeWithoutConstraints(width, frame.height);
}

// Wrapped text: fixed width + auto height = “hug height”
function addWrappedText(parent, text, opts) {
  const t = figma.createText();
  t.fontName = { family: NOTE_FONT_FAMILY, style: opts.bold ? "Bold" : "Regular" };
  t.fontSize = opts.size;
  const textPaint = { type: "SOLID", color: rgbFromHex(opts.color || "#000000") };
  if (typeof opts.opacity === "number") textPaint.opacity = opts.opacity;
  t.fills = [textPaint];

  t.textAutoResize = "HEIGHT";

  // IMPORTANT: set characters first, then constrain width
  t.characters = text || "";
  t.resizeWithoutConstraints(opts.wrapWidth, t.height);

  parent.appendChild(t);
  return t;
}

async function createOrUpdateNote(targetNode, data, preferredContainer) {
  await ensureFonts();
  const palette = getNotePalette(data.theme);
  const hasTargetNode = !!targetNode;

  const WIDTH = 302;

  const HEADER_PAD_Y = 14;
  const HEADER_PAD_X = 20;
  const BODY_PAD = 20;

  const BODY_GAP = 16;
  const META_GAP = 8;

  const HEADER_WRAP = WIDTH - HEADER_PAD_X * 2;
  const BODY_WRAP = WIDTH - BODY_PAD * 2;

  const containerName = hasTargetNode ? ("For " + targetNode.name) : "Note";
  let container = preferredContainer || null;
  let isNewContainer = !container;

  if (!container) {
    container = figma.createFrame();
    if (hasTargetNode) {
      container.x = targetNode.x + targetNode.width + 24;
      container.y = targetNode.y;
    } else {
      container.x = figma.viewport.center.x - WIDTH / 2;
      container.y = figma.viewport.center.y;
    }
  } else {
    clearChildren(container);
  }
  container.name = containerName;
  container.setPluginData("decisionNoteTargetId", hasTargetNode ? targetNode.id : "");
  container.setPluginData("decisionNoteMode", hasTargetNode ? "target" : "canvas");

  // --- Container ---
  container.layoutMode = "VERTICAL";
  container.itemSpacing = 0;
  container.fills = [];
  container.strokes = [];
  container.effects = [];
  container.counterAxisSizingMode = "FIXED"; // fixed width
  setHugHeight(container);
  unclip(container);
  setFixedWidth(container, WIDTH);

  // --- Header ---
  const header = figma.createFrame();
  header.name = "Decision Note Header";
  header.layoutMode = "HORIZONTAL";
  header.itemSpacing = 10;

  header.paddingTop = HEADER_PAD_Y;
  header.paddingBottom = HEADER_PAD_Y;
  header.paddingLeft = HEADER_PAD_X;
  header.paddingRight = HEADER_PAD_X;

  header.primaryAxisAlignItems = "CENTER";
  header.counterAxisAlignItems = "CENTER";

  header.fills = [{ type: "SOLID", color: rgbFromHex(palette.surface) }];
  header.strokes = [{ type: "SOLID", color: rgbFromHex(palette.ink) }];
  header.strokeAlign = "INSIDE";
  header.strokeWeight = 1;

  // top/left/right only
  header.strokeTopWeight = 1;
  header.strokeLeftWeight = 1;
  header.strokeRightWeight = 1;
  header.strokeBottomWeight = 0;

  header.topLeftRadius = 8;
  header.topRightRadius = 8;
  header.bottomLeftRadius = 0;
  header.bottomRightRadius = 0;

  applyShadow(header);
  unclip(header);

  header.primaryAxisSizingMode = "FIXED";
  setHugHeight(header); // HORIZONTAL => counterAxis AUTO (hug height)
  setFixedWidth(header, WIDTH);

  addWrappedText(header, "Design Decision", {
    size: 16,
    bold: true,
    wrapWidth: HEADER_WRAP,
    color: palette.ink
  });

  // --- Body ---
  const body = figma.createFrame();
  body.name = "Decision Note Body";
  body.layoutMode = "VERTICAL";
  body.itemSpacing = BODY_GAP;

  body.paddingTop = BODY_PAD;
  body.paddingBottom = BODY_PAD;
  body.paddingLeft = BODY_PAD;
  body.paddingRight = BODY_PAD;

  body.primaryAxisAlignItems = "MIN";
  body.counterAxisAlignItems = "MIN";

  body.fills = [{ type: "SOLID", color: rgbFromHex(palette.surface) }];
  body.strokes = [{ type: "SOLID", color: rgbFromHex(palette.ink) }];
  body.strokeAlign = "INSIDE";
  body.strokeWeight = 1;

  body.topLeftRadius = 0;
  body.topRightRadius = 0;
  body.bottomLeftRadius = 8;
  body.bottomRightRadius = 8;

  applyShadow(body);
  unclip(body);

  body.counterAxisSizingMode = "FIXED";
  setHugHeight(body); // VERTICAL => primary AUTO (hug height)
  setFixedWidth(body, WIDTH);

  // --- Status Pill ---
  const pillColors = getStatusPill(data.status);
  const pill = figma.createFrame();
  pill.name = "Status Pill";
  pill.layoutMode = "HORIZONTAL";
  pill.primaryAxisSizingMode = "AUTO";
  pill.counterAxisSizingMode = "AUTO";
  pill.paddingTop = 6;
  pill.paddingBottom = 6;
  pill.paddingLeft = 14;
  pill.paddingRight = 14;
  pill.cornerRadius = 100;
  pill.fills = [{ type: "SOLID", color: rgbFromHex(pillColors.bg) }];
  pill.strokes = [];
  pill.effects = [];
  unclip(pill);

  const pillText = figma.createText();
  pillText.fontName = { family: NOTE_FONT_FAMILY, style: "Bold" };
  pillText.fontSize = 12;
  pillText.fills = [{ type: "SOLID", color: rgbFromHex(pillColors.text) }];
  pillText.characters = getStateLabel(data.status);
  pill.appendChild(pillText);
  body.appendChild(pill);

  addWrappedText(body, String(data.decision || ""), {
    size: 15,
    bold: false,
    wrapWidth: BODY_WRAP,
    color: palette.ink
  });

  // --- Meta ---
  const meta = figma.createFrame();
  meta.name = "Decision Note Meta";
  meta.layoutMode = "VERTICAL";
  meta.itemSpacing = META_GAP;
  meta.fills = [];
  meta.strokes = [];
  meta.effects = [];
  unclip(meta);

  meta.counterAxisSizingMode = "FIXED";
  setHugHeight(meta);
  setFixedWidth(meta, BODY_WRAP);

  if (data.source && String(data.source).trim()) {
    addWrappedText(meta, "Decision Source: " + data.source, {
      size: 14,
      bold: false,
      wrapWidth: BODY_WRAP,
      color: palette.ink,
      opacity: 0.6
    });
  }

  const createdDate = data.date && String(data.date).trim() ? String(data.date).trim() : today();
  addWrappedText(meta, "Created: " + createdDate, {
    size: 14,
    bold: false,
    wrapWidth: BODY_WRAP,
    color: palette.ink,
    opacity: 0.6
  });

  body.appendChild(meta);
  container.appendChild(header);
  container.appendChild(body);

  // Final width enforcement only (never touch height)
  setFixedWidth(container, WIDTH);
  setFixedWidth(header, WIDTH);
  setFixedWidth(body, WIDTH);
  setFixedWidth(meta, BODY_WRAP);

  if (!hasTargetNode && isNewContainer) {
    container.x = figma.viewport.center.x - WIDTH / 2;
    container.y = figma.viewport.center.y - container.height / 2;
  }
}

// ---------- Messages ----------
figma.ui.onmessage = async function (msg) {
  if (msg.type === "RESIZE_UI") {
    const requestedWidth = Number(msg.width);
    const requestedHeight = Number(msg.height);
    if (!Number.isFinite(requestedHeight)) return;
    if (Number.isFinite(requestedWidth)) {
      uiWidth = Math.max(
        UI_MIN_WIDTH,
        Math.min(UI_MAX_WIDTH, Math.ceil(requestedWidth))
      );
    }
    const nextHeight = Math.max(
      UI_MIN_HEIGHT,
      Math.min(UI_MAX_HEIGHT, Math.ceil(requestedHeight))
    );
    figma.ui.resize(uiWidth, nextHeight);
    return;
  }

  if (msg.type === "INIT") {
    const selectionContext = getSelectionContext();
    const data = {
      decision: "",
      status: DEFAULT_STATE_ID,
      source: "",
      date: today(),
      theme: "light"
    };
    figma.ui.postMessage({
      type: "LOAD",
      data: data,
      stateOptions: STATE_OPTIONS.map(function (option) {
        return { id: option.id, label: option.label };
      }),
      selection: selectionContext.targetNode
        ? { name: selectionContext.targetNode.name }
        : (selectionContext.selectedNoteContainer
          ? { name: selectionContext.selectedNoteContainer.name }
          : null)
    });
    return;
  }

  if (msg.type === "CLOSE") {
    figma.closePlugin();
    return;
  }

  if (msg.type === "SAVE") {
    const selectionContext = getSelectionContext();
    const node = selectionContext.targetNode;
    const selectedNoteContainer = selectionContext.selectedNoteContainer;

    if (!msg.data || !msg.data.decision || !String(msg.data.decision).trim()) {
      figma.notify("Design Decision is required.");
      return;
    }

    try {
      const payload = {
        decision: msg.data.decision,
        status: normalizeStateId(msg.data.status, DEFAULT_STATE_ID),
        source: msg.data.source,
        date: msg.data.date,
        theme: msg.data.theme === "dark" ? "dark" : "light"
      };
      await saveData(getContextId(selectionContext), payload);
      await createOrUpdateNote(node, payload, selectedNoteContainer);
      figma.notify("Decision saved.");
      figma.closePlugin();
    } catch (e) {
      figma.notify("Save failed. Check console.");
      console.log("SAVE ERROR:", e);
    }
  }
};

figma.on("selectionchange", function () {
  figma.ui.postMessage({ type: "REFRESH" });
});
