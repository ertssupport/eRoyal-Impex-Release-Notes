/* ============================================================
   Release Notes Portal — script.js
   ------------------------------------------------------------
   EDIT THE CONFIG BLOCK BELOW to point at your own Google
   Sheets CSV export URLs and, if your column headers differ,
   update COLUMNS to match. See README.md for full setup steps.
   ============================================================ */

const CONFIG = {
  // Paste the "Publish to web" CSV URL for your Release Notes sheet.
  RELEASE_NOTES_CSV_URL: "PASTE_RELEASE_NOTES_CSV_URL_HERE",

  // Paste the "Publish to web" CSV URL for your Valid License Numbers sheet.
  LICENSE_CSV_URL: "PASTE_LICENSE_NUMBERS_CSV_URL_HERE",

  // License number that unlocks the dual Internal/External doc view.
  SPECIAL_LICENSE: "ERI00001",

  ROWS_PER_PAGE: 10,

  // sessionStorage key used to remember a validated license for this tab session.
  SESSION_KEY: "rnp_license",
};

// Column headers expected in the Release Notes sheet.
// Rename the values (right-hand side) if your sheet uses different headers —
// keep the left-hand keys unchanged, since the rest of the script refers to them.
const COLUMNS = {
  DATE: "Release Date",
  MODULE: "Module",
  PAGE: "Page",
  TYPE: "Release Type",
  NOTES: "Short Notes",
  DOC_INTERNAL: "Internal Doc Link",
  DOC_EXTERNAL: "External Doc Link",
};

// Column header expected in the License Numbers sheet.
const LICENSE_COLUMN = "License_ Number";

/* ============================================================
   State
   ============================================================ */

const state = {
  license: null,
  isSpecialLicense: false,
  allNotes: [],
  filteredNotes: [],
  currentPage: 1,
  searchTerm: "",
};

/* ============================================================
   DOM references
   ============================================================ */

const el = {
  gateScreen: document.getElementById("gate-screen"),
  gateForm: document.getElementById("gate-form"),
  licenseInput: document.getElementById("license-input"),
  gateSubmit: document.getElementById("gate-submit"),
  gateError: document.getElementById("gate-error"),
  toast: document.getElementById("toast"),

  portalScreen: document.getElementById("portal-screen"),
  licenseChipValue: document.getElementById("license-chip-value"),
  logoutBtn: document.getElementById("logout-btn"),
  searchInput: document.getElementById("search-input"),
  resultCount: document.getElementById("result-count"),
  tableBody: document.getElementById("table-body"),
  tableStatus: document.getElementById("table-status"),
  pagination: document.getElementById("pagination"),
  syncStatus: document.getElementById("sync-status"),

  modalBackdrop: document.getElementById("doc-modal"),
  modalTitle: document.getElementById("modal-title"),
  modalTabs: document.getElementById("modal-tabs"),
  modalClose: document.getElementById("modal-close"),
  frameInternal: document.getElementById("modal-frame-internal"),
  frameExternal: document.getElementById("modal-frame-external"),
};

/* ============================================================
   Init
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  wireGate();
  wireModal();
  wirePortalControls();

  const savedLicense = sessionStorage.getItem(CONFIG.SESSION_KEY);
  if (savedLicense) {
    enterPortal(savedLicense);
  }
});

/* ============================================================
   License gate
   ============================================================ */

function wireGate() {
  el.gateForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = el.licenseInput.value.trim();
    if (!value) return;

    setGateBusy(true);
    hideGateError();

    try {
      const matched = await validateLicense(value);
      if (matched) {
        enterPortal(matched);
      } else {
        showGateError("Invalid Company License Number");
        showToast("Invalid Company License Number", true);
      }
    } catch (err) {
      console.error(err);
      showGateError("Couldn't verify your license right now. Please try again.");
    } finally {
      setGateBusy(false);
    }
  });
}

async function validateLicense(value) {
  const rows = await fetchCSV(CONFIG.LICENSE_CSV_URL);
  const target = value.toLowerCase();

  for (const row of rows) {
    const candidate = (row[LICENSE_COLUMN] ?? "").toString().trim();
    if (candidate && candidate.toLowerCase() === target) {
      return candidate; // return the sheet's canonical casing/value
    }
  }
  return null;
}

