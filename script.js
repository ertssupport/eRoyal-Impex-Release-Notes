/* ============================================================
   Release Notes Portal — script.js
   ============================================================ */

const CONFIG = {
  RELEASE_NOTES_CSV_URL: "./Release_Notes.csv",
  LICENSE_CSV_URL: "./LicenseNumber-LICENSE_NUMBERS.csv",
  SPECIAL_LICENSE: "ERI00001",
  ROWS_PER_PAGE: 10,
  SESSION_KEY: "rnp_license",
  THEME_KEY: "rnp_theme",
  /* Client-side gate only — same caveat as the license check: anyone who
     views this file's source can read this value. It keeps casual visitors
     out of the Admin panel, it is not real access control. Change this
     before publishing, and use the special-license + this password
     together as a two-factor UX gate, not a security boundary. */
  ADMIN_PASSWORD: "ERoyal@Admin2026",
};

const COLUMNS = {
  DATE: "Release Date",
  MODULE: "Module",
  PAGE: "Page",
  TYPE: "Release Type",
  NOTES: "Short Notes",
  DOC_INTERNAL: "Internal Doc Link",
  DOC_EXTERNAL: "External Doc Link",
};

const LICENSE_COLUMN = "License_Number";

const CSV_COLUMN_ORDER = [
  COLUMNS.DATE,
  COLUMNS.MODULE,
  COLUMNS.PAGE,
  COLUMNS.TYPE,
  COLUMNS.NOTES,
  COLUMNS.DOC_INTERNAL,
  COLUMNS.DOC_EXTERNAL,
];

/* Looks up a CSV column value by name, ignoring case, spaces, underscores,
   and hidden characters (like a UTF-8 BOM Excel/Sheets sometimes adds to
   the very first header). This means small header mismatches ("License
   Number " vs "License_Number") never silently break the license check. */
function getCol(row, expectedName) {
  const norm = (s) => (s ?? "").toString().toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = norm(expectedName);
  for (const key in row) {
    if (norm(key) === target) return row[key];
  }
  return undefined;
}

/* State Management */
const state = {
  license: null,
  isSpecialLicense: false,
  allNotes: [],
  filteredNotes: [],
  currentPage: 1,
  searchTerm: "",
  activeNote: null,

  /* Admin */
  isAdmin: false,
  allRawRows: [],       // source-of-truth rows, keyed exactly like CSV_COLUMN_ORDER
  editingRow: null,     // raw row object currently open in the form, or null when creating
  csvFileHandle: null,  // FileSystemFileHandle once the admin connects a local CSV
};

/* DOM References */
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

  toastText: document.getElementById("toast-text"),

  confirmBackdrop: document.getElementById("confirm-modal"),
  confirmTitle: document.getElementById("confirm-title"),
  confirmMessage: document.getElementById("confirm-message"),
  confirmYes: document.getElementById("confirm-yes"),
  confirmNo: document.getElementById("confirm-no"),

  themeToggleGate: document.getElementById("theme-toggle-gate"),
  themeTogglePortal: document.getElementById("theme-toggle-portal"),
  themeToggleAdmin: document.getElementById("theme-toggle-admin"),

  adminBtn: document.getElementById("admin-btn"),
  adminAuthModal: document.getElementById("admin-auth-modal"),
  adminLoginBox: document.getElementById("admin-login-box"),
  adminLoginLicense: document.getElementById("admin-login-license"),
  adminAuthForm: document.getElementById("admin-auth-form"),
  adminPasswordInput: document.getElementById("admin-password-input"),
  adminAuthCancel: document.getElementById("admin-auth-cancel"),

  adminScreen: document.getElementById("admin-screen"),
  adminBackBtn: document.getElementById("admin-back-btn"),
  adminLogoutBtn: document.getElementById("admin-logout-btn"),
  addNoteBtn: document.getElementById("add-note-btn"),
  csvStatus: document.getElementById("csv-status"),
  csvStatusText: document.getElementById("csv-status-text"),
  connectCsvBtn: document.getElementById("connect-csv-btn"),
  adminTableBody: document.getElementById("admin-table-body"),
  adminTableStatus: document.getElementById("admin-table-status"),

  noteFormModal: document.getElementById("note-form-modal"),
  noteFormTitle: document.getElementById("note-form-title"),
  noteFormClose: document.getElementById("note-form-close"),
  noteForm: document.getElementById("note-form"),
  noteFormCancel: document.getElementById("note-form-cancel"),
  noteFormSave: document.getElementById("note-form-save"),
  fieldDate: document.getElementById("field-date"),
  fieldModule: document.getElementById("field-module"),
  fieldPage: document.getElementById("field-page"),
  fieldType: document.getElementById("field-type"),
  fieldNotes: document.getElementById("field-notes"),
  fieldInternal: document.getElementById("field-internal"),
  fieldExternal: document.getElementById("field-external"),
};

