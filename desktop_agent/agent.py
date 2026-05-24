import asyncio
import websockets
import json
import threading
import time
import os
import sys
from playwright.sync_api import sync_playwright

# Add current folder to path to ensure local imports work
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import config
import crawler
import applier

# Thread-safe logging bridge builder
def make_ws_logger(websocket, loop):
    def ws_log(level, message):
        print(f"[{level}] {message}")
        try:
            asyncio.run_coroutine_threadsafe(
                websocket.send(json.dumps({
                    "type": "log",
                    "level": level,
                    "message": message
                })),
                loop
            )
        except Exception as e:
            print(f"Failed to transmit websocket log: {e}")
    return ws_log

def run_session_capture(settings, log_callback):
    """
    Launches persistent headed Google Chrome window locally.
    Bypasses Cloud locks and lets the user securely log in to LinkedIn & Naukri.
    """
    chrome_path = settings.get("chrome_profile_path", "").strip()
    
    if not chrome_path:
        log_callback("ERROR", "[System] No browser session path configured!")
        return
        
    log_callback("INFO", "[System] Booting headed browser session capture panel locally...")
    log_callback("IMPORTANT", "== SECURE ACCOUNT LOGIN INSTRUCTIONS: ==")
    log_callback("IMPORTANT", "A Google Chrome window is opening on your desktop.")
    log_callback("IMPORTANT", "1. Please log in to your accounts (Naukri.com and LinkedIn.com).")
    log_callback("IMPORTANT", "2. Solve any SMS, Email 2FA verification steps or Captchas.")
    log_callback("IMPORTANT", "3. Once successfully logged in, simply CLOSE the Chrome browser window manually.")
    log_callback("IMPORTANT", "All cookies and sessions will be automatically captured and saved locally!")
    
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
            
            log_callback("INFO", "[System] Opening LinkedIn login tab...")
            page.goto("https://www.linkedin.com/login", timeout=60000)
            
            log_callback("INFO", "[System] Opening Naukri login tab...")
            page2 = browser_context.new_page()
            page2.goto("https://www.naukri.com/nlogin/login", timeout=60000)
            
            log_callback("INFO", "[System] Secure links ready. Waiting for manual window close...")
            while len(browser_context.pages) > 0:
                time.sleep(1)
                
            log_callback("INFO", "[System] Browser closed. Secure session cookies saved successfully!")
    except Exception as e:
        log_callback("ERROR", f"[System] Session capture failed: {str(e)}")

async def handle_agent_connection():
    uri = "ws://127.0.0.1:8000/ws/agent"
    loop = asyncio.get_event_loop()
    
    while True:
        try:
            print(f"Connecting to Cloud SaaS Gateway at {uri} ...")
            async with websockets.connect(uri) as websocket:
                print("HANDSHAKE SUCCESSFUL: Connected to Cloud SaaS Gateway!")
                
                # Setup basic log bridge for handshake
                logger = make_ws_logger(websocket, loop)
                logger("INFO", "[Desktop Agent] Local agent client handshook and online.")
                
                while True:
                    # Receive actions from Cloud SaaS server
                    message_raw = await websocket.recv()
                    payload = json.loads(message_raw)
                    action = payload.get("action")
                    
                    if action == "START_CRAWLER":
                        logger("INFO", "[Desktop Agent] Start crawler instruction received from SaaS.")
                        config.set_settings(payload.get("settings", {}))
                        
                        def run_crawler_bg():
                            try:
                                crawler.add_log = make_ws_logger(websocket, loop)
                                crawler.run_job_search()
                            except Exception as e:
                                make_ws_logger(websocket, loop)("ERROR", f"[Crawler Thread] Fatal error: {str(e)}")
                                
                        threading.Thread(target=run_crawler_bg, daemon=True).start()
                        
                    elif action == "STOP_CRAWLER":
                        logger("WARNING", "[Desktop Agent] Halt crawler instruction received from SaaS.")
                        crawler.set_crawler_running(False)
                        
                    elif action == "EXECUTE_APPLY":
                        job = payload.get("job", {})
                        logger("INFO", f"[Desktop Agent] Execute application instruction received for job: '{job.get('title')}'")
                        config.set_settings(payload.get("settings", {}))
                        
                        def run_applier_bg():
                            try:
                                applier.add_log = make_ws_logger(websocket, loop)
                                # Stub update status
                                applier.update_job_status = lambda job_id, status: None
                                
                                success = applier.run_job_application(job)
                                
                                # Send result back to SaaS
                                asyncio.run_coroutine_threadsafe(
                                    websocket.send(json.dumps({
                                        "type": "apply_result",
                                        "success": success,
                                        "job_id": job.get("id"),
                                        "job_title": job.get("title")
                                    })),
                                    loop
                                )
                            except Exception as e:
                                make_ws_logger(websocket, loop)("ERROR", f"[Applier Thread] Fatal error: {str(e)}")
                                
                        threading.Thread(target=run_applier_bg, daemon=True).start()
                        
                    elif action == "CAPTURE_SESSION":
                        logger("INFO", "[Desktop Agent] Capture session instruction received from SaaS.")
                        
                        def run_capture_bg():
                            try:
                                run_session_capture(payload.get("settings", {}), make_ws_logger(websocket, loop))
                            except Exception as e:
                                make_ws_logger(websocket, loop)("ERROR", f"[Capture Thread] Fatal error: {str(e)}")
                                
                        threading.Thread(target=run_capture_bg, daemon=True).start()
                        
        except Exception as e:
            print(f"WebSocket client error: {e}. Reconnecting in 5 seconds...")
            await asyncio.sleep(5)

if __name__ == "__main__":
    print("Initializing decoupled JobForge Desktop Agent daemon...")
    try:
        asyncio.run(handle_agent_connection())
    except KeyboardInterrupt:
        print("\nDesktop Agent daemon terminated by user.")