function enterPortal(licenseValue) {
  state.license = licenseValue;
  state.isSpecialLicense = licenseValue === CONFIG.SPECIAL_LICENSE;

  sessionStorage.setItem(CONFIG.SESSION_KEY, licenseValue);

  el.gateScreen.hidden = true;
  el.portalScreen.hidden = false;
  el.licenseChipValue.textContent = licenseValue;

  loadReleaseNotes();
}

function setGateBusy(busy) {
  el.gateSubmit.disabled = busy;
  el.gateSubmit.querySelector(".btn-label").hidden = busy;
  el.gateSubmit.querySelector(".btn-spinner").hidden = !busy;
}

function showGateError(msg) {
  el.gateError.textContent = msg;
  el.gateError.hidden = false;
}

function hideGateError() {
  el.gateError.hidden = true;
}

function wirePortalControls() {
  el.logoutBtn.addEventListener("click", () => {
    sessionStorage.removeItem(CONFIG.SESSION_KEY);
    state.license = null;
    state.allNotes = [];
    state.filteredNotes = [];
    state.currentPage = 1;
    el.searchInput.value = "";
    el.portalScreen.hidden = true;
    el.gateScreen.hidden = false;
    el.licenseInput.value = "";
    el.licenseInput.focus();
  });

  let debounceHandle;
  el.searchInput.addEventListener("input", () => {
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => {
      state.searchTerm = el.searchInput.value.trim().toLowerCase();
      state.currentPage = 1;
      applyFilter();
    }, 120);
  });
}

/* ============================================================
   Toast
   ============================================================ */

let toastHandle;
function showToast(message, isError) {
  clearTimeout(toastHandle);
  el.toast.textContent = message;
  el.toast.classList.toggle("error", !!isError);
  el.toast.hidden = false;
  requestAnimationFrame(() => el.toast.classList.add("show"));
  toastHandle = setTimeout(() => {
    el.toast.classList.remove("show");
    setTimeout(() => { el.toast.hidden = true; }, 200);
  }, 3200);
}

/* ============================================================
   CSV fetching
   ============================================================ */

function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    if (!url || url.startsWith("PASTE_")) {
      reject(new Error("CSV URL not configured. Update CONFIG in script.js."));
      return;
    }
    Papa.parse(url, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data),
      error: (err) => reject(err),
    });
  });
}

/* ============================================================
   Release notes: load, normalize, render
   ============================================================ */

async function loadReleaseNotes() {
  el.tableStatus.hidden = false;
  el.tableStatus.textContent = "Loading release notes…";
  el.tableBody.innerHTML = "";
  el.pagination.innerHTML = "";
  el.syncStatus.textContent = "Loading release data…";

  try {
    const rows = await fetchCSV(CONFIG.RELEASE_NOTES_CSV_URL);
    state.allNotes = rows
      .map(normalizeRow)
      .filter((r) => r !== null)
      .sort((a, b) => (b.dateSort ?? 0) - (a.dateSort ?? 0));

    applyFilter();

    const now = new Date();
    el.syncStatus.textContent =
      `Synced from Google Sheets · last checked ${now.toLocaleTimeString()} · refresh the page for the latest updates`;
  } catch (err) {
    console.error(err);
    el.tableStatus.hidden = false;
    el.tableStatus.textContent =
      "Couldn't load release notes. Check the CSV URL in script.js and your connection.";
    el.syncStatus.textContent = "Sync failed.";
  }
}

function normalizeRow(row) {
  const date = (row[COLUMNS.DATE] ?? "").toString().trim();
  const module = (row[COLUMNS.MODULE] ?? "").toString().trim();
  const page = (row[COLUMNS.PAGE] ?? "").toString().trim();
  const type = (row[COLUMNS.TYPE] ?? "").toString().trim();
  const notes = (row[COLUMNS.NOTES] ?? "").toString().trim();
  const internalLink = (row[COLUMNS.DOC_INTERNAL] ?? "").toString().trim();
  const externalLink = (row[COLUMNS.DOC_EXTERNAL] ?? "").toString().trim();

  // Skip fully blank rows (e.g. trailing empty lines in the sheet).
  if (!date && !module && !page && !type && !notes) return null;

  const dateSort = parseDateForSorting(date);

  return { date, module, page, type, notes, internalLink, externalLink, dateSort };
}