/* Initialization */
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  wireThemeToggles();
  wireGate();
  wireModal();
  wireConfirmDialog();
  wirePortalControls();
  wireAdmin();
  wireNoteForm();

  const savedLicense = sessionStorage.getItem(CONFIG.SESSION_KEY);
  if (savedLicense) {
    enterPortal(savedLicense);
  }
});

/* ============================================================
   Theme toggle
   ============================================================ */

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function applyTheme(theme, persist) {
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  if (persist) {
    try { localStorage.setItem(CONFIG.THEME_KEY, theme); } catch (e) { /* storage unavailable */ }
  }
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(CONFIG.THEME_KEY); } catch (e) { /* storage unavailable */ }
  applyTheme(saved === "light" ? "light" : "dark", false);
}

function toggleTheme() {
  applyTheme(currentTheme() === "light" ? "dark" : "light", true);
}

function wireThemeToggles() {
  [el.themeToggleGate, el.themeTogglePortal, el.themeToggleAdmin].forEach((btn) => {
    if (btn) btn.addEventListener("click", toggleTheme);
  });
}

/* License Gate */
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
        showGateError("Invalid License Number");
        showToast("Invalid License Number", true);
      }
    } catch (err) {
      console.error(err);
      showGateError("Verification failed. Please try again.");
    } finally {
      setGateBusy(false);
    }
  });
}

async function validateLicense(value) {
  const rows = await fetchCSV(CONFIG.LICENSE_CSV_URL);
  const target = value.toLowerCase();

  for (const row of rows) {
    const candidate = (getCol(row, LICENSE_COLUMN) ?? "").toString().trim();
    if (candidate && candidate.toLowerCase() === target) {
      return candidate;
    }
  }
  return null;
}

function enterPortal(licenseValue) {
  state.license = licenseValue;
  state.isSpecialLicense = licenseValue.toUpperCase() === CONFIG.SPECIAL_LICENSE.toUpperCase();

  sessionStorage.setItem(CONFIG.SESSION_KEY, licenseValue);

  el.gateScreen.hidden = true;
  el.portalScreen.hidden = false;
  el.adminScreen.hidden = true;
  el.licenseChipValue.textContent = licenseValue;
  el.adminBtn.hidden = !state.isSpecialLicense;

  loadReleaseNotes();
}

function setGateBusy(busy) {
  el.gateSubmit.disabled = busy;
  const label = el.gateSubmit.querySelector(".btn-label");
  const spinner = el.gateSubmit.querySelector(".btn-spinner");
  if (label) label.hidden = busy;
  if (spinner) spinner.hidden = !busy;
}

function showGateError(msg) {
  el.gateError.textContent = msg;
  el.gateError.hidden = false;

  const card = document.querySelector(".ticket-main");
  if (card) {
    card.classList.remove("shake");
    void card.offsetWidth; /* restart animation */
    card.classList.add("shake");
  }
}

function hideGateError() {
  el.gateError.hidden = true;
}

