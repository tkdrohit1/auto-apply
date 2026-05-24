import json
import urllib.request
import urllib.error
import re
from config import get_active_profile, load_settings
from database import add_log

def clean_json_response(text):
    """Extracts JSON block from AI output in case it contains markdown formatting."""
    match = re.search(r'```json\s*(.*?)\s*```', text, re.DOTALL)
    if match:
        return match.group(1).strip()
    match = re.search(r'```\s*(.*?)\s*```', text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return text.strip()

def analyze_job_heuristically(active_profile, job_title, company, description, location):
    """
    Fallback Heuristic engine. Computes a similarity score and identifies skills
    using rule-based matching against the actively loaded user profile.
    """
    description_lower = description.lower()
    job_title_lower = job_title.lower()
    
    # 1. Dynamically extract all skills from active profile
    profile_skills = []
    skills_obj = active_profile.get("skills", {})
    if isinstance(skills_obj, dict):
        for cat, items in skills_obj.items():
            profile_skills.extend([i.strip() for i in items])
    elif isinstance(skills_obj, list):
        profile_skills.extend([i.strip() for i in skills_obj])
        
    # Standard tech keywords mapping to check
    matched = []
    missing = []
    
    # Check what profile skills match the job description
    for skill in profile_skills:
        skill_lower = skill.lower()
        # Word boundary or inclusion match
        if re.search(r'\b' + re.escape(skill_lower) + r'\b', description_lower) or re.search(r'\b' + re.escape(skill_lower) + r'\b', job_title_lower):
            if skill not in matched:
                matched.append(skill)
                
    # 2. Score calculation
    score = 50 # Base score
    
    # Check title overlap
    profile_title = active_profile.get("title", "").lower()
    title_words = [w for w in profile_title.split() if len(w) > 3]
    title_matches = 0
    for tw in title_words:
        if tw in job_title_lower:
            title_matches += 1
            
    if title_matches >= 2:
        score += 20
    elif title_matches >= 1:
        score += 10
        
    # Check senior alignment
    is_profile_senior = "senior" in profile_title or "sr" in profile_title or "lead" in profile_title
    is_job_senior = "senior" in job_title_lower or "sr" in job_title_lower or "lead" in job_title_lower
    
    if is_profile_senior == is_job_senior:
        score += 10
    elif is_profile_senior and not is_job_senior:
        # If user is senior, applying to junior roles is fine but slight penalty for fit
        if "junior" in job_title_lower or "intern" in job_title_lower:
            score -= 15
            
    # Skill overlap points
    tech_overlap = len(matched)
    score += min(tech_overlap * 3, 20)
    score = max(30, min(97, score))
    
    # Identify potential missing skills heuristically
    common_jds = ["aws", "gcp", "azure", "kubernetes", "docker", "typescript", "react", "c#", "dotnet", "postgresql", "sap", "opc"]
    for kw in common_jds:
        if kw in description_lower:
            # Check if active profile lacks it
            has_kw = False
            for s in profile_skills:
                if kw in s.lower():
                    has_kw = True
                    break
            if not has_kw:
                missing.append(kw.upper() if len(kw) < 4 else kw.capitalize())
                
    # 3. Dynamic explanation builder
    skills_str = ", ".join(matched[:4])
    explanation = (
        f"This position matches {active_profile.get('name')}'s profile as a {active_profile.get('title')}. "
        f"There is a core skill overlap including {skills_str or 'Software Development frameworks'}. "
    )
    if active_profile.get("experience"):
        comp = active_profile["experience"][0].get("company", "previous employers")
        explanation += f"Alignment is supported by professional experience at {comp}."
        
    if missing:
        explanation += f" Note: Job lists skills like {', '.join(missing[:3])} which are not prominent in the active profile."
        
    # 4. Dynamic template cover letter
    exp_summary = ""
    if active_profile.get("experience"):
        first_exp = active_profile["experience"][0]
        exp_summary = f"At {first_exp.get('company')}, I work as a {first_exp.get('role')} executing technical shop-floor workflows and systems engineering."
        
    edu_summary = ""
    if active_profile.get("education"):
        first_edu = active_profile["education"][0]
        edu_summary = f"I hold a {first_edu.get('degree')} in {first_edu.get('specialization')} from {first_edu.get('institution')}."
        
    cover_letter = (
        f"Dear Hiring Manager,\n\n"
        f"I am writing to express my strong interest in the {job_title} position at {company}.\n\n"
        f"With over 4 years of experience as a {active_profile.get('title')} specializing in backend architectures and industrial systems integrations, "
        f"I am confident in my ability to drive engineering excellence in your team. {exp_summary} {edu_summary}\n\n"
        f"My technical stack overlaps closely with your requirements: {', '.join(matched[:6]) or 'Software engineering principles'}. "
        f"I am highly motivated to bring my specialized backend competencies and engineering methodologies to {company}.\n\n"
        f"Thank you for your time and consideration. I look forward to discussing how my experience can benefit your team.\n\n"
        f"Sincerely,\n"
        f"{active_profile.get('name')}\n"
        f"{active_profile.get('contact', {}).get('email')} | {active_profile.get('contact', {}).get('phone')}"
    )
    
    return {
        "match_score": int(score),
        "matched_skills": matched,
        "missing_skills": missing,
        "explanation": explanation,
        "cover_letter": cover_letter
    }

def _call_gemini_api(api_key, active_profile, job_title, company, description, location):
    """Executes a single raw HTTP POST request to the Google Gemini API."""
    prompt = f"""
You are an expert AI Recruiting Assistant and Job Matching Matcher. Your task is to analyze the following job description against the resume profile of the candidate and provide a structured assessment in raw JSON format.

CANDIDATE'S RESUME PROFILE:
{json.dumps(active_profile, indent=2)}

JOB TO ANALYZE:
Title: {job_title}
Company: {company}
Location: {location}
Description:
{description}

Instructions:
Evaluate the job against the candidate's background. Calculate a compatibility match score (0 to 100). Identify matched skills, missing key requirements, a detailed explanation of alignment, and draft a high-converting personalized short cover letter.

Return ONLY a valid JSON object matching the following structure exactly, with no additional explanation or markdown formatting:
{{
  "match_score": 85,
  "matched_skills": ["C#", "OPC UA", ".NET"],
  "missing_skills": ["React"],
  "explanation": "Brief explanation of alignment and suitability.",
  "cover_letter": "Short, personalized cover letter ready to send."
}}
"""

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
    data = {
        "contents": [{
            "parts": [{
                "text": prompt
            }]
        }],
        "generationConfig": {
            "responseMimeType": "application/json"
        }
    }
    
    req_body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=req_body,
        headers={"Content-Type": "application/json"}
    )
    
    with urllib.request.urlopen(req, timeout=15) as response:
        res_body = response.read().decode("utf-8")
        res_json = json.loads(res_body)
        content_text = res_json['candidates'][0]['content']['parts'][0]['text']
        cleaned_text = clean_json_response(content_text)
        parsed_result = json.loads(cleaned_text)
        
        for key in ["match_score", "matched_skills", "missing_skills", "explanation", "cover_letter"]:
            if key not in parsed_result:
                raise KeyError(f"Missing key: {key}")
                
        return parsed_result

