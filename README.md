# Release Notes Portal

A static, single-page site that gates access behind a company license number
and displays a live-synced "Release Notes" table pulled from Google Sheets.
No backend, no build step — deploys directly to GitHub Pages.

```
release-notes-portal/
├── index.html
├── style.css
├── script.js
└── README.md
```

---

## 1. Set up the two Google Sheets

You need **two separate Google Sheets**.

### Sheet A — Release Notes data

Create a sheet with a header row using **exactly** these column names (first
row, exact spelling/casing):

| Release Date | Module | Page | Release Type | Short Notes | Internal Doc Link | External Doc Link |
|---|---|---|---|---|---|---|
| 2026-08-01 | Import | Purchase Orders | New Feature | Added bulk CSV import for PO lines. | https://drive.google.com/file/d/FILE_ID/view | https://drive.google.com/file/d/OTHER_FILE_ID/view |

Notes:
- **Module** should be one of `Import`, `Export`, or `Both` (used to color the tag in the table).
- **Release Type** should be one of `New Feature` or `Enhancement`.
- **Internal Doc Link** is the document shown to every valid license.
- **External Doc Link** is optional — it's only shown (as a second "External" button) to the special license `ERI00001`. You can leave it blank for other rows.
- Doc links should be normal Google Drive "share" links, e.g. `https://drive.google.com/file/d/1AbCдEf.../view?usp=sharing`. The site automatically converts these into the embeddable `/preview` format — you don't need to paste `/preview` URLs yourself.
- If you want to rename any column header, update the matching entry in the `COLUMNS` object at the top of `script.js` to match.

### Sheet B — Valid Company License Numbers

A separate sheet with a single column, header **exactly**:

| License Number |
|---|
| ACM10432 |
| ERI00001 |
| BRV77210 |

If you rename this header, update `LICENSE_COLUMN` in `script.js` to match.

---

## 2. Publish both sheets as CSV

For **each** of the two sheets:

1. Open the sheet in Google Sheets.
2. **File → Share → Publish to web**.
3. Under "Link", choose the specific sheet/tab (not "Entire document") if your spreadsheet has multiple tabs.
4. Set the format dropdown to **Comma-separated values (.csv)**.
5. Click **Publish** and confirm.
6. Copy the generated URL — it looks like:
   `https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?output=csv`

Repeat for both sheets. Publishing updates automatically whenever you edit
the sheet, so the site reflects new rows without a redeploy (Google
typically propagates edits within a few minutes).

> **Important — read before publishing:** "Publish to web" makes that
> sheet's data readable by **anyone who has the CSV link**, regardless of
> the in-app license gate. The license check happens in the browser after
> the data is already fetched, so it is a UX gate, not real access control.
> Don't put anything in either sheet you wouldn't want publicly viewable.
> If this is a concern, see "A note on security" below before going live.

---

## 3. Paste the CSV URLs into `script.js`

Open `script.js` and edit the `CONFIG` block at the top:

```js
const CONFIG = {
  RELEASE_NOTES_CSV_URL: "https://docs.google.com/spreadsheets/d/e/PASTE_YOUR_RELEASE_NOTES_PUB_URL/pub?output=csv",
  LICENSE_CSV_URL: "https://docs.google.com/spreadsheets/d/e/PASTE_YOUR_LICENSE_PUB_URL/pub?output=csv",
  SPECIAL_LICENSE: "ERI00001",
  ROWS_PER_PAGE: 10,
  SESSION_KEY: "rnp_license",
};
```

Only the two URLs need to change for a standard setup. Leave the rest as-is
unless you're renaming columns (see `COLUMNS` and `LICENSE_COLUMN` just
below `CONFIG`).

---

## 4. Set Google Drive document permissions

For every document linked in **Internal Doc Link** / **External Doc Link**:

1. Right-click the file in Google Drive → **Share**.
2. Under "General access," set it to **Anyone with the link → Viewer**.

Without this, the inline `/preview` embed will show a "you need permission"
screen instead of the document, even though the license gate passed.

---

## 5. Deploy to GitHub Pages

1. Create a new GitHub repository (or use an existing one) and push these
   four files to it (e.g. to the repo root, or to a `docs/` folder).
2. In the repo, go to **Settings → Pages**.
3. Under "Build and deployment," set **Source** to "Deploy from a branch."
4. Choose the branch (e.g. `main`) and folder (`/root` or `/docs`,
   matching where you put the files), then **Save**.
5. GitHub will give you a URL like `https://your-username.github.io/your-repo/`.
   It can take a minute or two to go live after the first deploy.