// Parses the Release Date column for sorting purposes only (display always
// uses the original sheet text, untouched). Handles DD/MM/YYYY (e.g.
// "07/08/2026" = 7 August 2026) since that's the common Google Sheets export
// format outside the US. Falls back to native Date parsing for anything else
// (e.g. "2026-08-07" ISO format), so both styles work.
function parseDateForSorting(str) {
  if (!str) return null;

  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10);
    const year = parseInt(dmy[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(year, month - 1, day);
      return isNaN(d.getTime()) ? null : d.getTime();
    }
  }

  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback.getTime();
}

function applyFilter() {
  const term = state.searchTerm;
  if (!term) {
    state.filteredNotes = state.allNotes;
  } else {
    state.filteredNotes = state.allNotes.filter((n) => {
      return (
        n.date.toLowerCase().includes(term) ||
        n.module.toLowerCase().includes(term) ||
        n.page.toLowerCase().includes(term) ||
        n.type.toLowerCase().includes(term) ||
        n.notes.toLowerCase().includes(term)
      );
    });
  }
  renderTable();
}

function renderTable() {
  const total = state.filteredNotes.length;
  const pageSize = CONFIG.ROWS_PER_PAGE;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (state.currentPage > pageCount) state.currentPage = pageCount;

  const start = (state.currentPage - 1) * pageSize;
  const pageRows = state.filteredNotes.slice(start, start + pageSize);

  el.tableBody.innerHTML = "";

  if (state.allNotes.length === 0) {
    el.tableStatus.hidden = false;
    el.tableStatus.textContent = "No release notes found.";
  } else if (total === 0) {
    el.tableStatus.hidden = false;
    el.tableStatus.textContent = `No results for "${el.searchInput.value.trim()}".`;
  } else {
    el.tableStatus.hidden = true;
    pageRows.forEach((note) => el.tableBody.appendChild(buildRow(note)));
  }

  el.resultCount.textContent = total
    ? `${total} record${total === 1 ? "" : "s"}`
    : "";

  renderPagination(pageCount);
}

function buildRow(note) {
  const tr = document.createElement("tr");

  tr.appendChild(td(note.date, "Release Date", "cell-date"));

  const moduleTd = td("", "Module");
  moduleTd.appendChild(moduleTag(note.module));
  tr.appendChild(moduleTd);

  tr.appendChild(td(note.page, "Page"));

  const typeTd = td("", "Release Type");
  typeTd.appendChild(typePill(note.type));
  tr.appendChild(typeTd);

  tr.appendChild(td(note.notes, "Short Notes", "cell-notes"));

  const docTd = td("", "View Doc");
  docTd.appendChild(buildDocActions(note));
  tr.appendChild(docTd);

  return tr;
}

function td(text, label, className) {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.setAttribute("data-label", label);
  if (text) cell.textContent = text;
  return cell;
}

function moduleTag(module) {
  const span = document.createElement("span");
  const key = (module || "").toLowerCase();
  const cls = key === "import" ? "tag-import" : key === "export" ? "tag-export" : "tag-both";
  span.className = `tag ${cls}`;
  span.textContent = module || "—";
  return span;
}

function typePill(type) {
  const span = document.createElement("span");
  const key = (type || "").toLowerCase().includes("new") ? "type-new" : "type-enhancement";
  span.className = `type-pill ${key}`;
  span.textContent = type || "—";
  return span;
}

function buildDocActions(note) {
  const wrap = document.createElement("div");
  wrap.className = "doc-actions";

  const hasExternal = state.isSpecialLicense && note.externalLink;

  if (hasExternal) {
    wrap.appendChild(docButton("Internal", note, "internal"));
    wrap.appendChild(docButton("External", note, "external", true));
  } else {
    wrap.appendChild(docButton("View Document", note, "internal"));
  }

  return wrap;
}

