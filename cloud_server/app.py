import os
import threading
import queue
import asyncio
from fastapi import FastAPI, Request, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from typing import List, Dict

import config
import database
import ai_matcher

app = FastAPI(title="JobForge Cloud SaaS", description="Decoupled Cloud SaaS Server")

# Global thread-safe queue for Web UI Console logs
LOG_QUEUE = queue.Queue()

# Active Desktop Agent WebSocket connection
active_agent_ws: WebSocket = None

# Thread-safe logging bridge
def bridge_logger(level, message):
    database.add_log(level, message)
    LOG_QUEUE.put({"level": level, "message": message})

# Hook AI Matcher logger to our server console
ai_matcher.add_log = bridge_logger

# Directories check
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
static_dir = os.path.join(BASE_DIR, "static")
templates_dir = os.path.join(BASE_DIR, "templates")

# Mount directories (templates will be served relative to cloud_server)
app.mount("/static", StaticFiles(directory=static_dir), name="static")
templates = Jinja2Templates(directory=templates_dir)

# WebSocket Connection Manager for Web UI Clients
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

ui_manager = ConnectionManager()

# HTML Index
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
    bridge_logger("INFO", "[System] Cloud settings updated and saved.")
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
    bridge_logger("INFO", f"[System] Profile successfully switched to: '{p.get('name')}' ({p.get('title')})")
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

# REST Endpoint: Batch Scraped Job Upload from Desktop Agent!
@app.post("/api/jobs/upload")
def post_upload_jobs(raw_jobs: List[dict], background_tasks: BackgroundTasks):
    """
    Decoupled endpoint called by Desktop Agent.
    Receives raw scraped job descriptions, runs AI Matcher in background Celery-style tasks,
    and saves evaluated entries to DB.
    """
    bridge_logger("INFO", f"[SaaS API] Batch job uploaded: Received {len(raw_jobs)} raw JDs from Local Desktop Agent.")
    
    def process_and_score_jobs():
        for i, r_job in enumerate(raw_jobs):
            try:
                title = r_job.get("title", "Unknown Opportunity")
                company = r_job.get("company", "Unknown Company")
                location = r_job.get("location", "India")
                desc = r_job.get("description", "")
                
                bridge_logger("INFO", f"[AI Matcher] Cloud-scoring job ({i+1}/{len(raw_jobs)}): '{title}' at '{company}'...")
                
                # Execute AI score
                match_res = ai_matcher.evaluate_job(title, company, desc, location)
                
                is_easy_apply = r_job.get("is_easy_apply", True)
                status = "Matches" if is_easy_apply else "External"
                if not is_easy_apply:
                    bridge_logger("INFO", f"[AI Matcher] Job '{title}' at '{company}' requires external company portal application. Storing as status 'External'.")
                
                job_data = {
                    "id": r_job.get("id"),
                    "title": title,
                    "company": company,
                    "location": location,
                    "url": r_job.get("url"),
                    "platform": r_job.get("platform"),
                    "description": desc,
                    "salary": r_job.get("salary", "Not specified"),
                    "match_score": match_res.get("match_score", 0),
                    "match_explanation": match_res.get("explanation", ""),
                    "matched_skills": ", ".join(match_res.get("matched_skills", [])),
                    "missing_skills": ", ".join(match_res.get("missing_skills", [])),
                    "cover_letter": match_res.get("cover_letter", ""),
                    "status": status
                }
                
                database.add_job(job_data)
                
            except Exception as e:
                bridge_logger("ERROR", f"[SaaS API] Error scoring uploaded job item: {str(e)}")
                
        bridge_logger("IMPORTANT", f"[SaaS API] Decoupled batch scoring finished! Successfully evaluated and stored matches in Cloud DB.")
        
    background_tasks.add_task(process_and_score_jobs)
    return JSONResponse({"success": True, "message": "Jobs queue spawned for cloud matching."})