def analyze_job_with_gemini(api_key, fallback_key, active_profile, job_title, company, description, location):
    """Calls Google Gemini API for job scoring, supporting a primary and a fallback key (exhaust lock)."""
    # 1. Try Primary Key
    if api_key:
        try:
            res = _call_gemini_api(api_key, active_profile, job_title, company, description, location)
            add_log("INFO", f"[AI Matcher] Gemini (Primary Key) successfully scored '{job_title}' at {company}: {res['match_score']}%")
            return res
        except Exception as e:
            add_log("WARNING", f"[AI Matcher] Primary Gemini Key exhausted or failed: {str(e)}.")
            
    # 2. Try Fallback Key
    if fallback_key:
        add_log("INFO", f"[AI Matcher] Attempting fallback Gemini API Key (GEMINI_API_KEY1)...")
        try:
            res = _call_gemini_api(fallback_key, active_profile, job_title, company, description, location)
            add_log("INFO", f"[AI Matcher] Gemini (Fallback Key) successfully scored '{job_title}' at {company}: {res['match_score']}%")
            return res
        except Exception as e2:
            add_log("ERROR", f"[AI Matcher] Fallback Gemini Key also exhausted or failed: {str(e2)}.")
            
    # 3. Fallback Heuristic
    add_log("WARNING", "[AI Matcher] Moving to local heuristic alignment engine fallback.")
    return analyze_job_heuristically(active_profile, job_title, company, description, location)

def analyze_job_with_openai(api_key, active_profile, job_title, company, description, location):
    """Calls OpenAI API for semantic job scoring and cover letter generation."""
    prompt = f"""
You are an expert AI Recruiting Assistant. Analyze the following job description against the resume profile of the candidate and return a JSON assessment.

CANDIDATE'S RESUME:
{json.dumps(active_profile)}

JOB:
Title: {job_title}
Company: {company}
Location: {location}
Description:
{description}

Return ONLY a valid JSON object matching the following structure:
{{
  "match_score": 85,
  "matched_skills": ["C#", "SQL"],
  "missing_skills": ["Angular"],
  "explanation": "Alignment explanation.",
  "cover_letter": "Short, professional cover letter."
}}
"""

    url = "https://api.openai.com/v1/chat/completions"
    data = {
        "model": "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": "You are a professional recruiting scoring tool that outputs raw JSON."},
            {"role": "user", "content": prompt}
        ],
        "response_format": {"type": "json_object"}
    }
    
    req_body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=req_body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        }
    )
    
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            res_body = response.read().decode("utf-8")
            res_json = json.loads(res_body)
            content_text = res_json['choices'][0]['message']['content']
            parsed_result = json.loads(content_text)
            add_log("INFO", f"[AI Matcher] OpenAI successfully scored '{job_title}' at {company}: {parsed_result['match_score']}%")
            return parsed_result
    except Exception as e:
        add_log("WARNING", f"[AI Matcher] OpenAI call failed: {str(e)}. Falling back to heuristic matching.")
        return analyze_job_heuristically(active_profile, job_title, company, description, location)

def evaluate_job(job_title, company, description, location):
    """Orchestrates job evaluation choosing between configured LLM API and Heuristic Fallback."""
    settings = load_settings()
    active_profile = get_active_profile()
    
    gemini_key = settings.get("gemini_api_key", "").strip()
    gemini_key1 = settings.get("gemini_api_key1", "").strip()
    openai_key = settings.get("openai_api_key", "").strip()
    use_gemini = settings.get("use_gemini", True)
    
    if use_gemini and (gemini_key or gemini_key1):
        return analyze_job_with_gemini(gemini_key, gemini_key1, active_profile, job_title, company, description, location)
    elif not use_gemini and openai_key:
        return analyze_job_with_openai(openai_key, active_profile, job_title, company, description, location)
    else:
        # Fallback to local heuristic parser
        return analyze_job_heuristically(active_profile, job_title, company, description, location)