function docButton(label, note, which, secondary) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "doc-link-btn" + (secondary ? " secondary" : "");
  btn.textContent = label;
  btn.disabled = which === "internal" ? !note.internalLink : !note.externalLink;
  btn.addEventListener("click", () => openDocModal(note, which));
  return btn;
}

/* ============================================================
   Pagination
   ============================================================ */

function renderPagination(pageCount) {
  el.pagination.innerHTML = "";
  if (pageCount <= 1) return;

  el.pagination.appendChild(pageButton("‹", state.currentPage - 1, state.currentPage === 1));

  const pages = paginationRange(state.currentPage, pageCount);
  pages.forEach((p) => {
    if (p === "…") {
      const span = document.createElement("span");
      span.className = "page-ellipsis";
      span.textContent = "…";
      el.pagination.appendChild(span);
    } else {
      const btn = pageButton(String(p), p, false);
      if (p === state.currentPage) btn.classList.add("active");
      el.pagination.appendChild(btn);
    }
  });

  el.pagination.appendChild(pageButton("›", state.currentPage + 1, state.currentPage === pageCount));
}

function pageButton(label, targetPage, disabled) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "page-btn";
  btn.textContent = label;
  btn.disabled = disabled;
  btn.addEventListener("click", () => {
    state.currentPage = targetPage;
    renderTable();
    document.getElementById("notes-table").scrollIntoView({ block: "nearest" });
  });
  return btn;
}

function paginationRange(current, total) {
  const delta = 1;
  const range = [];
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || (i >= current - delta && i <= current + delta)) {
      range.push(i);
    }
  }
  const withDots = [];
  let prev = 0;
  for (const p of range) {
    if (prev && p - prev > 1) withDots.push("…");
    withDots.push(p);
    prev = p;
  }
  return withDots;
}

/* ============================================================
   Document modal
   ============================================================ */

function wireModal() {
  el.modalClose.addEventListener("click", closeDocModal);
  el.modalBackdrop.addEventListener("click", (e) => {
    if (e.target === el.modalBackdrop) closeDocModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.modalBackdrop.hidden) closeDocModal();
  });

  el.modalTabs.querySelectorAll(".modal-tab").forEach((tab) => {
    tab.addEventListener("click", () => switchModalTab(tab.dataset.target));
  });
}

function openDocModal(note, which) {
  const hasExternal = state.isSpecialLicense && note.externalLink;
  el.modalTabs.hidden = !hasExternal;
  el.modalTitle.textContent = `${note.page || note.module || "Release"} — ${note.date || ""}`.trim();

  el.frameInternal.src = "about:blank";
  el.frameExternal.src = "about:blank";
  el.frameInternal.removeAttribute("data-loaded");
  el.frameExternal.removeAttribute("data-loaded");

  el.modalBackdrop.hidden = false;
  document.body.style.overflow = "hidden";

  switchModalTab(which === "external" && hasExternal ? "external" : "internal", note);
}

function switchModalTab(which, note) {
  el.modalTabs.querySelectorAll(".modal-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.target === which);
  });

  const showInternal = which === "internal";
  el.frameInternal.hidden = !showInternal;
  el.frameExternal.hidden = showInternal;

  const frame = showInternal ? el.frameInternal : el.frameExternal;
  if (note && !frame.dataset.loaded) {
    const link = showInternal ? note.internalLink : note.externalLink;
    frame.src = toDrivePreviewUrl(link);
    frame.dataset.loaded = "1";
  }
}

function closeDocModal() {
  el.modalBackdrop.hidden = true;
  document.body.style.overflow = "";
  el.frameInternal.src = "about:blank";
  el.frameExternal.src = "about:blank";
}

// Converts a Google Drive share link into its /preview embed URL.
// Falls back to returning the original URL if it doesn't look like Drive.
function toDrivePreviewUrl(url) {
  if (!url) return "about:blank";

  const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (fileIdMatch) {
    return `https://drive.google.com/file/d/${fileIdMatch[1]}/preview`;
  }
  return url;
}
