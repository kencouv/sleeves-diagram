// -------------------- Constants --------------------
const PAGE_W = 792;   // landscape letter points
const PAGE_H = 612;

const SLEEVE_LONG = 55;
const SLEEVE_THICK = 14;
const SLEEVE_RADIUS = 7;

// Strings: ~1/5 of sleeve thickness (14/5≈2.8 -> 3)
const STRING_THICKNESS = 3;
const STRING_HIT_WIDTH = 18;

// -------------------- State --------------------
let cfg = makeDefaultCfg();
let selected = null; // {type:'sleeve'|'string', id:'...'}
let stage, layer, ui;

let dragString = null; // manual string drag: {id,startX,startY,x1,y1,x2,y2}
let applyResponsiveScale = null;

// -------------------- Default Config --------------------
function makeDefaultCfg() {
  return {
    header: { ship_name: "M/V ATLANTIC SAKURA", title: "Diagram of Sleeves in Holds" },
    colors: { accent_red: "#CC0000", sleeve_fill: "#E00000", hold_fill: "#BFDDE3", stroke: "#000000" },
    side_labels: { show: true, starboard: "STARBOARD", port: "PORT", forward: "Forward", aft: "Aft" },
    hold_box: { x: 260, y: 160, w: 440, h: 300 },
    holds_list: { x: 190, y_top: 390, line_gap: 18 },
    holds: [{ hold: 1, sleeves: 22.0 }],
    sleeves_abs: [],
    strings_abs: []
  };
}