function wirePortalControls() {
  el.logoutBtn.addEventListener("click", () => {
    showConfirm({
      title: "Sign out of this session?",
      message: "You'll need to enter your license number again to view release notes.",
      confirmLabel: "Yes, sign out",
      cancelLabel: "No, stay signed in",
      onConfirm: performLogout,
    });
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

function performLogout() {
  sessionStorage.removeItem(CONFIG.SESSION_KEY);
  state.license = null;
  state.isSpecialLicense = false;
  state.allNotes = [];
  state.filteredNotes = [];
  state.allRawRows = [];
  state.currentPage = 1;

  state.isAdmin = false;
  state.csvFileHandle = null;
  state.editingRow = null;
  setCsvStatus("idle");

  el.searchInput.value = "";
  el.portalScreen.hidden = true;
  el.adminScreen.hidden = true;
  el.gateScreen.hidden = false;
  el.adminBtn.hidden = true;
  el.licenseInput.value = "";
  el.licenseInput.focus();
  showToast("Signed out successfully.");
}

/* Reusable Yes / No confirm dialog */
let confirmActiveCallback = null;

function wireConfirmDialog() {
  el.confirmYes.addEventListener("click", () => {
    const cb = confirmActiveCallback;
    closeConfirm();
    if (typeof cb === "function") cb();
  });
  el.confirmNo.addEventListener("click", closeConfirm);
  el.confirmBackdrop.addEventListener("click", (e) => {
    if (e.target === el.confirmBackdrop) closeConfirm();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.confirmBackdrop.hidden) closeConfirm();
  });
}

function showConfirm({ title, message, confirmLabel, cancelLabel, onConfirm }) {
  el.confirmTitle.textContent = title || "Are you sure?";
  el.confirmMessage.textContent = message || "";
  if (confirmLabel) el.confirmYes.textContent = confirmLabel;
  if (cancelLabel) el.confirmNo.textContent = cancelLabel;
  confirmActiveCallback = onConfirm;

  el.confirmBackdrop.hidden = false;
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => el.confirmBackdrop.classList.add("show"));
  el.confirmNo.focus();
}

function closeConfirm() {
  el.confirmBackdrop.classList.remove("show");
  setTimeout(() => { el.confirmBackdrop.hidden = true; }, 150);
  document.body.style.overflow = "";
  confirmActiveCallback = null;
}

function showToast(message, isError) {
  clearTimeout(showToast._handle);
  el.toastText.textContent = message;
  el.toast.classList.toggle("error", !!isError);
  const glyph = document.getElementById("toast-icon-glyph");
  if (glyph) {
    glyph.setAttribute("d", isError ? "M7 7l6 6M13 7l-6 6" : "M6.5 10.3 8.8 12.6 13.5 7.3");
  }
  el.toast.hidden = false;
  requestAnimationFrame(() => el.toast.classList.add("show"));
  showToast._handle = setTimeout(() => {
    el.toast.classList.remove("show");
    setTimeout(() => { el.toast.hidden = true; }, 200);
  }, 3200);
}

/* Appends a cache-busting timestamp so browsers and GitHub Pages' CDN
   always fetch the latest CSV content instead of serving a stale cached
   copy after the sheet/file is edited. */
function withCacheBuster(url) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_=${Date.now()}`;
}

function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    Papa.parse(withCacheBuster(url), {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data),
      error: (err) => reject(err),
    });
  });
}

async function loadReleaseNotes() {
  el.tableStatus.hidden = false;
  el.tableStatus.textContent = "Loading release notes…";
  el.tableBody.innerHTML = "";
  el.pagination.innerHTML = "";
  el.syncStatus.textContent = "Syncing data…";

  try {
    const rows = await fetchCSV(CONFIG.RELEASE_NOTES_CSV_URL);
    state.allRawRows = rows.filter((r) => normalizeRow(r) !== null);
    refreshDerivedNotes();

    const now = new Date();
    el.syncStatus.textContent = `Live Synced · Last updated ${now.toLocaleTimeString()}`;
  } catch (err) {
    console.error(err);
    el.tableStatus.hidden = false;
    el.tableStatus.textContent = "Unable to load release notes.";
    el.syncStatus.textContent = "Sync failed.";
  }
}

/* Rebuilds the display-ready notes list from the raw CSV-shaped rows and
   re-renders whichever table(s) are relevant. Call this after every
   admin Create/Update/Delete, and after the initial load. */
function refreshDerivedNotes() {
  state.allNotes = state.allRawRows
    .map(normalizeRow)
    .filter((r) => r !== null)
    .sort((a, b) => (b.dateSort ?? 0) - (a.dateSort ?? 0));

  applyFilter();
  renderAdminTable();
}

function normalizeRow(row) {
  const date = (getCol(row, COLUMNS.DATE) ?? "").toString().trim();
  const module = (getCol(row, COLUMNS.MODULE) ?? "").toString().trim();
  const page = (getCol(row, COLUMNS.PAGE) ?? "").toString().trim();
  const type = (getCol(row, COLUMNS.TYPE) ?? "").toString().trim();
  const notes = (getCol(row, COLUMNS.NOTES) ?? "").toString().trim();
  const internalLink = (getCol(row, COLUMNS.DOC_INTERNAL) ?? "").toString().trim();
  const externalLink = (getCol(row, COLUMNS.DOC_EXTERNAL) ?? "").toString().trim();

  if (!date && !module && !page && !type && !notes) return null;

  const dateSort = parseDateForSorting(date);
  return { date, module, page, type, notes, internalLink, externalLink, dateSort };
}

function parseDateForSorting(str) {
  if (!str) return null;
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const d = new Date(parseInt(dmy[3], 10), parseInt(dmy[2], 10) - 1, parseInt(dmy[1], 10));
    return isNaN(d.getTime()) ? null : d.getTime();
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
    el.tableStatus.textContent = "No release notes available.";
  } else if (total === 0) {
    el.tableStatus.hidden = false;
    el.tableStatus.textContent = `No matching records found for "${el.searchInput.value.trim()}".`;
  } else {
    el.tableStatus.hidden = true;
    pageRows.forEach((note) => el.tableBody.appendChild(buildRow(note)));
  }

  el.resultCount.textContent = total ? `${total} Record${total === 1 ? "" : "s"}` : "";
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

/* Document Buttons Logic: Only ERI00001 gets Internal Doc, others get External Doc */
function buildDocActions(note) {
  const wrap = document.createElement("div");
  wrap.className = "doc-actions";

  if (state.isSpecialLicense) {
    wrap.appendChild(docButton("Internal Doc", note, "internal"));
    wrap.appendChild(docButton("External Doc", note, "external", true));
  } else {
    wrap.appendChild(docButton("External Doc", note, "external"));
  }

  return wrap;
}

function docButton(label, note, which, secondary) {
  const btn = document.createElement("button");
  btn.type = "button";
  const link = which === "internal" ? note.internalLink : note.externalLink;
  const available = !!link;

  btn.className = "doc-link-btn" + (secondary ? " secondary" : "") + (available ? "" : " unavailable");
  btn.textContent = label;
  btn.setAttribute("aria-disabled", String(!available));
  if (!available) btn.title = "Document not available";

  btn.addEventListener("click", () => {
    if (!available) {
      showToast("Document not available for this release note.", true);
      return;
    }
    openDocModal(note, which);
  });
  return btn;
}

/* Modal and Document Preview */
function wireModal() {
  el.modalClose.addEventListener("click", closeDocModal);
  el.modalBackdrop.addEventListener("click", (e) => {
    if (e.target === el.modalBackdrop) closeDocModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.modalBackdrop.hidden) closeDocModal();
  });

  el.modalTabs.querySelectorAll(".modal-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (state.activeNote) {
        switchModalTab(tab.dataset.target, state.activeNote);
      }
    });
  });
}

function openDocModal(note, which) {
  state.activeNote = note;
  
  const canShowTabs = state.isSpecialLicense && note.internalLink && note.externalLink;
  el.modalTabs.hidden = !canShowTabs;

  el.modalTitle.textContent = `${note.page || note.module || "Document"} Preview (${note.date || ""})`;

  el.frameInternal.src = "about:blank";
  el.frameExternal.src = "about:blank";
  el.frameInternal.removeAttribute("data-loaded");
  el.frameExternal.removeAttribute("data-loaded");

  el.modalBackdrop.hidden = false;
  document.body.style.overflow = "hidden";

  switchModalTab(which, note);
}

function switchModalTab(which, note) {
  el.modalTabs.querySelectorAll(".modal-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.target === which);
  });

  const isInternal = which === "internal";
  el.frameInternal.hidden = !isInternal;
  el.frameExternal.hidden = isInternal;

  const frame = isInternal ? el.frameInternal : el.frameExternal;
  const link = isInternal ? note.internalLink : note.externalLink;

  if (link && !frame.dataset.loaded) {
    frame.src = toDrivePreviewUrl(link);
    frame.dataset.loaded = "1";
  }
}

function closeDocModal() {
  el.modalBackdrop.hidden = true;
  document.body.style.overflow = "";
  el.frameInternal.src = "about:blank";
  el.frameExternal.src = "about:blank";
  state.activeNote = null;
}

function toDrivePreviewUrl(url) {
  if (!url) return "about:blank";
  const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (fileIdMatch) {
    return `https://drive.google.com/file/d/${fileIdMatch[1]}/preview`;
  }
  return url;
}

