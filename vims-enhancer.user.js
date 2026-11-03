// ==UserScript==
// @name         VIMS Enhancer
// @namespace    tadey
// @icon         https://vims.moh.go.tz/public/v1770157188524/favicon.ico
// @version      1.0.2
// @description  Hides selected vaccine/product rows and unwanted columns in VIMS tables, adds zebra stripes, and provides a movable settings panel for choosing what to hide.
// @license      MIT
// @author       tadey
//
// @match        https://vims.moh.go.tz/*
// @grant        none
// ==/UserScript==

/*
 * Copyright (c) 2026 tadey
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */

/*
 * VIMS Enhancer
 *
 * Features:
 * - Hides the configured vaccine/product rows (TT, MR-SIAs, IPV-SIAs, ...)
 *   from VIMS tables, including both halves of split tables.
 * - Hides unwanted columns (remarks, damage reasons, other facility, days
 *   without vaccination, coverage percentages) and shortens the long
 *   "Kipimo cha ugavi" header to "doses/vial".
 * - Zebra-stripes the remaining rows for readability.
 * - Adds a movable settings cog with a panel for choosing which rows and
 *   columns to hide and whether rows are striped. Choices are saved in this
 *   browser; the cog position is remembered too.
 * - Keeps split tables aligned and the site's floating table headers sized
 *   to the live table.
 * - Makes the fixed action bar at the bottom transparent by default; the
 *   settings panel can restore the site's default bar.
 * - Re-applies itself after Angular re-renders, window resizes and font load.
 *
 * This script makes no network requests, collects no data and has no
 * external dependencies.
 */