# REST Endpoints: Trigger Scraper & Applier via local agent WebSockets!
@app.post("/api/run-crawler")
async def post_run_crawler():
    global active_agent_ws
    if not active_agent_ws:
        bridge_logger("ERROR", "[WebSocket Gateway] Request blocked: No active Desktop Agent connection established.")
        return JSONResponse({"status": "error", "message": "Desktop Agent is offline. Please launch run_agent.bat!"})
        
    settings = config.load_settings()
    queries = settings.get("search_queries", [])
    locations = settings.get("locations", [])
    max_jobs = settings.get("max_jobs_to_scan", 10)
    
    # Send WebSocket instructions down to local agent
    bridge_logger("INFO", "[WebSocket Gateway] Dispatched run_crawler trigger down to Tauri Desktop Agent...")
    try:
        await active_agent_ws.send_json({
            "action": "START_CRAWLER",
            "queries": queries,
            "locations": locations,
            "max_jobs": max_jobs,
            "settings": settings
        })
        return JSONResponse({"status": "started"})
    except Exception as e:
        bridge_logger("ERROR", f"[WebSocket Gateway] Failed to send socket frame to agent: {str(e)}")
        active_agent_ws = None
        return JSONResponse({"status": "error", "message": "WebSocket gateway connection error."})

@app.post("/api/stop-crawler")
async def post_stop_crawler():
    global active_agent_ws
    if not active_agent_ws:
        return JSONResponse({"status": "error", "message": "No active agent connected."})
        
    bridge_logger("WARNING", "[WebSocket Gateway] Sending crawler halt signal to Desktop Agent...")
    try:
        await active_agent_ws.send_json({"action": "STOP_CRAWLER"})
        return JSONResponse({"status": "stopped"})
    except Exception as e:
        return JSONResponse({"status": "error", "message": f"Halt signal failed: {str(e)}"})

@app.post("/api/run-applier")
async def post_run_applier(job_id: str):
    global active_agent_ws
    if not active_agent_ws:
        bridge_logger("ERROR", "[WebSocket Gateway] Request blocked: Desktop Agent is offline.")
        return JSONResponse({"success": False, "message": "Desktop Agent is offline. Please start run_agent.bat!"})
        
    job = database.get_job_by_id(job_id)
    if not job:
        return JSONResponse({"success": False, "message": f"Job ID {job_id} not found."})
        
    settings = config.load_settings()
    
    bridge_logger("INFO", f"[WebSocket Gateway] Sending execute_apply triggers down to local Playwright agent for job: '{job['title']}'...")
    try:
        await active_agent_ws.send_json({
            "action": "EXECUTE_APPLY",
            "job": job,
            "settings": settings
        })
        return JSONResponse({"success": True, "message": "Applier trigger dispatched."})
    except Exception as e:
        bridge_logger("ERROR", f"[WebSocket Gateway] Applier socket dispatch failed: {str(e)}")
        active_agent_ws = None
        return JSONResponse({"success": False, "message": "WebSocket connection interrupted."})

@app.post("/api/sessions/capture")
async def post_sessions_capture():
    global active_agent_ws
    if not active_agent_ws:
        bridge_logger("ERROR", "[WebSocket Gateway] Request blocked: Desktop Agent is offline.")
        return JSONResponse({"status": "error", "message": "Desktop Agent is offline. Please launch run_agent.bat!"})
        
    bridge_logger("INFO", "[WebSocket Gateway] Dispatched open_sessions login instructions down to Local Agent...")
    try:
        await active_agent_ws.send_json({"action": "CAPTURE_SESSION"})
        return JSONResponse({"status": "started"})
    except Exception as e:
        bridge_logger("ERROR", f"[WebSocket Gateway] Session capture socket dispatch failed: {str(e)}")
        active_agent_ws = None
        return JSONResponse({"status": "error", "message": "WebSocket gateway connection error."})

# ---------------- SEQUENTIAL BULK APPLY QUEUE ----------------
class BulkApplyRequest(BaseModel):
    job_ids: List[str]

APPLY_QUEUE = []
is_bulk_applying = False
apply_finished_event = asyncio.Event()

async def run_next_bulk_apply():
    global is_bulk_applying, active_agent_ws
    if is_bulk_applying:
        return
        
    is_bulk_applying = True
    bridge_logger("IMPORTANT", f"[Queue Manager] Starting bulk-apply processing queue for {len(APPLY_QUEUE)} jobs...")
    
    while APPLY_QUEUE:
        if not active_agent_ws:
            bridge_logger("ERROR", "[Queue Manager] Bulk-apply paused: Chrome Extension is offline.")
            break
            
        job_id = APPLY_QUEUE.pop(0)
        job = database.get_job_by_id(job_id)
        if not job:
            continue
            
        bridge_logger("INFO", f"[Queue Manager] Dispatching next bulk-apply job ({len(APPLY_QUEUE)} remaining): '{job['title']}' at '{job['company']}'...")
        
        apply_finished_event.clear()
        
        try:
            await active_agent_ws.send_json({
                "action": "EXECUTE_APPLY",
                "job": job,
                "settings": config.load_settings()
            })
        except Exception as e:
            bridge_logger("ERROR", f"[Queue Manager] WebSocket dispatch failed: {str(e)}")
            break
            
        try:
            # Wait for apply_result signal (180 seconds timeout)
            await asyncio.wait_for(apply_finished_event.wait(), timeout=180.0)
            bridge_logger("INFO", f"[Queue Manager] Completed job '{job['title']}'. Waiting 6s courtesy cooldown delay...")
            await asyncio.sleep(6.0)
        except asyncio.TimeoutError:
            bridge_logger("WARNING", f"[Queue Manager] Application timeout (180s) reached for job '{job['title']}'. Skipping to next...")
            
    is_bulk_applying = False
    bridge_logger("IMPORTANT", "[Queue Manager] Bulk-apply queue processing completed!")