function renderPagination(pageCount) {
  el.pagination.innerHTML = "";
  if (pageCount <= 1) return;

  el.pagination.appendChild(pageButton("‹", state.currentPage - 1, state.currentPage === 1));

  for (let i = 1; i <= pageCount; i++) {
    const btn = pageButton(String(i), i, false);
    if (i === state.currentPage) btn.classList.add("active");
    el.pagination.appendChild(btn);
  }

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
  });
  return btn;
}

/* ============================================================
   Admin: auth, CRUD, and CSV persistence
   ============================================================ */

function wireAdmin() {
  el.adminBtn.addEventListener("click", () => {
    if (state.isAdmin) {
      enterAdminScreen();
      return;
    }
    el.adminLoginLicense.textContent = state.license || "—";
    el.adminPasswordInput.value = "";
    el.adminAuthModal.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => el.adminPasswordInput.focus(), 0);
  });

  el.adminAuthCancel.addEventListener("click", closeAdminAuth);
  el.adminAuthModal.addEventListener("click", (e) => {
    if (e.target === el.adminAuthModal) closeAdminAuth();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.adminAuthModal.hidden) closeAdminAuth();
  });

  el.adminAuthForm.addEventListener("submit", (e) => {
    e.preventDefault();

    if (!state.isSpecialLicense) {
      showToast("Admin access requires the special license number.", true);
      closeAdminAuth();
      return;
    }

    if (el.adminPasswordInput.value === CONFIG.ADMIN_PASSWORD) {
      closeAdminAuth();
      enterAdminScreen();
    } else {
      shakeAdminLogin();
      showToast("Incorrect admin password.", true);
    }
  });

  el.adminBackBtn.addEventListener("click", exitAdminScreen);

  el.adminLogoutBtn.addEventListener("click", () => {
    showConfirm({
      title: "Sign out of this session?",
      message: "You'll need to enter your license number again to view release notes.",
      confirmLabel: "Yes, sign out",
      cancelLabel: "No, stay signed in",
      onConfirm: performLogout,
    });
  });

  el.addNoteBtn.addEventListener("click", () => openNoteForm(null));
  el.connectCsvBtn.addEventListener("click", connectCsvFile);
}

