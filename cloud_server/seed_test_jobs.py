import sqlite3
from pathlib import Path
from datetime import datetime

# Path to database
BASE_DIR = Path(__file__).resolve().parent
db_path = BASE_DIR / "data" / "jobs.db"

def seed_self_test_jobs():
    if not db_path.exists():
        print(f"Database not found at {db_path}. Please launch the server first to initialize it.")
        return
        
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    now = datetime.now().isoformat()
    
    # 1. Seed Naukri Self-Test Job
    naukri_job = {
        "id": "test_email_self",
        "title": "Test AI Specialist (Email Self-Test)",
        "company": "Self-Testing Lab",
        "location": "Remote, India",
        "url": "https://www.naukri.com/job-listings-test-email-self",
        "platform": "Naukri",
        "description": "This is a premium self-test job card designed to validate your SMTP mailer dispatch. When you select this card and click 'Send Direct Email Referral', the system will send an email to yourself with your PDF resume attached.",
        "salary": "Self-Test",
        "match_score": 99,
        "match_explanation": "Perfect self-test card! Select this card and click 'Send Direct Email Referral' to trigger SMTP dispatch to your own stashed email address (tkdrohit@gmail.com).",
        "matched_skills": "SMTP Testing, Email Outreach, Resume Delivery, Python, FastAPI",
        "missing_skills": "None",
        "cover_letter": "Self-Test Cover Letter",
        "status": "Matches",
        "hr_email": "tkdrohit@gmail.com",
        "created_at": now,
        "updated_at": now
    }
    
    # 2. Seed LinkedIn Self-Test Job
    linkedin_job = {
        "id": "test_linkedin_self",
        "title": "Test LLM Architect (LinkedIn Referral)",
        "company": "Google",
        "location": "Mountain View, CA",
        "url": "https://www.linkedin.com/jobs/view/test-linkedin-self",
        "platform": "LinkedIn",
        "description": "This is a LinkedIn self-test job card designed to validate the People Referral Flow. When you select this card and click 'Auto-Apply Now', the extension will navigate to Google's people directory, search for recruiters, and draft an invite connection note containing your hosted resume link!",
        "salary": "Self-Test",
        "match_score": 95,
        "match_explanation": "LinkedIn referral flow test! When you select this card and click 'Auto-Apply Now', the extension will navigate to the company's people tab, search for 'Recruiter', look for 1st-degree connections or fallback recruiters, and compose a note for you.",
        "matched_skills": "LinkedIn Networking, People Scraping, Direct Messaging, referral pitches",
        "missing_skills": "None",
        "cover_letter": "Self-Test LinkedIn Note",
        "status": "Matches",
        "hr_email": "",
        "created_at": now,
        "updated_at": now
    }
    
    # Insert or update
    for job in [naukri_job, linkedin_job]:
        cursor.execute('''
        INSERT OR REPLACE INTO jobs (
            id, title, company, location, url, platform, description, salary, 
            match_score, match_explanation, matched_skills, missing_skills, cover_letter,
            status, hr_email, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            job["id"], job["title"], job["company"], job["location"], job["url"], job["platform"],
            job["description"], job["salary"], job["match_score"], job["match_explanation"],
            job["matched_skills"], job["missing_skills"], job["cover_letter"], job["status"],
            job["hr_email"], job["created_at"], job["updated_at"]
        ))
        
    conn.commit()
    conn.close()
    print("Successfully seeded self-test job cards in your database!")

if __name__ == "__main__":
    seed_self_test_jobs()
