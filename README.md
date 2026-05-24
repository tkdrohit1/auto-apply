# 🚀 JobForge AI — Premium Decoupled Hybrid SaaS Platform

JobForge AI is a high-fidelity, state-of-the-art job application automation suite. Designed as a **Decoupled Hybrid SaaS Architecture**, it separates data persistence and heavy AI scoring into a central **Cloud SaaS Server** while leveraging a **Frictionless Chrome Extension Client** to execute direct browser automation natively under your active, logged-in Chrome session. 

This hybrid design eliminates profile directory lock warnings, avoids heavy automated driver downloads, and achieves zero trust friction by automatically inheriting your active session logins on LinkedIn and Naukri.

---

## 🏗️ Technical Architecture Overview

JobForge AI splits the automation pipeline into two lightweight components communicating over highly robust REST and WebSocket channels:

```
+------------------------------------------------------------------------------------------------+
|                                JOBFORGE HYBRID SaaS PLATFORM                                  |
|                                                                                                |
|  +--------------------------------------------------+                                          |
|  |             CLOUD SaaS APP SERVER                |                                          |
|  |  - Serves beautiful glassmorphic dark-theme UI    |                                          |
|  |  - Coordinates active candidate profile swaps     |                                          |
|  |  - Performs AI compatibility scoring (LLMs)      |                                          |
|  +-----------------------+--------------------------+                                          |
|                          ^                                                                     |
|                          | WebSockets / REST API endpoints                                     |
|                          v                                                                     |
|            +-------------+-------------+                                                       |
|            |                           |                                                       |
|  +---------+----------------+  +-------+-------------------+                                   |
|  |  PYTHON DESKTOP DAEMON   |  |     CHROME EXTENSION      |                                   |
|  |  - Spawns local agent    |  | - MV3 Background Worker   |                                   |
|  |  - Controls Playwright   |  | - Direct DOM Form-Filler  |                                   |
|  +--------------------------+  +---------------------------+                                   |
|                                                                                                |
+------------------------------------------------------------------------------------------------+
```

---

## 💎 Features & Upgrades

* **Dynamic Category Segregation Dashboard**: Organize discovered opportunities instantly with tabbed pill navigation:
  * **Strong Matches**: Fits $\ge$ 80% compatibility based on candidate profile resume parameters.
  * **Other Scans**: Discovered matching options scoring $<$ 80% to keep your main dashboard clean.
  * **Applied**: A history tab of all submitted positions.
  * **All Scanned**: View every opportunity stored in your SQLite database.
* **Checkbox Select-All & Multi-Select Controls**: Easily select specific jobs with checkbox toggles and watch a live selection count update on the fly.
* **Apply to All / Apply Selected Bulk Queue**: Click a single button to sequentially queue multiple opportunities! The backend sequential queue processor enqueues jobs, dispatches instructions to the Chrome Extension tab, and waits until the application resolves.
* **Anti-Bot Cooldown Guards**: Features a **6-second courtesy cooling delay** between sequential applications to protect your accounts from aggressive anti-bot triggers.
* **Failsafe Timeout Guards**: Features a **180-second application timeout** so that if a corporate page hangs or has network errors, the queue automatically recovers and skips to the next job.
* **Vanilla CSS Selector Standard Compliance**: Uses robust, standard vanilla CSS selector element lists to query DOMs. This avoids jQuery/Playwright-specific selector crashes (`DOMExceptions`) inside standard browser sandboxes.
* **Ready-Handshake Protocol**: Implements an `APPLIER_READY` handshake message sent from the injected content script back to `background.js` as soon as it mounts. This prevents any race conditions where a trigger message is received before the listener has finished registering.
* **Relative URL Self-Healing**: Automatically heals relative paths (like `/jobs/view/...`) scraped by the crawler by resolving them to absolute HTTPS domains at runtime, resolving Chrome extension access permission blocks.

---

## 📂 Project Directory Structure

```
├── chrome_extension/               # MV3 Chrome Extension Client
│   ├── manifest.json               # Chrome Extension configuration
│   ├── background.js               # Service Worker managing WebSocket client portals
│   ├── content_crawler.js          # Injected listing page crawler & fetcher
│   ├── content_applier.js          # Forms-autofiller & direct DOM injector
│   └── content_keepalive.js        # Port keep-alive preventing service worker suspension
├── cloud_server/                   # Cloud SaaS Server (Backend & Frontend)
│   ├── app.py                      # FastAPI server (Uvicorn gateway)
│   ├── ai_matcher.py               # Generative LLM scoring core
│   ├── config.py                   # Settings database configuration
│   ├── database.py                 # SQLite database helper functions
│   ├── data/                       # Candidate profiles & databases
│   │   ├── jobs.db                 # SQLite database storing matched jobs
│   │   └── profiles/               # Rohit Singh & Suraj Singh JSON resumes
│   ├── templates/                  # Jinja2 Templates (HTML views)
│   │   └── index.html              # Beautiful glassmorphic UI Dashboard
│   └── static/                     # Dark theme styles & client JS
│       ├── css/styles.css          # CSS styles (Glassmorphism & animations)
│       └── js/app.js               # Frontend controller logic
├── requirements.txt                # Python backend dependencies
├── .gitignore                      # Safe Git configuration file
├── run_extension.bat               # Launcher to start cloud server
└── run_cloud.bat                   # Standalone Cloud server launcher
```

---

## 🚀 Setup & Installation

### Step 1: Clone and Set Up the SaaS Backend Server
1. Clone the repository to your desktop.
2. In your terminal, navigate to the project directory and install backend dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Create a `.env` file in the root directory to store your LLM API Keys securely:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   GEMINI_API_KEY1=your_fallback_gemini_api_key_here
   OPENAI_API_KEY=your_openai_api_key_here
   ```

### Step 2: Load the Unpacked Chrome Extension Client
1. Open Google Chrome.
2. Navigate to: **`chrome://extensions`**
3. In the top-right corner, toggle **"Developer Mode"** to **ON**.
4. In the top-left corner, click **"Load unpacked"**.
5. Select the **`chrome_extension`** directory from your cloned workspace:
   `C:\Users\Rohit\Desktop\autoapply\chrome_extension`
6. The extension is now active and ready!

---

## 💻 Running the Platform

### Step 3: Run the Cloud SaaS Dashboard
1. Double-click **`run_extension.bat`** (or `run_cloud.bat`) on your desktop, or execute:
   ```bash
   cd cloud_server
   python app.py
   ```
2. Open Google Chrome and access your SaaS Dashboard at: **`http://localhost:8000`**
3. Observe the green **Automation logs** panel — as soon as the extension finishes loading, you will see a WebSocket handshake confirmation:
   `[IMPORTANT] [WebSocket Gateway] HANDSHAKE SUCCESSFUL: Chrome Extension Client handshook and online!`

---

## 🤖 Zero-Click Bulk Application Guide

1. Log in to **LinkedIn** and **Naukri** normally in your standard Chrome window.
2. Under the **Settings** ⚙️ tab in your dashboard, ensure **"Enable Review Mode"** is unchecked (disabled) to run fully automatic submissions. Click **Save Settings**.
3. Click **Start Search** to crawl jobs. Discovered opportunities will stream live onto your Kanban board and dashboard feed.
4. On the **Strong Matches** tab, click **Apply to All**!
5. Sit back and watch the **Automation Logs** console dynamically manage, open, autofill, submit, and close job applications sequentially, one-by-one automatically!