function closeAdminAuth() {
  el.adminAuthModal.hidden = true;
  document.body.style.overflow = "";
}

function shakeAdminLogin() {
  el.adminLoginBox.classList.remove("shake");
  void el.adminLoginBox.offsetWidth; /* restart animation */
  el.adminLoginBox.classList.add("shake");
}

function enterAdminScreen() {
  state.isAdmin = true;
  el.portalScreen.hidden = true;
  el.adminScreen.hidden = false;
  el.connectCsvBtn.hidden = !supportsFS();
  renderAdminTable();
}

function exitAdminScreen() {
  el.adminScreen.hidden = true;
  el.portalScreen.hidden = false;
}

/* ---- Admin table ---- */

function renderAdminTable() {
  if (!el.adminTableBody) return;

  const rows = [...state.allRawRows].sort((a, b) => {
    const da = parseDateForSorting((getCol(a, COLUMNS.DATE) || "").toString());
    const db = parseDateForSorting((getCol(b, COLUMNS.DATE) || "").toString());
    return (db ?? 0) - (da ?? 0);
  });

  el.adminTableBody.innerHTML = "";

  if (rows.length === 0) {
    el.adminTableStatus.hidden = false;
    el.adminTableStatus.textContent = "No release notes yet — add your first one.";
    return;
  }

  el.adminTableStatus.hidden = true;
  rows.forEach((row) => el.adminTableBody.appendChild(buildAdminRow(row)));
}