(function () {
  "use strict";

  const blockedItems = [
    "TT",
    "MR-SIAs",
    "IPV-SIAs",
    "RUP_2ml dilution syringe",
    "Watoto waliopata dawa Kinga ya HBIG",
    "ADS_0.3 ml",
    "Janssen/Johnson & Johnson",
    "Sinopharm BBIBP-1",
    "Watoto waliopata dawa kinga ya HBIG baada ya kuzaliwa",
    "Pfizer-BioNTech",
    "Sinopharm BBIBP-2",
    "Diluent for Pfizer-BioNTec",
    // "Rotavac",
    "Moderna",
    "Sinovac-CoronaVac",
    "nOPV2",
    "Droppers for nOPV2",
    "HepB Birth dose ndani ya saa 24 (Ndani ya eneo la huduma)",
    "HepB Birth dose baada ya saa 24 hadi saa 48 (Ndani ya eneo la huduma)",
    "HepB Birth dose baada ya saa 24 hadi saa 48 (Nje ya eneo la huduma)",
    "HepB Birth dose ndani ya saa 24 (Nje ya eneo la huduma)",
  ].map((label) => ({ label, key: label.toLowerCase() }));

  const SETTINGS_KEY = "vims-enhancer:settings:v1";

  function defaultSettings() {
    return {
      rows: Object.create(null),
      columns: Object.create(null),
      stripes: true,
      transparentFooter: true,
    };
  }

  function loadSettings() {
    const result = defaultSettings();
    let raw;
    try {
      raw = localStorage.getItem(SETTINGS_KEY);
    } catch {
      return result;
    }
    if (!raw) return result;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return result;
    }
    if (!parsed || typeof parsed !== "object") return result;
    ["rows", "columns"].forEach((section) => {
      const values = parsed[section];
      if (!values || typeof values !== "object") return;
      Object.keys(values).forEach((key) => {
        if (typeof values[key] === "boolean") {
          result[section][key] = values[key];
        }
      });
    });
    if (typeof parsed.stripes === "boolean") result.stripes = parsed.stripes;
    if (typeof parsed.transparentFooter === "boolean") {
      result.transparentFooter = parsed.transparentFooter;
    }
    return result;
  }

  let settings = loadSettings();

  function saveSettings() {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ version: 1, ...settings }),
      );
    } catch {
      /* ignore unavailable storage */
    }
  }

  function isRowEnabled(key) {
    return settings.rows[key] !== false;
  }

  function isColumnEnabled(key) {
    return settings.columns[key] !== false;
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function isBlockedLabel(label) {
    const low = label.toLowerCase();
    return blockedItems.some(({ key }) => {
      if (!isRowEnabled(key)) return false;
      if (!low.includes(key)) return false;
      // Short codes like "TT" would false-positive on any "tt" substring
      // (e.g. "bottle"). Require a whole-word match for short items.
      if (key.length <= 3) {
        try {
          return new RegExp(`\\b${escapeRegExp(key)}\\b`, "i").test(label);
        } catch {
          return false;
        }
      }
      return true;
    });
  }

  function rowHasInputs(row) {
    return !!row.querySelector("input,select,textarea");
  }

  function isSingleColHeader(row) {
    if (!row.cells || row.cells.length !== 1) return false;
    const colspan = parseInt(row.cells[0].getAttribute("colspan") || "1", 10);
    return colspan > 1;
  }

  function isSectionHeader(row) {
    // Coverage section titles: <th> cells, no inputs (e.g. "3.2 Chanjo ...").
    // Stock category headers are single-cell colspan and handled above.
    if (rowHasInputs(row)) return false;
    return Array.from(row.cells).some((c) => c.tagName === "TH");
  }

  function isHeaderRow(row) {
    return isSingleColHeader(row) || isSectionHeader(row);
  }

  function isHeaderGroup(g) {
    return g.length === 1 && isHeaderRow(g[0]);
  }

  function resetRowStyle(row) {
    row.style.display = "";
    row.style.backgroundColor = "";
    Array.from(row.cells).forEach((c) => {
      c.style.backgroundColor = "";
      c.style.color = "";
    });
  }
  function maxRowspan(row) {
    let m = 1;
    Array.from(row.cells).forEach((c) => {
      const rs = parseInt(c.getAttribute("rowspan") || "1", 10);
      if (rs > m) m = rs;
    });
    return m;
  }

  function getGroups(table) {
    const allRows = Array.from(table.querySelectorAll("tbody > tr"));
    const filtRows = [];
    allRows.forEach((r) => {
      if (!(r.cells && r.cells.length > 0)) return;
      // Skip rows Angular already hid (ng-show). They carry the ng-hide
      // class; counting them would shift stripes and unhiding them via
      // inline display would duplicate category headers.
      if (r.classList && r.classList.contains("ng-hide")) return;
      filtRows.push(r);
    });
    const groups = [];
    let i = 0;

    while (i < filtRows.length) {
      const row = filtRows[i];

      // Category / section headers stand alone. They are never striped and
      // never toggle the zebra counter; a header is hidden only when every
      // data row in its section is hidden (handled in applyFilters).
      if (isSingleColHeader(row) || isSectionHeader(row)) {
        groups.push([row]);
        i += 1;
        continue;
      }

      // DataElement start (coverage tables): a TD row carrying rowspan.
      // Absorb following continuation dose rows (they hold inputs but no
      // new rowspan). Stop at anything else so totals/summaries and the
      // next group stay independent. This deliberately ignores the numeric
      // rowspan value: templates render placeholder <tr></tr> rows and at
      // least one template uses rowspan=len*2+2, so arithmetic on the
      // attribute over-consumes rows and merges unrelated groups.
      if (maxRowspan(row) > 1) {
        const g = [row];
        let j = i + 1;
        while (j < filtRows.length) {
          const nxt = filtRows[j];
          if (isSingleColHeader(nxt) || isSectionHeader(nxt)) break;
          if (maxRowspan(nxt) > 1) break;
          if (!rowHasInputs(nxt)) break;
          g.push(nxt);
          j += 1;
        }
        groups.push(g);
        i = j;
        continue;
      }

      groups.push([row]);
      i += 1;
    }
    return groups;
  }

  function groupLabel(g) {
    let text = "";
    g.forEach((row) => {
      Array.from(row.cells).forEach((c) => {
        if (!c.querySelector("input,select,textarea")) {
          text += " " + c.textContent;
        }
      });
    });
    return text.trim();
  }

  // ---- column visibility ----
  // Matchers run against normalized (lowercased, whitespace-collapsed)
  // header text, so minor punctuation differences (e.g. trailing * or **)
  // don't matter.
  const blockedColumnMatchers = [
    "remarks",
    "kiwango ch", // all monthly-coverage % columns (W1/W2/W3/Td variants)
    "zilizoharibika kabla ya kufunguliwa",
    "sababu ya kuharibika",
    "kituo kingine",
    "siku ambazo chanjo hazikuwepo",
  ];

  const columnLabels = {
    remarks: "Remarks",
    "kiwango ch": "Coverage % columns",
    "zilizoharibika kabla ya kufunguliwa": "Damaged before opening",
    "sababu ya kuharibika": "Reason for damage",
    "kituo kingine": "Other facility",
    "siku ambazo chanjo hazikuwepo": "Days without vaccination",
  };

  function normText(s) {
    return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function thMatchesBlocked(th) {
    const t = normText(th.textContent);
    if (!t) return false;
    return blockedColumnMatchers.some((m) => {
      if (!isColumnEnabled(m)) return false;
      return m === "remarks" ? t === "remarks" : t.includes(m);
    });
  }

  function getTheadRows(table) {
    const thead = table.querySelector("thead");
    if (!thead) return [];
    return Array.from(thead.querySelectorAll("tr")).filter(
      (tr) => tr.cells && tr.cells.length > 0,
    );
  }

  function buildHeaderGrid(theadRows) {
    const grid = [];
    const infos = [];
    theadRows.forEach((tr, r) => {
      if (!grid[r]) grid[r] = [];
      let c = 0;
      Array.from(tr.cells).forEach((cell) => {
        while (grid[r][c]) c += 1;
        const colspan = Math.max(
          1,
          parseInt(cell.getAttribute("colspan") || "1", 10) || 1,
        );
        const rowspan = Math.max(
          1,
          parseInt(cell.getAttribute("rowspan") || "1", 10) || 1,
        );
        infos.push({ el: cell, c0: c, c1: c + colspan });
        for (let rr = r; rr < r + rowspan; rr++) {
          if (!grid[rr]) grid[rr] = [];
          for (let cc = c; cc < c + colspan; cc++) grid[rr][cc] = true;
        }
        c += colspan;
      });
    });
    let colCount = 0;
    infos.forEach((info) => {
      colCount = Math.max(colCount, info.c1);
    });
    return { colCount, infos };
  }

  const NARROW_MATCH = "kipimo cha ugavi";
  const NARROW_WIDTH = "96px";

  function applyColumnVisibility(info) {
    const theadRows = getTheadRows(info.table);
    if (theadRows.length === 0) return;
    const singleRow = theadRows.length === 1;

    // Hidden logical columns + narrow column index (single-row heads only).
    const hiddenCols = new Set();
    let colCount = 0;
    let narrowIdx = -1;
    if (singleRow) {
      const ths = Array.from(theadRows[0].cells);
      colCount = ths.length;
      ths.forEach((th, i) => {
        if (thMatchesBlocked(th)) hiddenCols.add(i);
        if (
          normText(th.textContent).includes(NARROW_MATCH) ||
          th.dataset.vmsShort === "1"
        )
          narrowIdx = i;
      });
      ths.forEach((th, i) => {
        th.style.display = hiddenCols.has(i) ? "none" : "";
        th.style.verticalAlign = "top";
      });
      if (narrowIdx >= 0 && ths[narrowIdx].style.display !== "none") {
        const th = ths[narrowIdx];
        if (th.dataset.vmsShort !== "1") {
          th.title = th.textContent.trim();
          th.textContent = "doses/vial";
          th.dataset.vmsShort = "1";
        }
        th.style.width = NARROW_WIDTH;
        th.style.minWidth = NARROW_WIDTH;
        th.style.textAlign = "center";
        // Wrapped header text otherwise sits at the cell bottom.
        th.style.verticalAlign = "top";
      }
    } else {
      const grid = buildHeaderGrid(theadRows);
      colCount = grid.colCount;
      grid.infos.forEach((h) => {
        if (thMatchesBlocked(h.el)) {
          for (let c = h.c0; c < h.c1; c++) hiddenCols.add(c);
        }
      });
      grid.infos.forEach((h) => {
        let allHidden = h.c1 > h.c0;
        for (let c = h.c0; c < h.c1; c++) {
          if (!hiddenCols.has(c)) {
            allHidden = false;
            break;
          }
        }
        h.el.style.display = allHidden ? "none" : "";
        h.el.style.verticalAlign = "top";
      });
    }

    // Body rows. Single-cell category headers span whole sections and stay
    // visible; multi-cell section title rows in multi-head (coverage) tables
    // mirror the thead layout, so their coverage corner cells (e.g. the W1
    // variant) and blank corner cells (3.3 row) are hidden as orphans too.
    // Multi-row heads only ever block the last logical column (coverage %),
    // which is also the last cell of every data row regardless of rowspan
    // shifting, so data rows hide per-row last cells instead of trusting
    // indexes.
    const hideLastCol =
      !singleRow && colCount > 0 && hiddenCols.has(colCount - 1);
    info.groups.forEach((g, gIdx) => {
      if (info.headerFlags[gIdx]) {
        if (!singleRow) {
          g.forEach((row) => {
            if (row.cells.length <= 1) return;
            const cells = Array.from(row.cells);
            cells.forEach((cell, i) => {
              if (thMatchesBlocked(cell)) {
                cell.style.display = "none";
              } else if (
                hideLastCol &&
                normText(cell.textContent) === "" &&
                i === cells.length - 1
              ) {
                cell.style.display = "none";
              } else if (cell.style.display === "none") {
                cell.style.display = "";
              }
            });
          });
        }
        return;
      }
      g.forEach((row) => {
        const cells = Array.from(row.cells);
        if (singleRow) {
          cells.forEach((cell, i) => {
            if (hiddenCols.has(i)) {
              cell.style.display = "none";
            } else {
              if (cell.style.display === "none") cell.style.display = "";
              if (i === narrowIdx) {
                cell.style.width = NARROW_WIDTH;
                cell.style.minWidth = NARROW_WIDTH;
                cell.style.textAlign = "center";
              }
            }
          });
        } else if (cells.length > 0) {
          const lastCell = cells[cells.length - 1];
          if (hideLastCol) {
            lastCell.style.display = "none";
          } else if (lastCell.style.display === "none") {
            lastCell.style.display = "";
          }
        }
      });
    });
  }

  function tableHasLayout(table) {
    try {
      return table.getClientRects().length > 0;
    } catch {
      return false;
    }
  }

  function syncRowPair(lr, rr) {
    if (!lr || !rr) return;
    if (lr.style.display === "none" || rr.style.display === "none") return;
    if (lr.classList.contains("ng-hide") || rr.classList.contains("ng-hide"))
      return;
    if (typeof lr.getBoundingClientRect !== "function") return;
    if (lr.dataset.vmsOrigHeight === undefined)
      lr.dataset.vmsOrigHeight = lr.style.height || "";
    if (rr.dataset.vmsOrigHeight === undefined)
      rr.dataset.vmsOrigHeight = rr.style.height || "";
    lr.style.height = lr.dataset.vmsOrigHeight;
    rr.style.height = rr.dataset.vmsOrigHeight;
    const lh = lr.getBoundingClientRect().height;
    const rh = rr.getBoundingClientRect().height;
    if (!lh || !rh) return;
    if (Math.abs(lh - rh) < 0.5) return;
    const max = `${Math.ceil(Math.max(lh, rh))}px`;
    lr.style.height = max;
    rr.style.height = max;
  }

  function syncPairedRowHeights(leftInfo, rightInfo) {
    // The site gives left rows fixed inline heights (36px data / 31px
    // category) while right rows auto-size around 29px inputs, so the two
    // halves drift apart by a pixel or two per row. Pin each visible row
    // pair to the taller of the two so the stripes stay aligned.
    if (!tableHasLayout(leftInfo.table) || !tableHasLayout(rightInfo.table))
      return;
    // Header rows (the narrowed vial column wraps its label, growing the
    // left header).
    const lh = Array.from(leftInfo.table.querySelectorAll("thead > tr"));
    const rh = Array.from(rightInfo.table.querySelectorAll("thead > tr"));
    if (lh.length === rh.length) {
      for (let i = 0; i < lh.length; i++) syncRowPair(lh[i], rh[i]);
    }
    if (leftInfo.groups.length !== rightInfo.groups.length) return;
    for (let gi = 0; gi < leftInfo.groups.length; gi++) {
      const lg = leftInfo.groups[gi];
      const rg = rightInfo.groups[gi];
      if (lg.length !== rg.length) continue;
      for (let k = 0; k < lg.length; k++) syncRowPair(lg[k], rg[k]);
    }
  }

  function refreshFloatingHeaders() {
    // The site sizes each .header-fixed clone once when it appears (plus on
    // window resize), so after its slide-toggle "fullscreen" or our column
    // hiding it keeps a stale capped width. Re-measure from the live table.
    let fixed;
    try {
      fixed = document.querySelectorAll(".header-fixed");
    } catch {
      return;
    }
    fixed.forEach((fh) => {
      try {
        if (fh.getClientRects().length === 0) return;
        const parent = fh.parentElement;
        if (!parent) return;
        const srcTable = Array.from(parent.querySelectorAll("table")).find(
          (t) => !t.closest(".header-fixed"),
        );
        if (!srcTable || srcTable.getClientRects().length === 0) return;
        fh.style.width = `${parent.clientWidth}px`;
        const srcRows = Array.from(srcTable.querySelectorAll("thead > tr"));
        const dstRows = Array.from(fh.querySelectorAll("tr"));
        const count = Math.min(srcRows.length, dstRows.length);
        for (let r = 0; r < count; r++) {
          const srcCells = Array.from(srcRows[r].cells);
          const dstCells = Array.from(dstRows[r].cells);
          const n = Math.min(srcCells.length, dstCells.length);
          for (let i = 0; i < n; i++) {
            if (srcCells[i].style.display === "none") continue;
            const w = srcCells[i].getBoundingClientRect().width;
            if (!w) continue;
            // Rect widths are border-box; pin the clone the same way or
            // padding+border get added twice and every column drifts wider.
            dstCells[i].style.boxSizing = "border-box";
            dstCells[i].style.width = `${w}px`;
            dstCells[i].style.minWidth = `${w}px`;
          }
        }
      } catch {
        /* ignore */
      }
    });
  }

  const actionBarStates = new WeakMap();

  function readActionBarBackground(style) {
    return {
      background: style.getPropertyValue("background"),
      backgroundPriority: style.getPropertyPriority("background"),
      backgroundColor: style.getPropertyValue("background-color"),
      backgroundColorPriority: style.getPropertyPriority("background-color"),
    };
  }

  function restoreInlineProperty(style, name, value, priority) {
    if (value) {
      style.setProperty(name, value, priority);
    } else {
      style.removeProperty(name);
    }
  }

  function applyActionBarStyle() {
    const bar = document.getElementById("action_buttons");
    if (!bar) return;
    let state = actionBarStates.get(bar);

    if (settings.transparentFooter) {
      if (!state) {
        state = {
          original: readActionBarBackground(bar.style),
          applied: null,
        };
        actionBarStates.set(bar, state);
      } else if (state.applied) {
        const current = readActionBarBackground(bar.style);
        if (
          current.background !== state.applied.background ||
          current.backgroundPriority !== state.applied.backgroundPriority
        ) {
          state.original.background = current.background;
          state.original.backgroundPriority = current.backgroundPriority;
        }
        if (
          current.backgroundColor !== state.applied.backgroundColor ||
          current.backgroundColorPriority !== state.applied.backgroundColorPriority
        ) {
          state.original.backgroundColor = current.backgroundColor;
          state.original.backgroundColorPriority =
            current.backgroundColorPriority;
        }
      }
      bar.style.setProperty("background", "transparent", "important");
      bar.style.setProperty("background-color", "transparent", "important");
      state.applied = readActionBarBackground(bar.style);
      return;
    }

    if (!state || !state.applied) return;
    const current = readActionBarBackground(bar.style);
    if (
      current.background === state.applied.background &&
      current.backgroundPriority === state.applied.backgroundPriority
    ) {
      restoreInlineProperty(
        bar.style,
        "background",
        state.original.background,
        state.original.backgroundPriority,
      );
    }
    if (
      current.backgroundColor === state.applied.backgroundColor &&
      current.backgroundColorPriority === state.applied.backgroundColorPriority
    ) {
      restoreInlineProperty(
        bar.style,
        "background-color",
        state.original.backgroundColor,
        state.original.backgroundColorPriority,
      );
    }
    actionBarStates.delete(bar);
  }

  function applyFilters() {
    const tables = Array.from(document.querySelectorAll("table"));
    const tableInfo = tables.map((t, tableIndex) => {
      const groups = getGroups(t);
      const headerFlags = groups.map(isHeaderGroup);
      const dataGroupIndices = [];
      const dataLabels = [];
      groups.forEach((g, idx) => {
        if (!headerFlags[idx]) {
          dataGroupIndices.push(idx);
          dataLabels.push(groupLabel(g));
        }
      });
      const ownBlockedData = new Set();
      dataLabels.forEach((label, dataIdx) => {
        if (isBlockedLabel(label)) ownBlockedData.add(dataIdx);
      });
      return {
        table: t,
        groups,
        headerFlags,
        dataGroupIndices,
        ownBlockedData,
        blockedData: ownBlockedData,
        tableIndex,
      };
    });
    const infoByTable = new Map(tableInfo.map((info) => [info.table, info]));

    // The stock-status tab is two side-by-side tables: .left-table holds
    // product names, .right-table holds inputs (plus computed numeric
    // columns, so it looks "texty" but never contains product names).
    // Blocking decisions must come from the left table and be mirrored to
    // the right, otherwise one side hides rows while the other keeps them
    // and the row heights diverge. Pair explicitly via the DOM instead of
    // guessing by group-count proximity.
    const stockPairs = [];
    document.querySelectorAll(".left-table").forEach((leftWrap) => {
      const parent = leftWrap.parentElement;
      if (!parent) return;
      const leftTable = leftWrap.querySelector("table");
      const rightTable = parent.querySelector(".right-table table");
      if (!leftTable || !rightTable) return;
      const leftInfo = infoByTable.get(leftTable);
      const rightInfo = infoByTable.get(rightTable);
      if (!leftInfo || !rightInfo) return;
      if (
        leftInfo.dataGroupIndices.length > 0 &&
        leftInfo.dataGroupIndices.length === rightInfo.dataGroupIndices.length
      ) {
        rightInfo.blockedData = new Set(leftInfo.ownBlockedData);
        stockPairs.push([leftInfo, rightInfo]);
      }
    });

    tableInfo.forEach((info) => {
      applyColumnVisibility(info);

      const blockedData = info.blockedData || new Set();
      // Map group idx -> data idx for quick lookup.
      const dataIdxByGroup = new Map(
        info.dataGroupIndices.map((gIdx, dIdx) => [gIdx, dIdx]),
      );
      const isDataBlocked = (gIdx) => blockedData.has(dataIdxByGroup.get(gIdx));

      // Split into sections: a header plus following data groups. A header
      // is hidden only when its section has data and all of it is blocked.
      const sections = [];
      let current = { header: null, datas: [] };
      info.groups.forEach((g, gIdx) => {
        if (info.headerFlags[gIdx]) {
          sections.push(current);
          current = { header: gIdx, datas: [] };
        } else {
          current.datas.push(gIdx);
        }
      });
      sections.push(current);
      const headerHidden = new Set();
      sections.forEach((s) => {
        if (s.header === null) return;
        if (s.datas.length === 0) return;
        if (s.datas.every(isDataBlocked)) headerHidden.add(s.header);
      });

      let stripe = false;
      info.groups.forEach((g, gIdx) => {
        if (info.headerFlags[gIdx]) {
          // Headers keep site styling: never zebra-striped, never toggle.
          g.forEach((row) => {
            if (headerHidden.has(gIdx)) {
              row.style.display = "none";
            } else {
              resetRowStyle(row);
              Array.from(row.cells).forEach((c) => {
                if (c.tagName === "TH") c.style.verticalAlign = "top";
              });
            }
          });
          return;
        }
        const blocked = isDataBlocked(gIdx);
        g.forEach((row) => {
          if (blocked) {
            row.style.display = "none";
          } else {
            row.style.display = "";
            const cells = Array.from(row.cells);
            if (settings.stripes) {
              row.style.backgroundColor = stripe ? "#e5e7eb" : "#ffffff";
              cells.forEach((c) => {
                c.style.backgroundColor = "transparent";
                c.style.color = "#111827";
              });
            } else {
              row.style.backgroundColor = "";
              cells.forEach((c) => {
                c.style.backgroundColor = "";
                c.style.color = "";
              });
            }
          }
        });
        if (!blocked && settings.stripes) stripe = !stripe;
      });
    });

    // Pin each paired row to the taller half so the split halves can't
    // drift apart (left rows carry fixed inline heights, right rows
    // auto-size around inputs). Skipped for background tabs with no layout.
    lastPairs = stockPairs;
    stockPairs.forEach(([leftInfo, rightInfo]) => {
      syncPairedRowHeights(leftInfo, rightInfo);
      ensureHeightWatch(leftInfo.table, rightInfo.table);
    });
    // Layout can settle after this run (webfonts, late Angular rendering,
    // or a hidden tab revealed later without any DOM insertion, which the
    // MutationObserver never sees). Re-sync once painting is done.
    applyActionBarStyle();
    scheduleSync();
  }

  function mountSettingsPanel() {
    if (document.getElementById("vims-enhancer-panel")) return;
    const parent = document.body || document.documentElement;
    if (!parent) return;

    const POSITION_KEY = "vims-enhancer:button-position:v1";
    const BUTTON_SIZE = 44;
    const UI_MARGIN = 12;
    const DRAG_THRESHOLD = 5;

    const host = document.createElement("div");
    host.id = "vims-enhancer-panel";
    Object.assign(host.style, {
      position: "fixed",
      top: "0",
      right: "0",
      bottom: "0",
      left: "0",
      zIndex: "2147483647",
      pointerEvents: "none",
    });
    if (typeof host.attachShadow !== "function") return;
    const shadow = host.attachShadow({ mode: "open" });

    const root = document.createElement("div");
    Object.assign(root.style, {
      position: "absolute",
      top: "0",
      right: "0",
      bottom: "0",
      left: "0",
      pointerEvents: "none",
      fontFamily:
        'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      fontSize: "13px",
      lineHeight: "1.4",
      color: "#111827",
    });
    shadow.appendChild(root);

    const panel = document.createElement("div");
    panel.id = "vims-enhancer-settings-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "VIMS Enhancer settings");
    Object.assign(panel.style, {
      display: "none",
      position: "absolute",
      zIndex: "1",
      boxSizing: "border-box",
      width: "360px",
      maxWidth: "calc(100vw - 24px)",
      maxHeight: "70vh",
      overflowY: "auto",
      padding: "12px",
      background: "#ffffff",
      border: "1px solid #d1d5db",
      borderRadius: "10px",
      boxShadow: "0 10px 30px rgba(0, 0, 0, 0.25)",
      pointerEvents: "auto",
      textAlign: "left",
    });
    root.appendChild(panel);

    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "8px",
      marginBottom: "6px",
    });
    const title = document.createElement("strong");
    title.textContent = "VIMS Enhancer settings";
    title.style.fontSize = "14px";
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "\u00d7";
    closeButton.setAttribute("aria-label", "Close settings");
    Object.assign(closeButton.style, {
      padding: "0 4px",
      border: "none",
      background: "transparent",
      color: "#4b5563",
      font: "inherit",
      fontSize: "20px",
      lineHeight: "1",
      cursor: "pointer",
    });
    header.append(title, closeButton);
    panel.appendChild(header);

    function addSection(titleText) {
      const first = panel.querySelectorAll("section").length === 0;
      const section = document.createElement("section");
      Object.assign(
        section.style,
        first
          ? { marginTop: "8px" }
          : {
              marginTop: "14px",
              paddingTop: "10px",
              borderTop: "1px solid #e5e7eb",
            },
      );
      const heading = document.createElement("div");
      heading.textContent = titleText;
      Object.assign(heading.style, {
        margin: "0 -4px 6px",
        padding: "5px 8px",
        borderRadius: "4px",
        background: "#f3f4f6",
        color: "#111827",
        fontSize: "11px",
        fontWeight: "700",
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      });
      section.appendChild(heading);
      panel.appendChild(section);
      return section;
    }

    function addCheckbox(parent, labelText, checked, onChange) {
      const label = document.createElement("label");
      Object.assign(label.style, {
        display: "flex",
        alignItems: "flex-start",
        gap: "6px",
        margin: "0 -4px",
        padding: "4px",
        borderRadius: "4px",
        color: "#374151",
        cursor: "pointer",
      });
      label.addEventListener("mouseenter", () => {
        label.style.backgroundColor = "#f3f4f6";
      });
      label.addEventListener("mouseleave", () => {
        label.style.backgroundColor = "";
      });
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = checked;
      Object.assign(input.style, {
        flex: "0 0 auto",
        margin: "2px 0 0",
        accentColor: "#2563eb",
      });
      input.addEventListener("change", () => onChange(input.checked));
      const text = document.createElement("span");
      text.textContent = labelText;
      label.append(input, text);
      parent.appendChild(label);
      return input;
    }

    const rowsSection = addSection("Rows to hide");
    const rowInputs = blockedItems.map((item) =>
      addCheckbox(
        rowsSection,
        item.label,
        isRowEnabled(item.key),
        (checked) => {
          settings.rows[item.key] = checked;
          saveSettings();
          applyFilters();
        },
      ),
    );

    const columnsSection = addSection("Columns to hide");
    const columnInputs = blockedColumnMatchers.map((key) =>
      addCheckbox(
        columnsSection,
        columnLabels[key] || key,
        isColumnEnabled(key),
        (checked) => {
          settings.columns[key] = checked;
          saveSettings();
          applyFilters();
        },
      ),
    );

    const displaySection = addSection("Display");
    const stripesInput = addCheckbox(
      displaySection,
      "Zebra-stripe rows",
      settings.stripes,
      (checked) => {
        settings.stripes = checked;
        saveSettings();
        applyFilters();
      },
    );
    const transparentFooterInput = addCheckbox(
      displaySection,
      "Transparent footer",
      settings.transparentFooter,
      (checked) => {
        settings.transparentFooter = checked;
        saveSettings();
        applyActionBarStyle();
      },
    );

    const footer = document.createElement("div");
    Object.assign(footer.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "8px",
      marginTop: "12px",
    });
    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.textContent = "Reset to defaults";
    Object.assign(resetButton.style, {
      padding: "4px 8px",
      border: "1px solid #d1d5db",
      borderRadius: "6px",
      background: "#f9fafb",
      color: "#111827",
      font: "inherit",
      cursor: "pointer",
    });
    const note = document.createElement("span");
    note.textContent = "Saved in this browser";
    Object.assign(note.style, {
      color: "#6b7280",
      fontSize: "11px",
    });
    footer.append(resetButton, note);
    panel.appendChild(footer);

    function createGearIcon() {
      const svgNs = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(svgNs, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", "22");
      svg.setAttribute("height", "22");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("aria-hidden", "true");
      svg.style.display = "block";
      svg.style.pointerEvents = "none";

      const outer = document.createElementNS(svgNs, "circle");
      outer.setAttribute("cx", "12");
      outer.setAttribute("cy", "12");
      outer.setAttribute("r", "6");
      const inner = document.createElementNS(svgNs, "circle");
      inner.setAttribute("cx", "12");
      inner.setAttribute("cy", "12");
      inner.setAttribute("r", "2.5");
      svg.append(outer, inner);

      [
        [12, 6, 12, 3],
        [16.24, 7.76, 18.36, 5.64],
        [18, 12, 21, 12],
        [16.24, 16.24, 18.36, 18.36],
        [12, 18, 12, 21],
        [7.76, 16.24, 5.64, 18.36],
        [6, 12, 3, 12],
        [7.76, 7.76, 5.64, 5.64],
      ].forEach(([x1, y1, x2, y2]) => {
        const line = document.createElementNS(svgNs, "line");
        line.setAttribute("x1", String(x1));
        line.setAttribute("y1", String(y1));
        line.setAttribute("x2", String(x2));
        line.setAttribute("y2", String(y2));
        line.setAttribute("stroke-width", "2.4");
        svg.appendChild(line);
      });
      return svg;
    }

    function viewportSize() {
      return {
        width: document.documentElement.clientWidth || window.innerWidth,
        height: document.documentElement.clientHeight || window.innerHeight,
      };
    }

    let buttonLeft = 0;
    let buttonTop = 0;

    function setButtonPosition(left, top) {
      const size = viewportSize();
      const maxLeft = Math.max(UI_MARGIN, size.width - BUTTON_SIZE - UI_MARGIN);
      const maxTop = Math.max(UI_MARGIN, size.height - BUTTON_SIZE - UI_MARGIN);
      buttonLeft = Math.min(Math.max(left, UI_MARGIN), maxLeft);
      buttonTop = Math.min(Math.max(top, UI_MARGIN), maxTop);
      toggleButton.style.left = `${Math.round(buttonLeft)}px`;
      toggleButton.style.top = `${Math.round(buttonTop)}px`;
    }

    function loadButtonPosition() {
      try {
        const raw = localStorage.getItem(POSITION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          typeof parsed === "object" &&
          Number.isFinite(parsed.left) &&
          Number.isFinite(parsed.top)
        ) {
          return { left: parsed.left, top: parsed.top };
        }
      } catch {
        /* ignore */
      }
      return null;
    }

    function saveButtonPosition() {
      try {
        localStorage.setItem(
          POSITION_KEY,
          JSON.stringify({
            left: Math.round(buttonLeft),
            top: Math.round(buttonTop),
          }),
        );
      } catch {
        /* ignore */
      }
    }

    function positionPanel() {
      if (panel.style.display === "none") return;
      panel.style.visibility = "hidden";
      const buttonRect = toggleButton.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const size = viewportSize();
      const gap = 8;
      let left = buttonRect.right - panelRect.width;
      left = Math.min(
        Math.max(left, UI_MARGIN),
        Math.max(UI_MARGIN, size.width - panelRect.width - UI_MARGIN),
      );
      let top = buttonRect.top - panelRect.height - gap;
      if (top < UI_MARGIN) top = buttonRect.bottom + gap;
      if (top + panelRect.height > size.height - UI_MARGIN) {
        top = Math.max(UI_MARGIN, size.height - panelRect.height - UI_MARGIN);
      }
      panel.style.left = `${Math.round(left)}px`;
      panel.style.top = `${Math.round(top)}px`;
      panel.style.visibility = "";
    }

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.title = "Drag to move \u00b7 Click for settings";
    toggleButton.setAttribute("aria-label", "Open VIMS Enhancer settings");
    toggleButton.setAttribute("aria-expanded", "false");
    toggleButton.setAttribute("aria-haspopup", "dialog");
    toggleButton.setAttribute("aria-controls", "vims-enhancer-settings-panel");
    Object.assign(toggleButton.style, {
      position: "absolute",
      zIndex: "2",
      left: "0",
      top: "0",
      width: `${BUTTON_SIZE}px`,
      height: `${BUTTON_SIZE}px`,
      boxSizing: "border-box",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "0",
      border: "1px solid #6b7280",
      borderRadius: "999px",
      background: "#ffffff",
      color: "#111827",
      font: "inherit",
      cursor: "grab",
      boxShadow: "0 2px 10px rgba(0, 0, 0, 0.35)",
      pointerEvents: "auto",
      touchAction: "none",
      userSelect: "none",
    });
    toggleButton.appendChild(createGearIcon());
    root.insertBefore(toggleButton, panel);

    const savedPosition = loadButtonPosition();
    if (savedPosition) {
      setButtonPosition(savedPosition.left, savedPosition.top);
    } else {
      const size = viewportSize();
      setButtonPosition(
        size.width - BUTTON_SIZE - UI_MARGIN,
        size.height - BUTTON_SIZE - UI_MARGIN,
      );
    }

    function setOpen(open) {
      if (open) {
        panel.style.visibility = "hidden";
        panel.style.display = "block";
        positionPanel();
      } else {
        panel.style.display = "none";
        panel.style.visibility = "";
      }
      toggleButton.setAttribute("aria-expanded", String(open));
      toggleButton.setAttribute(
        "aria-label",
        open ? "Close VIMS Enhancer settings" : "Open VIMS Enhancer settings",
      );
    }

    function handleResize() {
      setButtonPosition(buttonLeft, buttonTop);
      positionPanel();
    }
    window.addEventListener("resize", handleResize);

    toggleButton.addEventListener("mouseenter", () => {
      toggleButton.style.background = "#f3f4f6";
    });
    toggleButton.addEventListener("mouseleave", () => {
      toggleButton.style.background = "#ffffff";
    });
    toggleButton.addEventListener("focus", () => {
      toggleButton.style.outline = "2px solid #2563eb";
      toggleButton.style.outlineOffset = "2px";
      toggleButton.style.boxShadow =
        "0 0 0 3px rgba(37, 99, 235, 0.45), 0 2px 10px rgba(0, 0, 0, 0.35)";
    });
    toggleButton.addEventListener("blur", () => {
      toggleButton.style.outline = "";
      toggleButton.style.outlineOffset = "";
      toggleButton.style.boxShadow = "0 2px 10px rgba(0, 0, 0, 0.35)";
    });

    let dragState = null;

    function finishDrag(event, allowToggle) {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const moved = dragState.moved;
      dragState = null;
      toggleButton.style.cursor = "grab";
      try {
        toggleButton.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      if (moved) {
        saveButtonPosition();
      } else if (allowToggle) {
        setOpen(panel.style.display === "none");
      }
    }

    toggleButton.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || dragState) return;
      const rect = toggleButton.getBoundingClientRect();
      dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
        moved: false,
      };
      try {
        toggleButton.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    });

    toggleButton.addEventListener("pointermove", (event) => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const dx = event.clientX - dragState.startX;
      const dy = event.clientY - dragState.startY;
      if (!dragState.moved) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragState.moved = true;
        setOpen(false);
        toggleButton.style.cursor = "grabbing";
      }
      setButtonPosition(dragState.left + dx, dragState.top + dy);
      event.preventDefault();
    });

    toggleButton.addEventListener("pointerup", (event) =>
      finishDrag(event, true),
    );
    toggleButton.addEventListener("pointercancel", (event) =>
      finishDrag(event, false),
    );
    toggleButton.addEventListener("lostpointercapture", () => {
      if (!dragState) return;
      if (dragState.moved) saveButtonPosition();
      dragState = null;
      toggleButton.style.cursor = "grab";
    });

    toggleButton.addEventListener("click", (event) => {
      if (event.detail !== 0 || dragState) return;
      setOpen(panel.style.display === "none");
    });

    closeButton.addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && panel.style.display !== "none") {
        setOpen(false);
      }
    });
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (panel.style.display === "none") return;
        const inside =
          typeof event.composedPath === "function"
            ? event.composedPath().includes(host)
            : host.contains(event.target);
        if (!inside) setOpen(false);
      },
      true,
    );

    resetButton.addEventListener("click", () => {
      settings = defaultSettings();
      saveSettings();
      blockedItems.forEach((item, index) => {
        rowInputs[index].checked = isRowEnabled(item.key);
      });
      blockedColumnMatchers.forEach((key, index) => {
        columnInputs[index].checked = isColumnEnabled(key);
      });
      stripesInput.checked = settings.stripes;
      transparentFooterInput.checked = settings.transparentFooter;
      applyActionBarStyle();
      applyFilters();
    });

    parent.appendChild(host);
  }

  let lastPairs = [];
  let syncQueued = false;
  function scheduleSync() {
    if (syncQueued) return;
    syncQueued = true;
    const run = () => {
      syncQueued = false;
      lastPairs.forEach(([l, r]) => {
        try {
          syncPairedRowHeights(l, r);
        } catch {
          /* ignore */
        }
      });
      try {
        refreshFloatingHeaders();
      } catch {
        /* ignore */
      }
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => setTimeout(run, 80));
    } else {
      setTimeout(run, 150);
    }
  }

  const roObserved = typeof WeakSet === "function" ? new WeakSet() : null;
  const roSeen = [];
  let tableRO = null;
  function ensureHeightWatch(leftTable, rightTable) {
    // Revealing a hidden tab changes table sizes without inserting nodes,
    // so watch the paired tables and re-sync whenever layout changes.
    if (typeof ResizeObserver !== "function") return;
    if (!tableRO) {
      tableRO = new ResizeObserver(() => {
        scheduleSync();
      });
    }
    [leftTable, rightTable].forEach((t) => {
      try {
        if (roObserved) {
          if (roObserved.has(t)) return;
          roObserved.add(t);
        } else {
          if (roSeen.includes(t)) return;
          roSeen.push(t);
        }
        tableRO.observe(t);
      } catch {
        /* ignore */
      }
    });
  }

  applyFilters();
  mountSettingsPanel();

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyFilters, 150);
  });

  let scrollQueued = false;
  window.addEventListener(
    "scroll",
    () => {
      // The floating header appears on scroll; keep its width fresh there.
      if (scrollQueued) return;
      scrollQueued = true;
      const run = () => {
        scrollQueued = false;
        try {
          refreshFloatingHeaders();
        } catch {
          /* ignore */
        }
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(run);
      } else {
        setTimeout(run, 60);
      }
    },
    { passive: true },
  );

  if (
    document.fonts &&
    document.fonts.ready &&
    typeof document.fonts.ready.then === "function"
  ) {
    document.fonts.ready.then(() => {
      applyFilters();
    });
  }
  window.addEventListener("load", () => {
    setTimeout(applyFilters, 300);
  });

  const observer = new MutationObserver((mutations) => {
    let shouldUpdate = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        shouldUpdate = true;
        break;
      }
    }
    if (shouldUpdate) {
      applyFilters();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