// -------------------- Helpers --------------------
function uid(prefix) { return prefix + "_" + Math.random().toString(16).slice(2); }
function qs(id) { return document.getElementById(id); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function normOrient(o) { return (o === "V") ? "V" : "H"; }

function safePdfFilename(shipName) {
  return (shipName || "diagram")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

// -------------------- String math --------------------
function stringLength(l) {
  const o = normOrient(l.orientation);
  return o === "V" ? Math.abs((l.y2 ?? 0) - (l.y1 ?? 0)) : Math.abs((l.x2 ?? 0) - (l.x1 ?? 0));
}

function enforceHV(l) {
  l.orientation = normOrient(l.orientation);
  l.x1 = clamp(l.x1, 0, PAGE_W);
  l.y1 = clamp(l.y1, 0, PAGE_H);
  l.x2 = clamp(l.x2, 0, PAGE_W);
  l.y2 = clamp(l.y2, 0, PAGE_H);
  if (l.orientation === "H") l.y2 = l.y1;
  else l.x2 = l.x1;
}

// preserves length when switching H <-> V
function setStringOrientation(l, newO) {
  const oldO = normOrient(l.orientation);
  newO = normOrient(newO);

  let len = stringLength(l);
  if (!isFinite(len) || len < 40) len = 240;

  l.orientation = newO;

  if (newO === "H") {
    l.y2 = l.y1;
    if (oldO === "V") l.x2 = l.x1 + len;
    if (Math.abs(l.x2 - l.x1) < 10) l.x2 = l.x1 + len;

    const length = Math.max(20, Math.abs(l.x2 - l.x1));
    let x1 = clamp(l.x1, 0, PAGE_W);
    let x2 = x1 + length;
    if (x2 > PAGE_W) { x2 = PAGE_W; x1 = clamp(x2 - length, 0, PAGE_W); }
    l.x1 = x1; l.x2 = x2;
    l.y1 = clamp(l.y1, 0, PAGE_H); l.y2 = l.y1;
  } else {
    l.x2 = l.x1;
    if (oldO === "H") l.y2 = l.y1 + len;
    if (Math.abs(l.y2 - l.y1) < 10) l.y2 = l.y1 + len;

    const length = Math.max(20, Math.abs(l.y2 - l.y1));
    let y1 = clamp(l.y1, 0, PAGE_H);
    let y2 = y1 + length;
    if (y2 > PAGE_H) { y2 = PAGE_H; y1 = clamp(y2 - length, 0, PAGE_H); }
    l.y1 = y1; l.y2 = y2;
    l.x1 = clamp(l.x1, 0, PAGE_W); l.x2 = l.x1;
  }
}

// -------------------- UI --------------------
function bindUI() {
  ui = {
    shipName: qs("shipName"),
    titleText: qs("titleText"),

    showLabels: qs("showLabels"),
    lblStarboard: qs("lblStarboard"),
    lblPort: qs("lblPort"),
    lblForward: qs("lblForward"),
    lblAft: qs("lblAft"),

    holdsBody: qs("holdsTable").querySelector("tbody"),
    addHold: qs("addHold"),

    addSleeve: qs("addSleeve"),
    addString: qs("addString"),
    dupSelected: qs("dupSelected"),
    delSelected: qs("delSelected"),
    exportPdf: qs("exportPdf"),

    selNone: qs("selNone"),
    selSleeve: qs("selSleeve"),
    selString: qs("selString"),

    sx: qs("sx"), sy: qs("sy"),
    sOrient: qs("sOrient"),
    applySleeve: qs("applySleeve"),

    lOrient: qs("lOrient"),
    x1: qs("x1"), y1: qs("y1"), x2: qs("x2"), y2: qs("y2"),
    applyString: qs("applyString")
  };

  // header
  ui.shipName.oninput = () => { cfg.header.ship_name = ui.shipName.value; drawAll(); };
  ui.titleText.oninput = () => { cfg.header.title = ui.titleText.value; drawAll(); };

  // labels
  ui.showLabels.onchange = () => { cfg.side_labels.show = ui.showLabels.checked; drawAll(); };
  ui.lblStarboard.oninput = () => { cfg.side_labels.starboard = ui.lblStarboard.value; drawAll(); };
  ui.lblPort.oninput = () => { cfg.side_labels.port = ui.lblPort.value; drawAll(); };
  ui.lblForward.oninput = () => { cfg.side_labels.forward = ui.lblForward.value; drawAll(); };
  ui.lblAft.oninput = () => { cfg.side_labels.aft = ui.lblAft.value; drawAll(); };

  // holds
  ui.addHold.onclick = () => {
    cfg.holds.push({ hold: (cfg.holds.at(-1)?.hold || 0) + 1, sleeves: 0 });
    renderHoldsTable();
    drawAll();
  };

  // add sleeve
  ui.addSleeve.onclick = () => {
    cfg.sleeves_abs.push({
      id: uid("s"),
      x: 360, y: 420,
      orientation: "H",
      fill: cfg.colors.sleeve_fill,
      stroke: cfg.colors.stroke,
      stroke_width: 1
    });
    drawAll();
  };

  // add string
  ui.addString.onclick = () => {
    cfg.strings_abs.push({
      id: uid("l"),
      x1: 240, y1: 480,
      x2: 720, y2: 480,
      orientation: "H",
      stroke_width: STRING_THICKNESS
    });
    drawAll();
  };

  ui.delSelected.onclick = () => deleteSelected();
  ui.dupSelected.onclick = () => duplicateSelected();

  // export PDF in-browser (no backend)
  ui.exportPdf.onclick = () => {
    dragString = null;

    const oldScaleX = stage.scaleX();
    const oldScaleY = stage.scaleY();
    const oldW = stage.width();
    const oldH = stage.height();

    // force 1:1 export
    stage.scale({ x: 1, y: 1 });
    stage.width(PAGE_W);
    stage.height(PAGE_H);
    stage.draw();

    const png = stage.toDataURL({ pixelRatio: 2 });

    // restore view
    stage.scale({ x: oldScaleX, y: oldScaleY });
    stage.width(oldW);
    stage.height(oldH);
    stage.draw();
    if (typeof applyResponsiveScale === "function") applyResponsiveScale();

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
    pdf.addImage(png, "PNG", 0, 0, PAGE_W, PAGE_H);

    const base = safePdfFilename(cfg.header.ship_name);
    pdf.save(`${base} - Sleeves Diagram.pdf`);
  };

  // apply sleeve edits
  ui.applySleeve.onclick = () => {
    if (!selected || selected.type !== "sleeve") return;
    const s = cfg.sleeves_abs.find(x => x.id === selected.id);
    if (!s) return;

    s.orientation = normOrient(ui.sOrient.value || "H");

    const w = (s.orientation === "H") ? SLEEVE_LONG : SLEEVE_THICK;
    const h = (s.orientation === "H") ? SLEEVE_THICK : SLEEVE_LONG;

    s.x = clamp(parseFloat(ui.sx.value || s.x), 0, PAGE_W - w);
    s.y = clamp(parseFloat(ui.sy.value || s.y), 0, PAGE_H - h);

    drawAll();
  };

  // apply string edits
  ui.applyString.onclick = () => {
    if (!selected || selected.type !== "string") return;
    const l = cfg.strings_abs.find(x => x.id === selected.id);
    if (!l) return;

    const oldO = normOrient(l.orientation);

    l.x1 = clamp(parseFloat(ui.x1.value || l.x1), 0, PAGE_W);
    l.y1 = clamp(parseFloat(ui.y1.value || l.y1), 0, PAGE_H);
    l.x2 = clamp(parseFloat(ui.x2.value || l.x2), 0, PAGE_W);
    l.y2 = clamp(parseFloat(ui.y2.value || l.y2), 0, PAGE_H);

    const newO = normOrient(ui.lOrient.value || oldO);

    if (newO !== oldO) {
      l.orientation = oldO;
      enforceHV(l);
      setStringOrientation(l, newO);
    } else {
      l.orientation = newO;
      enforceHV(l);
      if (stringLength(l) < 10) setStringOrientation(l, newO);
    }

    if (!l.stroke_width || l.stroke_width < STRING_THICKNESS) l.stroke_width = STRING_THICKNESS;

    drawAll();
  };

  document.addEventListener("keydown", (e) => {
    if (e.key === "Delete") deleteSelected();
  });
}

function syncUIFromCfg() {
  ui.shipName.value = cfg.header.ship_name || "";
  ui.titleText.value = cfg.header.title || "";

  ui.showLabels.checked = !!cfg.side_labels?.show;
  ui.lblStarboard.value = cfg.side_labels.starboard || "STARBOARD";
  ui.lblPort.value = cfg.side_labels.port || "PORT";
  ui.lblForward.value = cfg.side_labels.forward || "Forward";
  ui.lblAft.value = cfg.side_labels.aft || "Aft";

  renderHoldsTable();
}

function renderHoldsTable() {
  ui.holdsBody.innerHTML = "";
  cfg.holds.forEach((h, idx) => {
    const tr = document.createElement("tr");

    const td1 = document.createElement("td");
    const in1 = document.createElement("input");
    in1.type = "number";
    in1.value = h.hold;
    in1.oninput = () => { h.hold = parseInt(in1.value || "0", 10); drawAll(); };
    td1.appendChild(in1);

    const td2 = document.createElement("td");
    const in2 = document.createElement("input");
    in2.type = "number";
    in2.step = "0.5";
    in2.value = h.sleeves;
    in2.oninput = () => { h.sleeves = parseFloat(in2.value || "0"); drawAll(); };
    td2.appendChild(in2);

    const td3 = document.createElement("td");
    const btn = document.createElement("button");
    btn.textContent = "X";
    btn.className = "smallbtn";
    btn.onclick = () => { cfg.holds.splice(idx, 1); renderHoldsTable(); drawAll(); };
    td3.appendChild(btn);

    tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
    ui.holdsBody.appendChild(tr);
  });
}

// -------------------- Selection --------------------
function setSelected(sel) {
  selected = sel;

  ui.selNone.style.display = selected ? "none" : "block";
  ui.selSleeve.style.display = (selected && selected.type === "sleeve") ? "block" : "none";
  ui.selString.style.display = (selected && selected.type === "string") ? "block" : "none";

  if (selected?.type === "sleeve") {
    const s = cfg.sleeves_abs.find(x => x.id === selected.id);
    if (!s) return;
    ui.sx.value = s.x;
    ui.sy.value = s.y;
    ui.sOrient.value = normOrient(s.orientation);
  }

  if (selected?.type === "string") {
    const l = cfg.strings_abs.find(x => x.id === selected.id);
    if (!l) return;
    ui.lOrient.value = normOrient(l.orientation);
    ui.x1.value = l.x1; ui.y1.value = l.y1; ui.x2.value = l.x2; ui.y2.value = l.y2;
  }
}

function deleteSelected() {
  if (!selected) return;

  if (selected.type === "sleeve") {
    cfg.sleeves_abs = cfg.sleeves_abs.filter(x => x.id !== selected.id);
  } else if (selected.type === "string") {
    cfg.strings_abs = cfg.strings_abs.filter(x => x.id !== selected.id);
  }
  selected = null;
  drawAll();
}

function duplicateSelected() {
  if (!selected) return;

  if (selected.type === "sleeve") {
    const s = cfg.sleeves_abs.find(x => x.id === selected.id);
    if (!s) return;
    const copy = { ...s, id: uid("s"), x: clamp(s.x + 10, 0, PAGE_W - 60), y: clamp(s.y + 10, 0, PAGE_H - 60) };
    cfg.sleeves_abs.push(copy);
    selected = { type: "sleeve", id: copy.id };
  } else if (selected.type === "string") {
    const l = cfg.strings_abs.find(x => x.id === selected.id);
    if (!l) return;

    const copy = { ...l, id: uid("l") };
    copy.x1 = clamp(l.x1 + 10, 0, PAGE_W);
    copy.y1 = clamp(l.y1 + 10, 0, PAGE_H);
    copy.x2 = clamp(l.x2 + 10, 0, PAGE_W);
    copy.y2 = clamp(l.y2 + 10, 0, PAGE_H);
    copy.stroke_width = STRING_THICKNESS;

    enforceHV(copy);
    if (stringLength(copy) < 10) setStringOrientation(copy, copy.orientation);

    cfg.strings_abs.push(copy);
    selected = { type: "string", id: copy.id };
  }
  drawAll();
}

// -------------------- Stage Init --------------------
function initStage() {
  stage = new Konva.Stage({
    container: "stage-container",
    width: PAGE_W,
    height: PAGE_H
  });

  layer = new Konva.Layer();
  stage.add(layer);

  stage.on("click", (e) => {
    if (e.target === stage) {
      setSelected(null);
      drawAll();
    }
  });

  // manual line drag (scale-safe)
  stage.on("mousemove touchmove", () => {
    if (!dragString) return;
    const p = stage.getPointerPosition();
    if (!p) return;

    const sx = stage.scaleX() || 1;
    const sy = stage.scaleY() || 1;

    const cx = p.x / sx;
    const cy = p.y / sy;

    const dx = cx - dragString.startX;
    const dy = cy - dragString.startY;

    const l = cfg.strings_abs.find(x => x.id === dragString.id);
    if (!l) return;

    l.x1 = clamp(dragString.x1 + dx, 0, PAGE_W);
    l.y1 = clamp(dragString.y1 + dy, 0, PAGE_H);
    l.x2 = clamp(dragString.x2 + dx, 0, PAGE_W);
    l.y2 = clamp(dragString.y2 + dy, 0, PAGE_H);

    enforceHV(l);
    if (selected?.type === "string" && selected.id === l.id) setSelected(selected);
    drawAll();
  });

  stage.on("mouseup touchend mouseleave", () => {
    dragString = null;
  });

  // responsive view scaling
  const wrap = document.querySelector(".stage-wrap");
  applyResponsiveScale = () => {
    const maxW = wrap.clientWidth - 40;
    const maxH = wrap.clientHeight - 40;
    const scale = Math.min(maxW / PAGE_W, maxH / PAGE_H, 1.4);

    stage.scale({ x: scale, y: scale });
    stage.width(PAGE_W * scale);
    stage.height(PAGE_H * scale);
    stage.draw();
  };

  window.addEventListener("resize", applyResponsiveScale);
  setTimeout(applyResponsiveScale, 50);
}

// -------------------- Draw --------------------
function drawAll() {
  layer.destroyChildren();

  // background
  layer.add(new Konva.Rect({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, fill: "white" }));

  // header
  layer.add(new Konva.Text({
    x: 0, y: 30, width: PAGE_W,
    text: cfg.header.ship_name || "",
    fontSize: 34, fontFamily: "Arial",
    fill: cfg.colors.stroke, align: "center"
  }));
  layer.add(new Konva.Text({
    x: 0, y: 78, width: PAGE_W,
    text: cfg.header.title || "",
    fontSize: 22, fontFamily: "Arial",
    fill: cfg.colors.accent_red, align: "center"
  }));

  // hold box
  const hb = cfg.hold_box;
  layer.add(new Konva.Rect({
    x: hb.x, y: hb.y, width: hb.w, height: hb.h,
    fill: cfg.colors.hold_fill,
    stroke: cfg.colors.stroke,
    strokeWidth: 1.2
  }));

  // side labels
  if (cfg.side_labels?.show) {
    layer.add(new Konva.Text({
      x: hb.x, y: hb.y - 24, width: hb.w,
      text: cfg.side_labels.starboard,
      fontSize: 14, fontFamily: "Arial",
      fill: cfg.colors.stroke, align: "center"
    }));
    layer.add(new Konva.Text({
      x: hb.x + 10, y: hb.y + hb.h + 8,
      text: cfg.side_labels.port,
      fontSize: 14, fontFamily: "Arial",
      fill: cfg.colors.stroke
    }));

    const forward = new Konva.Text({
      x: hb.x - 40, y: hb.y + hb.h/2 - 40,
      text: cfg.side_labels.forward,
      fontSize: 14, fontFamily: "Arial",
      fill: cfg.colors.stroke
    });
    forward.rotation(-90);
    layer.add(forward);

    const aft = new Konva.Text({
      x: hb.x + hb.w + 40, y: hb.y + hb.h/2 - 40,
      text: cfg.side_labels.aft,
      fontSize: 14, fontFamily: "Arial",
      fill: cfg.colors.stroke
    });
    aft.rotation(90);
    layer.add(aft);
  }

  // holds list (red)
  const hl = cfg.holds_list;
  cfg.holds.forEach((hitem, i) => {
    layer.add(new Konva.Text({
      x: 0,
      y: hl.y_top - i * hl.line_gap,
      width: hl.x,
      text: `Hold ${hitem.hold} – ${hitem.sleeves} Sleeves`,
      fontSize: 11, fontFamily: "Arial",
      fill: cfg.colors.accent_red,
      align: "right"
    }));
  });

  // strings
  cfg.strings_abs.forEach((ln) => {
    ln.orientation = normOrient(ln.orientation);
    if (!ln.stroke_width || ln.stroke_width < STRING_THICKNESS) ln.stroke_width = STRING_THICKNESS;

    enforceHV(ln);
    if (stringLength(ln) < 10) setStringOrientation(ln, ln.orientation);

    const isSel = (selected?.type === "string" && selected.id === ln.id);

    const line = new Konva.Line({
      points: [ln.x1, ln.y1, ln.x2, ln.y2],
      stroke: isSel ? "#0066ff" : cfg.colors.stroke,
      strokeWidth: ln.stroke_width,
      hitStrokeWidth: STRING_HIT_WIDTH
    });

    line.on("mousedown touchstart", (e) => {
      e.cancelBubble = true;
      const p = stage.getPointerPosition();
      if (!p) return;

      const sx = stage.scaleX() || 1;
      const sy = stage.scaleY() || 1;

      dragString = {
        id: ln.id,
        startX: p.x / sx,
        startY: p.y / sy,
        x1: ln.x1, y1: ln.y1, x2: ln.x2, y2: ln.y2
      };
    });

    line.on("click tap", (e) => {
      e.cancelBubble = true;
      setSelected({ type: "string", id: ln.id });
      drawAll();
    });

    const p1 = new Konva.Circle({ x: ln.x1, y: ln.y1, radius: 6, fill: "#fff", stroke: "#000", strokeWidth: 1, draggable: true });
    const p2 = new Konva.Circle({ x: ln.x2, y: ln.y2, radius: 6, fill: "#fff", stroke: "#000", strokeWidth: 1, draggable: true });

    p1.dragBoundFunc((pos) => ({ x: clamp(pos.x, 0, PAGE_W), y: clamp(pos.y, 0, PAGE_H) }));
    p2.dragBoundFunc((pos) => {
      const x = clamp(pos.x, 0, PAGE_W);
      const y = clamp(pos.y, 0, PAGE_H);
      return (ln.orientation === "H") ? { x, y: p1.y() } : { x: p1.x(), y };
    });

    const syncEndpoints = () => {
      ln.x1 = clamp(p1.x(), 0, PAGE_W);
      ln.y1 = clamp(p1.y(), 0, PAGE_H);
      ln.x2 = clamp(p2.x(), 0, PAGE_W);
      ln.y2 = clamp(p2.y(), 0, PAGE_H);

      enforceHV(ln);
      if (stringLength(ln) < 10) setStringOrientation(ln, ln.orientation);

      if (selected?.type === "string" && selected.id === ln.id) setSelected(selected);
      drawAll();
    };

    p1.on("click tap", (e) => { e.cancelBubble = true; setSelected({ type: "string", id: ln.id }); drawAll(); });
    p2.on("click tap", (e) => { e.cancelBubble = true; setSelected({ type: "string", id: ln.id }); drawAll(); });

    p1.on("dragmove", () => {
      if (ln.orientation === "H") p2.y(p1.y());
      else p2.x(p1.x());
      syncEndpoints();
    });
    p2.on("dragmove", syncEndpoints);

    layer.add(line); layer.add(p1); layer.add(p2);
  });

  // sleeves
  cfg.sleeves_abs.forEach((s) => {
    s.orientation = normOrient(s.orientation);

    const w = (s.orientation === "H") ? SLEEVE_LONG : SLEEVE_THICK;
    const h = (s.orientation === "H") ? SLEEVE_THICK : SLEEVE_LONG;

    s.x = clamp(s.x, 0, PAGE_W - w);
    s.y = clamp(s.y, 0, PAGE_H - h);

    const isSel = (selected?.type === "sleeve" && selected.id === s.id);

    const rect = new Konva.Rect({
      x: s.x, y: s.y,
      width: w, height: h,
      cornerRadius: SLEEVE_RADIUS,
      fill: cfg.colors.sleeve_fill,
      stroke: isSel ? "#0066ff" : cfg.colors.stroke,
      strokeWidth: 1,
      draggable: true
    });

    rect.dragBoundFunc((pos) => ({
      x: clamp(pos.x, 0, PAGE_W - w),
      y: clamp(pos.y, 0, PAGE_H - h)
    }));

    rect.on("dragend", () => { s.x = rect.x(); s.y = rect.y(); });

    rect.on("click tap", (e) => {
      e.cancelBubble = true;
      setSelected({ type: "sleeve", id: s.id });
      drawAll();
    });

    layer.add(rect);
  });

  layer.draw();
}

// -------------------- Boot --------------------
function boot() {
  if (!window.Konva) {
    alert("Konva did not load. Check DevTools > Network for a blocked CDN.");
    return;
  }

  bindUI();
  initStage();
  syncUIFromCfg();
  drawAll();
}

boot();