function buildAdminRow(row) {
  const date = (getCol(row, COLUMNS.DATE) || "").toString();
  const module = (getCol(row, COLUMNS.MODULE) || "").toString();
  const page = (getCol(row, COLUMNS.PAGE) || "").toString();
  const type = (getCol(row, COLUMNS.TYPE) || "").toString();
  const notes = (getCol(row, COLUMNS.NOTES) || "").toString();
  const internal = (getCol(row, COLUMNS.DOC_INTERNAL) || "").toString();
  const external = (getCol(row, COLUMNS.DOC_EXTERNAL) || "").toString();

  const tr = document.createElement("tr");

  tr.appendChild(td(date, "Release Date", "cell-date"));

  const moduleTd = td("", "Module");
  moduleTd.appendChild(moduleTag(module));
  tr.appendChild(moduleTd);

  tr.appendChild(td(page, "Page"));

  const typeTd = td("", "Release Type");
  typeTd.appendChild(typePill(type));
  tr.appendChild(typeTd);

  tr.appendChild(td(notes, "Short Notes", "cell-notes-admin"));

  const docTd = td("", "Docs");
  const docWrap = document.createElement("div");
  docWrap.className = "doc-status";
  docWrap.appendChild(docStatusSpan("Internal", !!internal));
  docWrap.appendChild(docStatusSpan("External", !!external));
  docTd.appendChild(docWrap);
  tr.appendChild(docTd);

  const actionsTd = td("", "Actions");
  const actionsWrap = document.createElement("div");
  actionsWrap.className = "row-actions";
  actionsWrap.appendChild(iconButton("edit", "Edit", () => openNoteForm(row)));
  actionsWrap.appendChild(iconButton("delete", "Delete", () => handleDeleteRow(row)));
  actionsTd.appendChild(actionsWrap);
  tr.appendChild(actionsTd);

  return tr;
}

function docStatusSpan(label, present) {
  const span = document.createElement("span");
  span.className = present ? "present" : "";
  span.textContent = `${label} ${present ? "✓" : "—"}`;
  return span;
}

function iconButton(kind, title, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn" + (kind === "delete" ? " danger" : "");
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.innerHTML =
    kind === "delete"
      ? '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4.5 4.5 5 13a1 1 0 0 0 1 .9h4a1 1 0 0 0 1-.9l.5-8.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M11.3 2.3a1.5 1.5 0 0 1 2.1 2.1L5.8 12l-3 .8.8-3 7.7-7.5Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  btn.addEventListener("click", onClick);
  return btn;
}

/* ---- Add / Edit form ---- */

function wireNoteForm() {
  el.noteFormClose.addEventListener("click", closeNoteForm);
  el.noteFormCancel.addEventListener("click", closeNoteForm);
  el.noteFormModal.addEventListener("click", (e) => {
    if (e.target === el.noteFormModal) closeNoteForm();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.noteFormModal.hidden) closeNoteForm();
  });
  el.noteForm.addEventListener("submit", handleNoteFormSubmit);
}

function clearInjectedOptions(selectEl) {
  selectEl.querySelectorAll('option[data-injected="1"]').forEach((o) => o.remove());
}

function ensureSelectHasValue(selectEl, value) {
  if (!value) return;
  const exists = Array.from(selectEl.options).some((o) => o.value === value);
  if (!exists) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = `${value} (existing value)`;
    opt.dataset.injected = "1";
    selectEl.appendChild(opt);
  }
}

function openNoteForm(row) {
  state.editingRow = row;
  el.noteFormTitle.textContent = row ? "Edit release note" : "Add release note";

  clearInjectedOptions(el.fieldModule);
  clearInjectedOptions(el.fieldType);

  const moduleVal = row ? (getCol(row, COLUMNS.MODULE) || "").toString() : "Import";
  const typeVal = row ? (getCol(row, COLUMNS.TYPE) || "").toString() : "New Feature";
  ensureSelectHasValue(el.fieldModule, moduleVal);
  ensureSelectHasValue(el.fieldType, typeVal);

  el.fieldDate.value = row ? toISODateInput((getCol(row, COLUMNS.DATE) || "").toString()) : "";
  el.fieldModule.value = moduleVal;
  el.fieldPage.value = row ? (getCol(row, COLUMNS.PAGE) || "").toString() : "";
  el.fieldType.value = typeVal;
  el.fieldNotes.value = row ? (getCol(row, COLUMNS.NOTES) || "").toString() : "";
  el.fieldInternal.value = row ? (getCol(row, COLUMNS.DOC_INTERNAL) || "").toString() : "";
  el.fieldExternal.value = row ? (getCol(row, COLUMNS.DOC_EXTERNAL) || "").toString() : "";

  el.noteFormModal.hidden = false;
  document.body.style.overflow = "hidden";
  setTimeout(() => el.fieldDate.focus(), 0);
}

function closeNoteForm() {
  el.noteFormModal.hidden = true;
  document.body.style.overflow = "";
  state.editingRow = null;
  el.noteForm.reset();
}

