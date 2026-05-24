import os
import threading
import queue
import asyncio
from fastapi import FastAPI, Request, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from typing import List

import config
import database
import crawler
import applier

app = FastAPI(title="JobForge AI", description="Premium Job Automation Dashboard")

# Global thread-safe queue for WebSocket logs
LOG_QUEUE = queue.Queue()

# Thread-safe logging bridge
def bridge_logger(level, message):
    # Save to SQLite db
    database.add_log(level, message)
    # Push to live queue
    LOG_QUEUE.put({"level": level, "message": message})

# Inject logging bridge into crawler & applier
crawler.add_log = bridge_logger
applier.add_log = bridge_logger

# Directories check
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
static_dir = os.path.join(BASE_DIR, "static")
templates_dir = os.path.join(BASE_DIR, "templates")

# Map static files
app.mount("/static", StaticFiles(directory=static_dir), name="static")
templates = Jinja2Templates(directory=templates_dir)

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

manager = ConnectionManager()

# HTML Root
@app.get("/", response_class=HTMLResponse)
def get_index(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")

# REST Endpoints: Settings
@app.get("/api/settings")
def get_settings():
    return JSONResponse(config.load_settings())

@app.post("/api/settings")
def post_settings(settings: dict):
    config.save_settings(settings)
    return JSONResponse({"success": True})

# REST Endpoints: Profiles
@app.get("/api/profiles")
def get_profiles():
    return JSONResponse(config.list_available_profiles())

@app.get("/api/profiles/active")
def get_active_profile_details():
    return JSONResponse(config.get_active_profile())

@app.post("/api/profiles/active")
def post_active_profile(profile_id: str):
    settings = config.load_settings()
    settings["active_profile"] = profile_id
    config.save_settings(settings)
    p = config.get_active_profile()
    bridge_logger("INFO", f"[System] Profile switched to: '{p.get('name')}' ({p.get('title')})")
    return JSONResponse({"success": True, "profile": p})

# REST Endpoints: Jobs List
@app.get("/api/jobs")
def get_jobs(status: str = None):
    return JSONResponse(database.get_all_jobs(status))

@app.post("/api/update-job-status")
def post_update_job_status(job_id: str, status: str):
    database.update_job_status(job_id, status)
    bridge_logger("INFO", f"[System] Updated Job {job_id} status to '{status}'")
    return JSONResponse({"success": True})

# REST Endpoints: Statistics
@app.get("/api/stats")
def get_stats():
    jobs = database.get_all_jobs()
    scanned = len(jobs)
    matches = len([j for j in jobs if j.get("match_score", 0) >= 80 and j.get("status") == "Matches"])
    applied = len([j for j in jobs if j.get("status") == "Applied"])
    interviews = len([j for j in jobs if j.get("status") == "Interviewing"])
    return JSONResponse({
        "scanned": scanned,
        "matches": matches,
        "applied": applied,
        "interviews": interviews
    })

# REST Endpoints: Console Logs
@app.get("/api/logs")
def get_logs():
    return JSONResponse(database.get_recent_logs(50))

@app.post("/api/logs/clear")
def post_clear_logs():
    database.clear_logs()
    return JSONResponse({"success": True})

# Spawn Crawler Background Thread
def bg_crawler_task():
    try:
        crawler.run_job_search()
    except Exception as e:
        bridge_logger("ERROR", f"[System] Crawler thread crashed: {str(e)}")

@app.post("/api/run-crawler")
def post_run_crawler():
    if crawler.get_crawler_running():
        return JSONResponse({"status": "error", "message": "Crawler is already running."})
    
    # Spawn background thread
    t = threading.Thread(target=bg_crawler_task, daemon=True)
    t.start()
    return JSONResponse({"status": "started"})

@app.post("/api/stop-crawler")
def post_stop_crawler():
    if not crawler.get_crawler_running():
        return JSONResponse({"status": "error", "message": "Crawler is not active."})
    
    crawler.set_crawler_running(False)
    bridge_logger("WARNING", "[System] Dispatched abort signal to browser crawler thread...")
    return JSONResponse({"status": "stopped"})

# Spawn Applier Background Task
def bg_applier_task(job_id: str):
    try:
        applier.run_job_application(job_id)
    except Exception as e:
        bridge_logger("ERROR", f"[System] Applier thread crashed: {str(e)}")

@app.post("/api/run-applier")
def post_run_applier(job_id: str, background_tasks: BackgroundTasks):
    if applier.get_applier_running():
        return JSONResponse({"success": False, "message": "Applier is already executing another job."})
    
    background_tasks.add_task(bg_applier_task, job_id)
    return JSONResponse({"success": True, "message": "Applier dispatched."})

# WebSockets Endpoint for Real-time Log Streams
@app.websocket("/ws/logs")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        # Stream recent historical logs on connect
        recent = database.get_recent_logs(40)
        for log in recent:
            await websocket.send_json({"level": log["level"], "message": log["message"]})
            
        # Drain LOG_QUEUE continuously to active browser clients
        while True:
            await asyncio.sleep(0.1) # yield execution context
            while not LOG_QUEUE.empty():
                try:
                    log_item = LOG_QUEUE.get_nowait()
                    await websocket.send_json(log_item)
                except queue.Empty:
                    break
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"WS Exception: {e}")
        manager.disconnect(websocket)

