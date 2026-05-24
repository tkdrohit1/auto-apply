import os
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

DB_PATH = DATA_DIR / "jobs.db"
SETTINGS_PATH = DATA_DIR / "settings.json"

# Profile Directory Management
PROFILES_DIR = DATA_DIR / "profiles"
PROFILES_DIR.mkdir(exist_ok=True)

def get_active_profile():
    import json
    settings = load_settings()
    active_id = settings.get("active_profile", "rohit_singh")
    profile_path = PROFILES_DIR / f"{active_id}.json"
    
    if not profile_path.exists():
        files = list(PROFILES_DIR.glob("*.json"))
        if files:
            profile_path = files[0]
        else:
            return {}
            
    try:
        with open(profile_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

def list_available_profiles():
    import json
    profiles = []
    for p_file in PROFILES_DIR.glob("*.json"):
        try:
            with open(p_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                profiles.append({
                    "id": data.get("id"),
                    "name": data.get("name"),
                    "title": data.get("title")
                })
        except Exception:
            pass
    return profiles

def save_profile(profile_id, data):
    import json
    profile_path = PROFILES_DIR / f"{profile_id}.json"
    data["id"] = profile_id
    with open(profile_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4)

# Default automation parameters
DEDICATED_SESSION_DIR = DATA_DIR / "sessions" / "default"
DEDICATED_SESSION_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_SETTINGS = {
    "active_profile": "rohit_singh",
    "gemini_api_key": "",
    "gemini_api_key1": "",
    "openai_api_key": "",
    "use_gemini": True,
    "chrome_profile_path": str(DEDICATED_SESSION_DIR),
    "search_queries": [
        "Senior Software Engineer AI",
        "LLM Engineer",
        "Generative AI Developer",
        "Python AI Engineer",
        "LangChain Developer"
    ],
    "locations": ["Noida", "Remote", "Bangalore", "Delhi NCR"],
    "review_mode": True,
    "auto_apply_threshold": 85,
    "max_jobs_to_scan": 15,
    "scraping_delay_min": 2,
    "scraping_delay_max": 5
}

def load_settings():
    import json
    if SETTINGS_PATH.exists():
        try:
            with open(SETTINGS_PATH, 'r') as f:
                saved = json.load(f)
                # Merge with default settings to ensure new keys exist
                settings = DEFAULT_SETTINGS.copy()
                settings.update(saved)
                
                # Self-healing migration: Convert any legacy locked Chrome User Data dir
                # to our new private local sandbox default
                old_default = os.path.join(
                    os.environ.get("USERPROFILE", "C:\\Users\\Rohit"),
                    "AppData", "Local", "Google", "Chrome", "User Data"
                )
                if settings.get("chrome_profile_path") == old_default:
                    settings["chrome_profile_path"] = str(DEDICATED_SESSION_DIR)
                    with open(SETTINGS_PATH, 'w') as sf:
                        json.dump(settings, sf, indent=4)
                        
                return settings
        except Exception:
            return DEFAULT_SETTINGS.copy()
    return DEFAULT_SETTINGS.copy()

def save_settings(settings):
    import json
    with open(SETTINGS_PATH, 'w') as f:
        json.dump(settings, f, indent=4)