async function handleNoteFormSubmit(e) {
  e.preventDefault();

  if (!el.fieldDate.value) {
    showToast("Please choose a release date.", true);
    return;
  }

  const newRow = {};
  newRow[COLUMNS.DATE] = toDMY(el.fieldDate.value);
  newRow[COLUMNS.MODULE] = el.fieldModule.value.trim();
  newRow[COLUMNS.PAGE] = el.fieldPage.value.trim();
  newRow[COLUMNS.TYPE] = el.fieldType.value.trim();
  newRow[COLUMNS.NOTES] = el.fieldNotes.value.trim();
  newRow[COLUMNS.DOC_INTERNAL] = el.fieldInternal.value.trim();
  newRow[COLUMNS.DOC_EXTERNAL] = el.fieldExternal.value.trim();

  const editingRow = state.editingRow;
  el.noteFormSave.disabled = true;

  try {
    if (editingRow) {
      Object.keys(editingRow).forEach((k) => delete editingRow[k]);
      Object.assign(editingRow, newRow);
    } else {
      state.allRawRows.push(newRow);
    }

    refreshDerivedNotes();
    closeNoteForm();

    const result = await persistCSV();
    showToast(
      result.method === "file"
        ? "Saved — written directly to Release_Notes.csv"
        : "Saved — an updated Release_Notes.csv just downloaded"
    );
  } catch (err) {
    console.error(err);
    showToast("Something went wrong saving that change.", true);
  } finally {
    el.noteFormSave.disabled = false;
  }
}

function handleDeleteRow(row) {
  const page = (getCol(row, COLUMNS.PAGE) || "").toString();
  const notes = (getCol(row, COLUMNS.NOTES) || "").toString();

  showConfirm({
    title: "Delete this release note?",
    message: `${page || "This entry"}${notes ? " — " + notes : ""}`.slice(0, 160),
    confirmLabel: "Yes, delete",
    cancelLabel: "Cancel",
    onConfirm: async () => {
      const idx = state.allRawRows.indexOf(row);
      if (idx === -1) return;
      state.allRawRows.splice(idx, 1);
      refreshDerivedNotes();

      try {
        const result = await persistCSV();
        showToast(
          result.method === "file"
            ? "Deleted — saved to Release_Notes.csv"
            : "Deleted — an updated Release_Notes.csv just downloaded"
        );
      } catch (err) {
        console.error(err);
        showToast("Something went wrong saving that deletion.", true);
      }
    },
  });
}

/* ---- Date helpers for the <input type="date"> field ---- */

function toISODateInput(ddmmyyyy) {
  const m = (ddmmyyyy || "").match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const d = new Date(ddmmyyyy);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function toDMY(isoDate) {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

/* ---- CSV persistence: File System Access API, with download fallback ---- */

function supportsFS() {
  return typeof window.showOpenFilePicker === "function";
}

async function connectCsvFile() {
  if (!supportsFS()) {
    showToast("Your browser doesn't support direct file writes — changes will download instead.", true);
    return;
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: "CSV file", accept: { "text/csv": [".csv"] } }],
      excludeAcceptAllOption: false,
      multiple: false,
    });
    const perm = await handle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") throw new Error("Permission not granted");

    state.csvFileHandle = handle;
    setCsvStatus("connected", handle.name);
    showToast(`Connected — future edits save straight to ${handle.name}`);
  } catch (err) {
    if (err && err.name === "AbortError") return; /* user cancelled the picker */
    console.error(err);
    showToast("Couldn't connect that file — edits will download instead.", true);
  }
}

async function writeToHandle(handle, text) {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

function downloadCSV(text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "Release_Notes.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function persistCSV() {
  const csvText = Papa.unparse(state.allRawRows, { columns: CSV_COLUMN_ORDER });

  if (state.csvFileHandle) {
    try {
      await writeToHandle(state.csvFileHandle, csvText);
      setCsvStatus("connected", state.csvFileHandle.name);
      return { method: "file" };
    } catch (err) {
      console.error(err);
      state.csvFileHandle = null;
      showToast("Lost access to the connected file — edits will download instead.", true);
    }
  }

  downloadCSV(csvText);
  setCsvStatus("idle");
  return { method: "download" };
}

function setCsvStatus(mode, fileName) {
  if (!el.csvStatus) return;
  if (mode === "connected") {
    el.csvStatus.classList.add("connected");
    el.csvStatusText.textContent = fileName
      ? `Connected — saving directly to ${fileName}`
      : "Connected — saving directly to file";
  } else {
    el.csvStatus.classList.remove("connected");
    el.csvStatusText.textContent = "Not connected — changes will download";
  }
}