# Background headed browser session capture task
def bg_session_capture_task():
    import time
    from playwright.sync_api import sync_playwright
    
    settings = config.load_settings()
    chrome_path = settings.get("chrome_profile_path", "").strip()
    
    if not chrome_path:
        bridge_logger("ERROR", "[System] No browser session path configured!")
        return
        
    bridge_logger("INFO", "[System] Booting headed browser session capture panel...")
    bridge_logger("IMPORTANT", "== SECURE ACCOUNT LOGIN INSTRUCTIONS: ==")
    bridge_logger("IMPORTANT", "A Google Chrome window is opening on your desktop.")
    bridge_logger("IMPORTANT", "1. Please log in to your accounts (Naukri.com and LinkedIn.com).")
    bridge_logger("IMPORTANT", "2. Solve any SMS, Email 2FA verification steps or Captchas.")
    bridge_logger("IMPORTANT", "3. Once successfully logged in, simply CLOSE the Chrome browser window manually.")
    bridge_logger("IMPORTANT", "All cookies and sessions will be automatically captured and saved locally!")
    
    try:
        with sync_playwright() as p:
            # Launch persistent headed browser
            browser_context = p.chromium.launch_persistent_context(
                user_data_dir=chrome_path,
                headless=False,
                slow_mo=500,
                args=["--disable-blink-features=AutomationControlled"]
            )
            
            page = browser_context.pages[0] if browser_context.pages else browser_context.new_page()
            page.set_viewport_size({"width": 1280, "height": 800})
            
            bridge_logger("INFO", "[System] Opening LinkedIn login tab...")
            page.goto("https://www.linkedin.com/login", timeout=60000)
            
            bridge_logger("INFO", "[System] Opening Naukri login tab...")
            page2 = browser_context.new_page()
            page2.goto("https://www.naukri.com/nlogin/login", timeout=60000)
            
            bridge_logger("INFO", "[System] Secure links ready. Waiting for manual window close...")
            while len(browser_context.pages) > 0:
                time.sleep(1)
                
            bridge_logger("INFO", "[System] Browser closed. Secure session cookies saved successfully!")
    except Exception as e:
        bridge_logger("ERROR", f"[System] Session capture failed: {str(e)}")

@app.post("/api/sessions/capture")
def post_sessions_capture():
    if crawler.get_crawler_running() or applier.get_applier_running():
        return JSONResponse({"status": "error", "message": "Automation scripts are currently running. Please stop them first!"})
        
    t = threading.Thread(target=bg_session_capture_task, daemon=True)
    t.start()
    return JSONResponse({"status": "started"})

