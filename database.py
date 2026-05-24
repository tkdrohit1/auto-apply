import sqlite3
import json
from datetime import datetime
from config import DB_PATH

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Create jobs table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        company TEXT NOT NULL,
        location TEXT,
        url TEXT UNIQUE,
        platform TEXT,
        description TEXT,
        salary TEXT,
        match_score INTEGER DEFAULT 0,
        match_explanation TEXT,
        matched_skills TEXT,
        missing_skills TEXT,
        cover_letter TEXT,
        status TEXT DEFAULT 'Matches',
        created_at TEXT,
        updated_at TEXT
    )
    ''')
    
    # Create logs table for websocket/console logs persistence
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT,
        level TEXT,
        message TEXT
    )
    ''')
    
    conn.commit()
    conn.close()

def add_job(job_data):
    """
    job_data should be a dict containing:
    id, title, company, location, url, platform, description, salary, etc.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    now = datetime.now().isoformat()
    
    try:
        cursor.execute('''
        INSERT INTO jobs (
            id, title, company, location, url, platform, description, salary, 
            match_score, match_explanation, matched_skills, missing_skills, cover_letter,
            status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            title=excluded.title,
            company=excluded.company,
            location=excluded.location,
            description=excluded.description,
            salary=excluded.salary,
            updated_at=?
        ''', (
            job_data.get("id"),
            job_data.get("title"),
            job_data.get("company"),
            job_data.get("location"),
            job_data.get("url"),
            job_data.get("platform"),
            job_data.get("description", ""),
            job_data.get("salary", "Not specified"),
            job_data.get("match_score", 0),
            job_data.get("match_explanation", ""),
            job_data.get("matched_skills", ""),
            job_data.get("missing_skills", ""),
            job_data.get("cover_letter", ""),
            job_data.get("status", "Matches"),
            now,
            now,
            now
        ))
        conn.commit()
        success = True
    except sqlite3.Error as e:
        print(f"Database error: {e}")
        success = False
    finally:
        conn.close()
    return success

def update_job_status(job_id, status):
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    cursor.execute('''
    UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?
    ''', (status, now, job_id))
    conn.commit()
    conn.close()

def update_job_match(job_id, match_score, explanation, matched_skills, missing_skills, cover_letter=""):
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    
    # Convert lists to comma-separated values if passed as lists
    if isinstance(matched_skills, list):
        matched_skills = ", ".join(matched_skills)
    if isinstance(missing_skills, list):
        missing_skills = ", ".join(missing_skills)
        
    cursor.execute('''
    UPDATE jobs SET 
        match_score = ?, 
        match_explanation = ?, 
        matched_skills = ?, 
        missing_skills = ?, 
        cover_letter = ?,
        updated_at = ? 
    WHERE id = ?
    ''', (match_score, explanation, matched_skills, missing_skills, cover_letter, now, job_id))
    conn.commit()
    conn.close()

def get_all_jobs(status_filter=None):
    conn = get_db_connection()
    cursor = conn.cursor()
    if status_filter:
        cursor.execute("SELECT * FROM jobs WHERE status = ? ORDER BY match_score DESC, updated_at DESC", (status_filter,))
    else:
        cursor.execute("SELECT * FROM jobs ORDER BY match_score DESC, updated_at DESC")
    rows = cursor.fetchall()
    conn.close()
    
    # Convert to list of dicts
    jobs = []
    for row in rows:
        jobs.append(dict(row))
    return jobs

def get_job_by_id(job_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    return None

def add_log(level, message):
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    cursor.execute('''
    INSERT INTO logs (timestamp, level, message) VALUES (?, ?, ?)
    ''', (now, level, message))
    conn.commit()
    conn.close()

def get_recent_logs(limit=100):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM logs ORDER BY id DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    conn.close()
    
    logs = []
    for row in reversed(rows): # Reverse so they are chronological
        logs.append(dict(row))
    return logs

def clear_logs():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM logs")
    conn.commit()
    conn.close()

# Initialize on import
init_db()
