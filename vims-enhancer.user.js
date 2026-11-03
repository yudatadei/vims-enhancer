// ==UserScript==
// @name         VIMS Enhancer
// @namespace    tadey
// @icon         https://vims.moh.go.tz/public/v1770157188524/favicon.ico
// @version      1.0.1
// @description  Hides selected vaccine/product rows and unwanted columns in VIMS tables, and adds zebra stripes to the remaining rows.
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
 * - Keeps split tables aligned and the site's floating table headers sized
 *   to the live table.
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
  ].map((s) => s.toLowerCase());

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function isBlockedLabel(label) {
    const low = label.toLowerCase();
    return blockedItems.some((item) => {
      if (!low.includes(item)) return false;
      // Short codes like "TT" would false-positive on any "tt" substring
      // (e.g. "bottle"). Require a whole-word match for short items.
      if (item.length <= 3) {
        try {
          return new RegExp(`\\b${escapeRegExp(item)}\\b`, "i").test(label);
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
    "kiwango ch", // all monthly-coverage % columns (W1/W2/W3/Td variants)
    "zilizoharibika kabla ya kufunguliwa",
    "sababu ya kuharibika",
    "kituo kingine",
    "siku ambazo chanjo hazikuwepo",
  ];

  function normText(s) {
    return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function thMatchesBlocked(th) {
    const t = normText(th.textContent);
    if (!t) return false;
    if (t === "remarks") return true;
    return blockedColumnMatchers.some((m) => t.includes(m));
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
        } else if (hideLastCol && cells.length > 0) {
          cells[cells.length - 1].style.display = "none";
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
            const bg = stripe ? "#e5e7eb" : "#ffffff";
            row.style.backgroundColor = bg;
            Array.from(row.cells).forEach((c) => {
              c.style.backgroundColor = "transparent";
              c.style.color = "#111827";
            });
          }
        });
        if (!blocked) stripe = !stripe;
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
    scheduleSync();
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