if __name__ == "__main__":
    import uvicorn
    # Pre-populate some demo data on first start to look stunning
    jobs = database.get_all_jobs()
    if len(jobs) == 0:
        # Let's seed two high-fidelity mock matches so Rohit is wowed instantly!
        database.add_job({
            "id": "seed_optum_1",
            "title": "Senior AI & LLM Integration Engineer",
            "company": "Optum Global Solutions",
            "location": "Noida, India",
            "url": "https://www.naukri.com/job-listings-senior-ai-llm-optum",
            "platform": "Naukri",
            "description": "We are seeking a Senior Engineer to lead the design of LLM-based customer analytics solutions. Experience with Python, Flask, RAG architectures, and vector databases like Cosmos or MongoDB Atlas is required.",
            "salary": "25 - 45 LPA",
            "match_score": 95,
            "match_explanation": "Perfect fit! You currently work as a Senior Software Engineer at Optum Global Solutions where you developed SentimentIQ using Claude/GPT-5, implementing RAG and MongoDB Vector embeddings, reducing feedback parsing by 85%. The company and tech stack match 100%.",
            "matched_skills": "Python, Flask, RAG, MongoDB Atlas Vector Search, Prompt Engineering, Claude AI, NLP",
            "missing_skills": "None",
            "cover_letter": "Dear Hiring Manager,\n\nI am writing to express my interest in the Senior AI & LLM Integration Engineer position at Optum Global Solutions. As a Senior Software Engineer currently at Optum, I have engineered our flagship SentimentIQ platform, leveraging Claude and GPT-5 to analyze 20,000+ chats monthly and reducing manual analysis workloads by 85%.\n\nMy deep expertise in RAG, vector embeddings, and semantic searches aligns directly with your goals. I look forward to continuing to drive AI success within the organization.\n\nSincerely,\nRohit Singh",
            "status": "Matches"
        })
        database.add_job({
            "id": "seed_linkedin_2",
            "title": "Lead Generative AI Developer (Remote)",
            "company": "TechForge Labs",
            "location": "Remote, India",
            "url": "https://www.linkedin.com/jobs/view/lead-genai-developer-techforge",
            "platform": "LinkedIn",
            "description": "Looking for a Python/Node full-stack developer with extensive experience building production-grade RAG and AI Capability Dashboards. Must be proficient in TypeScript, LangChain, MySQL, and Kubernetes.",
            "salary": "35 - 55 LPA",
            "match_score": 91,
            "match_explanation": "Excellent alignment! You possess over 4 years of experience and recently built the full-stack AI Capability Dashboard in Node.js, Express, TypeScript, MySQL, and Kubernetes, integrated with Claude AI. You also hold an MTech in CSE from IIT Bhubaneswar.",
            "matched_skills": "Node.js, TypeScript, Express.js, MySQL, Kubernetes, Claude AI, RAG, LangChain, Python",
            "missing_skills": "None",
            "cover_letter": "Dear Hiring Manager,\n\nI am highly enthusiastic about the Lead Generative AI Developer position at TechForge Labs. I am a Senior Software Engineer with a deep specialization in building enterprise AI systems. I recently delivered a full-stack production AI Capability Dashboard in 15 days using TypeScript, Express, MySQL, Kubernetes, and Claude AI.\n\nAdditionally, I hold an MTech in Computer Science from IIT Bhubaneswar and possess 4+ years of backend development excellence. I look forward to contributing to your AI platforms.\n\nSincerely,\nRohit Singh",
            "status": "Matches"
        })
        bridge_logger("INFO", "[System] Seeded initial premium mock job items into SQLite to showcase design system.")

    print("Launching JobForge AI local backend on http://127.0.0.1:8000 ...")
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