That's it — no build step, no server, no environment variables. Any future
edits to the two Google Sheets will show up on the live site automatically.

---

## How it works

- **License gate**: on load, the site shows a single "Company License
  Number" field. On submit, it fetches Sheet B's CSV and checks for a
  case-insensitive match. A match unlocks the portal and stores the
  matched value in `sessionStorage` (cleared when the tab is closed, or via
  the "Sign out" button) so a page refresh doesn't re-prompt mid-session.
- **`ERI00001` rule**: if the stored license equals `ERI00001` exactly, each
  row's "View Doc" cell renders two buttons (Internal / External), each
  opening its own document in the modal, with tabs to switch between them.
  Every other valid license sees a single "View Document" button.
- **Live data**: `script.js` fetches both published CSV URLs with
  [PapaParse](https://www.papaparse.com/) on every page load — no data is
  baked into the repo.
- **Search**: the single search box filters client-side across Release
  Date, Module, Page, Release Type, and Short Notes, live as you type.
- **Pagination**: 10 rows per page, computed after search filtering, with
  numbered page controls.
- **Doc preview**: clicking a doc button opens a modal with an `<iframe>`
  pointed at the Drive file's `/preview` URL — no new tab, no download.

---

## A note on security (read before going live)

This architecture is **client-side only by design**, per the project brief:

- The license gate is a UX/access-convenience feature, not a security
  boundary. Both Google Sheets, once "published to web," are fetchable by
  anyone who has (or guesses/finds) the CSV URL — with or without a valid
  license number.
- Similarly, the license list itself (Sheet B) is visible to anyone who has
  its CSV URL, and Drive documents are viewable by anyone with the link
  (that's required for the `/preview` embed to work at all).

If you need actual access control (not just a friendly gate), you'd need a
minimal backend or serverless function (e.g. Cloudflare Worker / Vercel
function) to proxy the Sheets API with a server-held key and validate
licenses server-side — that's Option B from the brief, extended with an
auth layer, and is a bigger lift than this static-site version. Flag this
tradeoff to your stakeholders before publishing anything sensitive in
either sheet.

---

## Dark / Light theme

A theme toggle (moon/sun icon) sits in the top-right of the gate screen,
the portal header, and the admin header. The choice is saved in
`localStorage` per browser, so it's remembered on the next visit. Dark is
the default.

---

## Admin panel

Any license that matches `CONFIG.SPECIAL_LICENSE` (`ERI00001` by default)
sees an **Admin** button in the portal header. Clicking it asks for a
second factor — the admin password in `CONFIG.ADMIN_PASSWORD` at the top
of `script.js` — before opening the Admin screen.

**Change the default password before you deploy this.** Like the license
gate, this is a client-side UX gate, not real security — anyone who views
`script.js`'s source can read the password. It's there to keep casual
visitors out, not to protect sensitive data.

Inside the Admin screen you get full CRUD over the release notes:

- **Create** — "+ Add release note" opens a form for all seven columns.
- **Read** — the admin table lists every row with its doc-link status.
- **Update** — the edit (pencil) icon reopens the form pre-filled.
- **Delete** — the trash icon asks for confirmation, then removes the row.

### How changes reach `Release_Notes.csv`

This is still a static site with no server, so there's no way for the
browser to silently rewrite a file behind the scenes. Two mechanisms are
used, in this order:

1. **Direct file write (Chrome/Edge desktop):** click **"Connect CSV
   file"** once and pick your local `Release_Notes.csv`. Every
   Create/Update/Delete after that writes straight to the file you picked
   (the File System Access API). Nothing to download or re-upload — just
   save your working copy and push/redeploy when ready.
2. **Auto-download (all other browsers, or if you skip connecting):**
   every change instantly downloads a fresh `Release_Notes.csv`. Replace
   the file in your repo with the download and redeploy to publish the
   change. A status badge in the Admin toolbar always shows which mode is
   active.

Either way, the on-screen table (both Admin and the public portal, if
open in another tab of the same session) updates immediately — the file
write/download is just what makes the change durable and visible to
other users after the next deploy.

---

## Customizing columns

If your sheet's headers don't match the defaults, edit the top of
`script.js`:

```js
const COLUMNS = {
  DATE: "Release Date",
  MODULE: "Module",
  PAGE: "Page",
  TYPE: "Release Type",
  NOTES: "Short Notes",
  DOC_INTERNAL: "Internal Doc Link",
  DOC_EXTERNAL: "External Doc Link",
};

const LICENSE_COLUMN = "License Number";
```

Change the right-hand string values to match your sheet's actual header
text exactly (case-sensitive).
