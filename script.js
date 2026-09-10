/* ============================================================
   Release Notes Portal — script.js
   ============================================================ */

const CONFIG = {
  RELEASE_NOTES_CSV_URL: "./Release_Notes.csv",
  LICENSE_CSV_URL: "./LicenseNumber-LICENSE_NUMBERS.csv",
  SPECIAL_LICENSE: "ERI00001",
  ROWS_PER_PAGE: 10,
  SESSION_KEY: "rnp_license",
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

/* State Management */
const state = {
  license: null,
  isSpecialLicense: false,
  allNotes: [],
  filteredNotes: [],
  currentPage: 1,
  searchTerm: "",
  activeNote: null
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
};

/* Initialization */
document.addEventListener("DOMContentLoaded", () => {
  wireGate();
  wireModal();
  wireConfirmDialog();
  wirePortalControls();

  const savedLicense = sessionStorage.getItem(CONFIG.SESSION_KEY);
  if (savedLicense) {
    enterPortal(savedLicense);
  }
});

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
    const candidate = (row[LICENSE_COLUMN] ?? "").toString().trim();
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
  el.licenseChipValue.textContent = licenseValue;

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
  state.allNotes = [];
  state.filteredNotes = [];
  state.currentPage = 1;
  el.searchInput.value = "";
  el.portalScreen.hidden = true;
  el.gateScreen.hidden = false;
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

function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
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
    state.allNotes = rows
      .map(normalizeRow)
      .filter((r) => r !== null)
      .sort((a, b) => (b.dateSort ?? 0) - (a.dateSort ?? 0));

    applyFilter();

    const now = new Date();
    el.syncStatus.textContent = `Live Synced · Last updated ${now.toLocaleTimeString()}`;
  } catch (err) {
    console.error(err);
    el.tableStatus.hidden = false;
    el.tableStatus.textContent = "Unable to load release notes.";
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