@app.post("/api/bulk-apply")
async def post_bulk_apply(req: BulkApplyRequest, background_tasks: BackgroundTasks):
    global active_agent_ws
    if not active_agent_ws:
        bridge_logger("ERROR", "[WebSocket Gateway] Bulk-apply request blocked: Extension is offline.")
        return JSONResponse({"success": False, "message": "Chrome Extension is offline. Please load the extension and open dashboard!"})
        
    global APPLY_QUEUE
    APPLY_QUEUE.extend(req.job_ids)
    
    background_tasks.add_task(run_next_bulk_apply)
    bridge_logger("INFO", f"[Queue Manager] Queued {len(req.job_ids)} jobs for sequential bulk application.")
    return JSONResponse({"success": True})

# WebSocket Endpoint 1: Tauri / Local Python Desktop Agent Gateway!
@app.websocket("/ws/agent")
async def websocket_agent_endpoint(websocket: WebSocket):
    global active_agent_ws
    await websocket.accept()
    active_agent_ws = websocket
    bridge_logger("IMPORTANT", "[WebSocket Gateway] HANDSHAKE SUCCESSFUL: Tauri/Python Desktop Agent connected and active in background!")
    
    try:
        while True:
            # Listen for progress statements or responses sent from Desktop Agent
            data = await websocket.receive_json()
            msg_type = data.get("type")
            
            if msg_type == "log":
                # Broadcast agent log frames directly to the Web UI Console!
                bridge_logger(data.get("level", "INFO"), data.get("message", ""))
                
            elif msg_type == "apply_result":
                # Applier results report
                success = data.get("success", False)
                job_id = data.get("job_id")
                job_title = data.get("job_title")
                
                if success:
                    database.update_job_status(job_id, "Applied")
                    bridge_logger("IMPORTANT", f"[WebSocket Gateway] Success report received! Job '{job_title}' successfully moved to Applied.")
                else:
                    bridge_logger("WARNING", f"[WebSocket Gateway] Fail report received! Job '{job_title}' application did not complete successfully.")
                
                # Signal the sequential queue processor!
                apply_finished_event.set()
                    
    except WebSocketDisconnect:
        bridge_logger("WARNING", "[WebSocket Gateway] WARNING: Desktop Agent disconnected. Gateway now inactive.")
        if active_agent_ws == websocket:
            active_agent_ws = None
    except Exception as e:
        print(f"Agent WS exception: {e}")
        if active_agent_ws == websocket:
            active_agent_ws = None

# WebSocket Endpoint 2: Web UI Dashboard Logs Stream
@app.websocket("/ws/logs")
async def websocket_ui_endpoint(websocket: WebSocket):
    await ui_manager.connect(websocket)
    try:
        # Load historical logs on connect
        recent = database.get_recent_logs(40)
        for log in recent:
            await websocket.send_json({"level": log["level"], "message": log["message"]})
            
        while True:
            await asyncio.sleep(0.1)
            while not LOG_QUEUE.empty():
                try:
                    log_item = LOG_QUEUE.get_nowait()
                    await websocket.send_json(log_item)
                except queue.Empty:
                    break
    except WebSocketDisconnect:
        ui_manager.disconnect(websocket)
    except Exception as e:
        print(f"UI WS Exception: {e}")
        ui_manager.disconnect(websocket)

if __name__ == "__main__":
    import uvicorn
    # Seed mock data on boot if DB is empty to showcase stunning dashboard aesthetics
    jobs = database.get_all_jobs()
    if len(jobs) == 0:
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
        bridge_logger("INFO", "[System] Seeded initial premium mock jobs into Cloud Database to display UI system.")
        
    print("Launching decoupled JobForge SaaS Cloud backend on http://127.0.0.1:8000 ...")
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
