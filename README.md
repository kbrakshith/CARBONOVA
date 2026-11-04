# CARBONOVA

**Carbon Footprint Reporting Made Simple.** A web app that guides an Indian MSME from a first electricity bill to a traceable,
BRSR-aligned supplier emissions report, including stage-wise waste for process industries (aluminium, steel, cement, textile, food, foundry, chemicals).

> **Status: working prototype.** Every emission factor is `provisional` until a named reviewer checks it against the original table.
> Reports can be *draft* or *self-declared*. *Internally reviewed* is blocked while any factor is provisional, and *externally assured* can never be set here.
> **AI never produces a number.** All emissions come from a fixed, versioned calculation. Optional Groq AI only suggests or drafts text, and a person confirms it.

---

## Contents

1. [What you need](#1-what-you-need)
2. [Install Node.js](#2-install-nodejs)
3. [Get the code](#3-get-the-code)
4. [Configure (`.env`) and add your Groq key](#4-configure-env-and-add-your-groq-key)
5. [Run the app](#5-run-the-app)
6. [Take the tour](#6-take-the-tour)
7. [Run the tests](#7-run-the-tests)
8. [AI features: what they do and what they never do](#8-ai-features)
9. [Where your data lives (and how to reset it)](#9-where-your-data-lives)
10. [Troubleshooting](#10-troubleshooting)
11. [Project layout](#11-project-layout)
12. [Known limits](#12-known-limits)

---

## 1. What you need

| Need | Why | Check it |
|---|---|---|
| **Node.js 20 or newer** | Runs the server. There are **no npm dependencies**, so there is no `npm install` step | `node --version` |
| **Git** | To clone the repository | `git --version` |
| A modern browser (Chrome, Edge, Firefox, Safari) | The web app | |
| Internet (first load) | Loads the Chart.js script from cdnjs and the Inter font from Google Fonts. Offline, charts fall back to tables and the font falls back to your system font | |
| *(optional)* **Groq API key** | Only for the AI features. Everything else works without it | <https://console.groq.com/keys> |

---

## 2. Install Node.js

### macOS

Pick one.

**Option A: Homebrew (recommended)**

```bash
brew install node
node --version
```

If you do not have Homebrew, install it from <https://brew.sh> first. Or:

**Option B: official installer.** Download the LTS `.pkg` from <https://nodejs.org> and run it.

### Windows 10 / 11

Pick one.

**Option A: winget (PowerShell or Command Prompt)**

```powershell
winget install OpenJS.NodeJS.LTS
```

Close and reopen the terminal, then:

```powershell
node --version
```

**Option B: official installer.** Download the LTS `.msi` from <https://nodejs.org> and keep the default options (make sure *Add to PATH* stays ticked).

Install Git if needed: <https://git-scm.com/download/win> (or `winget install Git.Git`).

> The version must print `v20.x` or higher. If `node` is "not found" after installing, close and reopen the terminal.

---

## 3. Get the code

**macOS (Terminal) and Windows (PowerShell, Command Prompt or Git Bash):**

```bash
git clone https://github.com/kbrakshith/CARBONOVA.git
cd CARBONOVA
```

If your team uses a feature branch, switch to it, for example:

```bash
git checkout feature/carbonova-saas-app
```

(There is nothing to install: the project has no dependencies.)

---

## 4. Configure (`.env`) and add your Groq key

Settings live in a file called `.env` in the project root. It is **git-ignored**, so it is never committed. A template is provided.

### 4.1 Create your `.env`

**macOS / Linux (Terminal):**

```bash
cp .env.example .env
open -e .env        # opens it in TextEdit (or use any editor: nano .env, code .env)
```

**Windows PowerShell:**

```powershell
Copy-Item .env.example .env
notepad .env
```

**Windows Command Prompt:**

```bat
copy .env.example .env
notepad .env
```

### 4.2 Fill it in

```ini
PORT=3000
HOST=127.0.0.1

GROQ_API_KEY=paste_your_key_here
GROQ_MODEL=llama-3.3-70b-versatile
```

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port the app listens on |
| `HOST` | `127.0.0.1` | `127.0.0.1` = only this computer. Use `0.0.0.0` only if you deliberately want other devices on your network to reach it (there is no per-person login, so do not expose it publicly) |
| `GROQ_API_KEY` | empty | Your Groq key. Leave empty to run with AI features disabled |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Any chat model available to your Groq account |
| `AI_TIMEOUT_MS` | `25000` | How long to wait for the AI service |

Rules for the file: no spaces around `=` are needed, quotes are optional, lines starting with `#` are comments. Real environment variables override the file.

### 4.3 Getting a Groq API key

1. Sign in at <https://console.groq.com>.
2. Open **API Keys** and create a key. Copy it once; Groq shows it only at creation.
3. Paste it after `GROQ_API_KEY=` in `.env`. Save the file.

> **Keep the key secret.** Never paste it into the chat, an issue, a screenshot, or a commit. The key is read only by the server and is never sent to the browser. If it leaks, delete it in the Groq console and create a new one.

If you do not want AI, skip this step. Nothing else changes.

---

## 5. Run the app

From the project folder:

```bash
npm start
```

You should see something like:

```
CARBONOVA listening on http://127.0.0.1:3000  (AI: key found, model llama-3.3-70b-versatile)
```

(or `AI: no GROQ_API_KEY, AI features disabled`). Open **<http://127.0.0.1:3000>** in your browser.

To stop it, press `Ctrl + C` in the terminal.

**Run on a different port:**

| Shell | Command |
|---|---|
| macOS / Git Bash | `PORT=4000 npm start` |
| Windows PowerShell | `$env:PORT=4000; npm start` |
| Windows Command Prompt | `set PORT=4000 && npm start` |

(or set `PORT=4000` in `.env`.)

> Restart the server after any change to `.env` or to files under `src/`. Front-end files in `public/` only need a browser refresh.

---

## 6. Take the tour

1. **Easiest first look:** on the welcome page click **Explore with demo data**. It loads a fictional iron-casting unit in Tamil Nadu with two financial years of illustrative bills, fuel, transport and waste, plus three documents waiting for review. All demo figures are made up.
2. **Real use:** click **Start setup** and follow the 8 steps (business, industry and location, reporting year, boundary and facilities, first bill, review, first result). You can leave and come back; progress is saved.
3. **Try the document flow:** Documents → upload a PDF that contains text → check each suggested value (low-confidence ones are highlighted) → tick *I checked it* → **Approve**. The record is created and your totals update.
4. **See a calculation:** My Carbon Footprint → Scope 2 → **Inspect** on any line.
5. **Report:** Reports → **Generate report** (preview, CSV, or print to PDF, version history, reissue with a reason).
6. **AI (optional):** Settings → **AI assistance** → switch it on (needs the key from step 4).

Sample CSV you can import (Documents → upload as *CSV file*):

```csv
type,start,end,quantity,unit,fuel,use,meter
electricity,2026-04-01,2026-04-30,41500,kWh,,,MAIN
fuel,2026-04-01,2026-04-30,180,L,diesel,stationary,
```

---

## 7. Run the tests

```bash
npm test
```

All tests should pass (71 at time of writing): calculation engine, waste module, documents, records, periods, scenarios, AI guardrails (with the network stubbed, so no key or internet is used), API, and front-end modules.

Other checks:

```bash
npm run factors:check            # lists every emission factor and its status
npm run factors:check -- --strict   # exits with an error if any factor is not validated
npm run demo                     # prints the aluminium worked example to the terminal
```

---

## 8. AI features

Turn on per workspace in **Settings → AI assistance** (off by default). The server also needs `GROQ_API_KEY`.

| Feature | Where | Safeguards |
|---|---|---|
| **Suggest missing values** | Documents → review screen | Reads **text only**. Each suggestion must quote the document, and its value must match the quote. Invented values and bad dates are dropped. It never overwrites what the text reader found. Marked **AI suggestion**, confidence 50%, and always needs your *I checked it* before approval |
| **Suggest activity type** | Add activity | Must be one of the known types, otherwise rejected. You still choose and save |
| **Draft report summary** | Generate report | Receives only numbers already in your saved results. **Any other number rejects the draft.** Words like *verified*, *assured*, *compliant* are rejected. Labelled "Drafted with AI assistance" in the report. The tables stay the authoritative figures |

**AI never:** calculates, converts or changes an emission figure, factor or quantity; approves a record or a report; reads scans or photos.

**Privacy:** emails, phone numbers and long account numbers are removed before text is sent to Groq. Do not enable AI if your documents must not leave your organisation.

Errors you may see (all shown as a message, nothing breaks): *not configured* (no key), *switched off for this workspace*, *key rejected*, *rate limited*, *timed out*.

---

## 9. Where your data lives

| What | Path | In git? |
|---|---|---|
| Workspaces (records, runs, reports, audit log) | `data/orgs/*.json` | No (ignored) |
| Uploaded originals | `data/docs/<workspace>/` | No (ignored) |
| Your secrets | `.env` | No (ignored) |
| Optional factor overrides | `data/factors.local.json` (copy from `data/factors.local.example.json`) | No (ignored) |

Your browser stores a small access key per workspace in `localStorage`. **Without it you cannot reopen that workspace**, so use Settings → Account → *Export workspace data* before clearing browser data.

**Start completely fresh** (this deletes all local workspaces and uploaded files):

macOS / Git Bash:

```bash
rm -rf data/orgs data/docs
```

Windows PowerShell:

```powershell
Remove-Item -Recurse -Force data\orgs, data\docs
```

Then clear the site's data in your browser (or open it in a private window).

---

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| `node: command not found` / `'node' is not recognized` | Install Node (section 2), then **close and reopen** the terminal |
| `node --version` is lower than v20 | Upgrade Node (section 2) |
| `EADDRINUSE: address already in use :::3000` | Another program uses the port. Run on another port (section 5) or stop the other program. macOS: `lsof -i :3000`. Windows: `netstat -ano \| findstr :3000` |
| Page is blank, or "Cannot reach the server" | The server is not running. Start it with `npm start` and keep that terminal open |
| `.env` changes have no effect | Restart the server. Make sure the file is named exactly `.env` (Windows may hide a `.txt` extension: in File Explorer enable *View → File name extensions*) |
| Footer says `AI features disabled` | `GROQ_API_KEY` is empty or `.env` is not in the project root |
| AI says *key rejected* | The key is wrong, expired or has extra spaces/quotes. Create a new key in the Groq console |
| AI says *model not found* / error 502 | Set `GROQ_MODEL` to a model your account has access to |
| AI says *switched off for this workspace* | Settings → AI assistance → turn it on |
| Charts show tables and a note | No internet to load Chart.js from cdnjs. Reconnect and refresh; figures remain visible either way |
| A PDF shows "No readable text" | It is a scan. The reader and AI only read text. Type the values from the original |
| "Duplicate" on upload | The same file was already uploaded. Open the existing one |
| Upload rejected as unsupported | Only PDF, PNG, JPG and CSV up to 6 MB, and the file content must match its type |
| PowerShell blocks `npm` ("running scripts is disabled") | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or use Command Prompt or Git Bash instead |
| "Print to PDF" opens nothing | Allow pop-ups for the site, then choose *Save as PDF* in the print dialog |
| Windows line-ending warnings from git | Harmless. Optionally `git config core.autocrlf true` |

---

## 11. Project layout

| Area | Where |
|---|---|
| Config and `.env` loader | `src/config.js` |
| Calculation engine, factor register, periods, scenarios, reduction model | `src/engine/` |
| Industry stage-wise waste (profiles, mass balance, FOD landfill model, routes, BRSR table) | `src/waste/` |
| Document extraction (text layer, CSV) | `src/extract/` |
| AI (Groq client, validated tasks) | `src/ai/`, `src/routes/ai.js` |
| API and storage | `src/server.js`, `src/routes/app.js`, `src/routes/demo.js`, `src/store.js` |
| Reports (HTML to print as PDF, CSV) | `src/report/` |
| Web app: design system, pages, charts | `public/` (`style.css`, `js/ui.js`, `js/pages/*`) |
| PostgreSQL target schema (not wired up) | `db/schema.sql` |
| Method notes and audit mapping | `docs/METHODOLOGY.md`, `docs/WASTE_METHODOLOGY.md`, `docs/AUDIT_TRACEABILITY.md` |
| Tests | `test/` |

Data flow:

```
upload / manual entry --> review (confirm each value) --> approved record --> deterministic engine --> dashboards
                                                                                  |
                                                         saved run + manifest <---+--> report (immutable versions)
```

---

## 12. Known limits

* **Factors are unverified.** The grid factor 0.716 tCO₂/MWh is the proposal's CEA v20 value, not re-checked; CEA now lists a later version that was not read. IPCC values come from the author's knowledge of the 2006 tables. Waste benchmarks are indicative; HWM Schedule I item numbers come from a secondary source. See `docs/METHODOLOGY.md` for how to validate a factor.
* **One access key per workspace**, stored in the browser. No email OTP, per-person login or enforced roles (team roles are recorded only). Do not expose the server to the internet.
* The document reader is a **rule-based text reader, not OCR**. Scanned PDFs and photos need typed values.
* "Download PDF" uses the browser's print dialog; there is no server-side PDF engine.
* Reduction costs and savings use **editable illustrative assumptions**; they are planning estimates.
* Not built: image/PDF OCR, email sending, PostgreSQL wiring, buyer-specific export profiles, base-year recalculation, workspace deletion.
* Accessibility is a WCAG 2.2 AA *target*: automated checks pass, but no screen-reader or full manual audit has been done.
* Not a legal opinion, certification, ISO 14064 verification or BRSR filing.
