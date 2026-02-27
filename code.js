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

function getThemeFromNoteContainer(noteContainer) {
  if (!noteContainer || noteContainer.type !== "FRAME") return "light";

  const storedTheme = noteContainer.getPluginData("decisionNoteTheme");
  if (storedTheme === "dark" || storedTheme === "light") return storedTheme;

  let header = null;
  for (const child of noteContainer.children) {
    if (child.type === "FRAME" && child.name === "Decision Note Header") {
      header = child;
      break;
    }
  }

  if (!header) {
    for (const child of noteContainer.children) {
      if (child.type !== "FRAME" || child.name !== "Decision Note Entry") continue;
      for (const nested of child.children) {
        if (nested.type === "FRAME" && nested.name === "Decision Note Header") {
          header = nested;
          break;
        }
      }
      if (header) break;
    }
  }

  if (!header || header.fills === figma.mixed || !header.fills || header.fills.length === 0) {
    return "light";
  }

  const fill = header.fills[0];
  if (fill.type !== "SOLID" || !fill.color) return "light";

  const luminance = (0.299 * fill.color.r) + (0.587 * fill.color.g) + (0.114 * fill.color.b);
  return luminance < 0.5 ? "dark" : "light";
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
  const isUpdate = !!preferredContainer;

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
  const isNewContainer = !container;

  if (!container) {
    container = figma.createFrame();
    if (hasTargetNode) {
      container.x = targetNode.x + targetNode.width + 24;
      container.y = targetNode.y;
    } else {
      container.x = figma.viewport.center.x - WIDTH / 2;
      container.y = figma.viewport.center.y;
    }
  }
  container.name = containerName;
  container.setPluginData("decisionNoteTargetId", hasTargetNode ? targetNode.id : "");
  container.setPluginData("decisionNoteMode", hasTargetNode ? "target" : "canvas");
  container.setPluginData("decisionNoteTheme", data.theme === "dark" ? "dark" : "light");

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

  function createEntryGroup() {
    const group = figma.createFrame();
    group.name = "Decision Note Group";
    group.layoutMode = "VERTICAL";
    group.itemSpacing = BODY_GAP;
    group.fills = [];
    group.strokes = [];
    group.effects = [];
    group.counterAxisSizingMode = "FIXED";
    setHugHeight(group);
    unclip(group);
    setFixedWidth(group, BODY_WRAP);
    return group;
  }

  function createDivider() {
    const divider = figma.createLine();
    divider.name = "Decision Note Divider";
    divider.resizeWithoutConstraints(BODY_WRAP, 0);
    divider.strokes = [{ type: "SOLID", color: rgbFromHex(data.theme === "dark" ? "#444444" : "#D6D6D6") }];
    divider.strokeWeight = 1;
    divider.dashPattern = [4, 4];
    divider.effects = [];
    return divider;
  }

  function styleHeader(header) {
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
    setHugHeight(header);
    setFixedWidth(header, WIDTH);

    clearChildren(header);
    addWrappedText(header, "Design Decision", {
      size: 16,
      bold: true,
      wrapWidth: HEADER_WRAP,
      color: palette.ink
    });
  }

  function styleHistory(history) {
    history.name = "Decision Note History";
    history.layoutMode = "VERTICAL";
    history.itemSpacing = 18;

    history.paddingTop = BODY_PAD;
    history.paddingBottom = BODY_PAD;
    history.paddingLeft = BODY_PAD;
    history.paddingRight = BODY_PAD;

    history.primaryAxisAlignItems = "MIN";
    history.counterAxisAlignItems = "MIN";

    history.fills = [{ type: "SOLID", color: rgbFromHex(palette.surface) }];
    history.strokes = [{ type: "SOLID", color: rgbFromHex(palette.ink) }];
    history.strokeAlign = "INSIDE";
    history.strokeWeight = 1;

    history.topLeftRadius = 0;
    history.topRightRadius = 0;
    history.bottomLeftRadius = 8;
    history.bottomRightRadius = 8;

    applyShadow(history);
    unclip(history);

    history.counterAxisSizingMode = "FIXED";
    setHugHeight(history);
    setFixedWidth(history, WIDTH);
  }

  function wrapNodesIntoGroup(nodes) {
    const group = createEntryGroup();
    for (const child of nodes) group.appendChild(child);
    return group;
  }

  let header = null;
  let history = null;
  for (const child of container.children) {
    if (child.type !== "FRAME") continue;
    if (!header && child.name === "Decision Note Header") header = child;
    if (!history && child.name === "Decision Note History") history = child;
  }

  if (!history && header) {
    for (const child of container.children) {
      if (child.type === "FRAME" && child.name === "Decision Note Body") {
        history = child;
        break;
      }
    }
  }

  if (!header || !history) {
    const oldEntries = container.children.filter(function (child) {
      return child.type === "FRAME" && child.name === "Decision Note Entry";
    });

    if (oldEntries.length > 0) {
      const convertedGroups = [];
      for (const oldEntry of oldEntries) {
        let oldBody = null;
        for (const child of oldEntry.children) {
          if (child.type === "FRAME" && child.name === "Decision Note Body") {
            oldBody = child;
            break;
          }
        }
        if (!oldBody || oldBody.children.length === 0) continue;
        convertedGroups.push(wrapNodesIntoGroup(oldBody.children.slice()));
      }

      clearChildren(container);
      header = figma.createFrame();
      history = figma.createFrame();
      styleHeader(header);
      styleHistory(history);
      container.appendChild(header);
      container.appendChild(history);

      convertedGroups.forEach(function (group, idx) {
        history.appendChild(group);
        if (idx < convertedGroups.length - 1) {
          history.appendChild(createDivider());
        }
      });
    }
  }

  if (!header || !history) {
    clearChildren(container);
    header = figma.createFrame();
    history = figma.createFrame();
    styleHeader(header);
    styleHistory(history);
    container.appendChild(header);
    container.appendChild(history);
  } else {
    styleHeader(header);
    styleHistory(history);
  }

  if (history.children.length > 0) {
    const hasGroupedEntries = history.children.some(function (child) {
      return child.name === "Decision Note Group";
    });
    if (!hasGroupedEntries) {
      const legacyNodes = history.children.slice();
      clearChildren(history);
      history.appendChild(wrapNodesIntoGroup(legacyNodes));
    }
  }

  const entry = createEntryGroup();

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
  entry.appendChild(pill);

  addWrappedText(entry, String(data.decision || ""), {
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

  const entryDate = data.date && String(data.date).trim() ? String(data.date).trim() : today();
  const entryDateLabel = isUpdate ? "Updated" : "Created";
  addWrappedText(meta, entryDateLabel + ": " + entryDate, {
    size: 14,
    bold: false,
    wrapWidth: BODY_WRAP,
    color: palette.ink,
    opacity: 0.6
  });

  entry.appendChild(meta);

  const hasExistingHistory = history.children.length > 0;
  if (isUpdate && hasExistingHistory) {
    history.insertChild(0, entry);
    history.insertChild(1, createDivider());
  } else if (isUpdate) {
    history.insertChild(0, entry);
  } else {
    history.appendChild(entry);
  }

  // Final width enforcement only (never touch height)
  setFixedWidth(container, WIDTH);
  setFixedWidth(header, WIDTH);
  setFixedWidth(history, WIDTH);
  setFixedWidth(entry, BODY_WRAP);
  setFixedWidth(header, WIDTH);
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
    const selectedNoteTheme = selectionContext.selectedNoteContainer
      ? getThemeFromNoteContainer(selectionContext.selectedNoteContainer)
      : "light";
    const data = {
      decision: "",
      status: DEFAULT_STATE_ID,
      source: "",
      date: today(),
      theme: selectedNoteTheme
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
