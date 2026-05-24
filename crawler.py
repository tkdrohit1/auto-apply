import time
import random
import traceback
import sys
import os
from playwright.sync_api import sync_playwright
from config import load_settings
from database import add_job, add_log
from ai_matcher import evaluate_job

# Flag to signal stopping the crawler
CRAWLER_RUNNING = False

def set_crawler_running(state):
    global CRAWLER_RUNNING
    CRAWLER_RUNNING = state

def get_crawler_running():
    return CRAWLER_RUNNING

def random_delay(settings):
    """Wait for a random human-like delay between steps."""
    delay_min = settings.get("scraping_delay_min", 2)
    delay_max = settings.get("scraping_delay_max", 5)
    sleep_time = random.uniform(delay_min, delay_max)
    time.sleep(sleep_time)

def clean_text(text):
    if not text:
        return ""
    # Normalize whitespaces
    return " ".join(text.split()).strip()

def run_naukri_crawler(page, query, location, max_jobs, settings):
    """Scrapes jobs from Naukri.com using the given search criteria."""
    add_log("INFO", f"[Crawler] Naukri: Searching for '{query}' in '{location}'...")
    
    # Formulate search URL
    query_encoded = query.replace(" ", "-").lower()
    loc_encoded = location.replace(" ", "-").lower()
    search_url = f"https://www.naukri.com/{query_encoded}-jobs-in-{loc_encoded}?k={urllib.parse.quote(query)}"
    
    add_log("INFO", f"[Crawler] Naukri: Navigating to search url...")
    page.goto(search_url, timeout=45000)
    random_delay(settings)
    
    # Wait for the job listing container
    try:
        page.wait_for_selector(".srp-jobtuple", timeout=10000)
    except Exception:
        add_log("WARNING", "[Crawler] Naukri: Job container '.srp-jobtuple' not found. It's possible Naukri has changed its class name. Attempting fallbacks...")
        try:
            page.wait_for_selector("article.jobTuple", timeout=5000)
        except Exception:
            add_log("ERROR", "[Crawler] Naukri: Could not find any job listings. Naukri might be displaying a captcha or verification page.")
            return []

    # Parse job items
    job_tuples = page.query_selector_all(".srp-jobtuple, article.jobTuple")[:max_jobs]
    add_log("INFO", f"[Crawler] Naukri: Found {len(job_tuples)} job postings. Starting deep extraction...")
    
    scraped_jobs = []
    
    for i, jt in enumerate(job_tuples):
        if not CRAWLER_RUNNING:
            add_log("WARNING", "[Crawler] Stopping scraper per user request.")
            break
            
        try:
            # Extract basic details from listing card
            title_el = jt.query_selector("a.title, .title")
            if not title_el:
                continue
            title = clean_text(title_el.inner_text())
            url = title_el.get_attribute("href")
            if url and not url.startswith("http"):
                url = "https://www.naukri.com" + url
            
            # Remove query parameters from URL for clean database ID
            clean_url = url.split("?")[0] if url else ""
            job_id = "naukri_" + clean_url.split("/")[-1].replace(".html", "").split("-")[-1]
            if not job_id:
                job_id = f"naukri_{random.randint(100000, 999999)}"
                
            comp_el = jt.query_selector("a.companyname, a.comp-name-link, .comp-name, .company-name")
            company = clean_text(comp_el.inner_text()) if comp_el else "Unknown Company"
            
            loc_el = jt.query_selector(".locWdth, .location, .loc")
            loc = clean_text(loc_el.inner_text()) if loc_el else location
            
            sal_el = jt.query_selector(".salWdth, .salary, .sal")
            salary = clean_text(sal_el.inner_text()) if sal_el else "Not specified"
            
            # Let's open the job link in a new tab to scrape full description and apply!
            add_log("INFO", f"[Crawler] Naukri ({i+1}/{len(job_tuples)}): Loading job details: '{title}' at '{company}'...")
            
            # open detail page in new tab
            context = page.context
            detail_page = context.new_page()
            detail_page.goto(clean_url, timeout=30000)
            random_delay(settings)
            
            # Scrape full description
            desc_text = ""
            desc_el = detail_page.query_selector(".job-desc, .job-description, .description, #job-desc, section.job-desc")
            if desc_el:
                desc_text = clean_text(desc_el.inner_text())
            else:
                # Try fallback: get all paragraph texts
                paragraphs = detail_page.query_selector_all(".clearBoth p, .dang-art-html p, .details p")
                if paragraphs:
                    desc_text = "\n".join([clean_text(p.inner_text()) for p in paragraphs])
                    
            if not desc_text or len(desc_text) < 100:
                # If we still can't find it, get the body text of the main content box
                body_el = detail_page.query_selector(".leftSec, main, article")
                if body_el:
                    desc_text = clean_text(body_el.inner_text())
            
            detail_page.close()
            
            if not desc_text:
                add_log("WARNING", f"[Crawler] Could not extract description for '{title}'. Using fallback summary.")
                desc_text = f"Job title: {title}. Company: {company}. Location: {loc}. Please see job page for full details."
            
            # Evaluate using AI match maker
            add_log("INFO", f"[AI Matcher] Scoring job match...")
            match_res = evaluate_job(title, company, desc_text, loc)
            
            job_data = {
                "id": job_id,
                "title": title,
                "company": company,
                "location": loc,
                "url": clean_url,
                "platform": "Naukri",
                "description": desc_text,
                "salary": salary,
                "match_score": match_res.get("match_score", 0),
                "match_explanation": match_res.get("explanation", ""),
                "matched_skills": ", ".join(match_res.get("matched_skills", [])),
                "missing_skills": ", ".join(match_res.get("missing_skills", [])),
                "cover_letter": match_res.get("cover_letter", ""),
                "status": "Matches"
            }
            
            # Save to Database
            add_job(job_data)
            scraped_jobs.append(job_data)
            add_log("INFO", f"[Crawler] Naukri Successfully stored '{title}' ({match_res.get('match_score')}% match)")
            
            random_delay(settings)
            
        except Exception as e:
            add_log("ERROR", f"[Crawler] Naukri: Error scraping job item: {str(e)}")
            traceback.print_exc()
            
    return scraped_jobs

def run_linkedin_crawler(page, query, location, max_jobs, settings):
    """Scrapes jobs from LinkedIn using public /guest search or active profile sessions."""
    add_log("INFO", f"[Crawler] LinkedIn: Searching for '{query}' in '{location}'...")
    
    # We can use LinkedIn public guest search which is very fast and doesn't get blocked
    # Or navigate standard search if logged in
    query_encoded = urllib.parse.quote(query)
    loc_encoded = urllib.parse.quote(location)
    
    # Check if we are logged in (indicated by a cookied session on linkedin.com)
    # We navigate to the standard job search page
    search_url = f"https://www.linkedin.com/jobs/search/?keywords={query_encoded}&location={loc_encoded}"
    
    add_log("INFO", f"[Crawler] LinkedIn: Navigating to search page...")
    page.goto(search_url, timeout=45000)
    random_delay(settings)
    
    # Check if redirected to a login wall
    if "authwall" in page.url or "login" in page.url:
        add_log("WARNING", "[Crawler] LinkedIn: Redirected to authwall. Attempting public guest search instead...")
        # Fallback to guest search API page
        search_url = f"https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={query_encoded}&location={loc_encoded}&start=0"
        page.goto(search_url, timeout=30000)
        random_delay(settings)
        
    try:
        # Check standard layout vs guest layout
        page.wait_for_selector(".jobs-search-results-list, .jobs-search__results-list, li", timeout=10000)
    except Exception:
        add_log("ERROR", "[Crawler] LinkedIn: Could not find job listings. LinkedIn might be displaying a captcha or login wall.")
        return []
        
    # Get all job list elements
    job_cards = page.query_selector_all(
        ".jobs-search-results-list__list-item, .jobs-search__results-list li, .base-card, li"
    )[:max_jobs]
    
    add_log("INFO", f"[Crawler] LinkedIn: Found {len(job_cards)} job cards. Scraping details...")
    scraped_jobs = []
    
    for i, card in enumerate(job_cards):
        if not CRAWLER_RUNNING:
            add_log("WARNING", "[Crawler] Stopping scraper per user request.")
            break
            
        try:
            # Parse basic parameters
            title_el = card.query_selector("a.job-card-list__title, a.base-card__full-link, h3, h4 a, a")
            if not title_el:
                continue
            title = clean_text(title_el.inner_text())
            url = title_el.get_attribute("href")
            
            if not url or "linkedin.com/jobs/" not in url:
                continue
                
            clean_url = url.split("?")[0] if url else ""
            job_id = "linkedin_" + clean_url.split("/")[-1].split("?")[0]
            if not job_id:
                job_id = f"linkedin_{random.randint(100000, 999999)}"
                
            comp_el = card.query_selector(".job-card-container__company-name, .base-card__subtitle, h4, .company")
            company = clean_text(comp_el.inner_text()) if comp_el else "Unknown Company"
            
            loc_el = card.query_selector(".job-card-container__metadata-item, .job-search-card__location, .location")
            loc = clean_text(loc_el.inner_text()) if loc_el else location
            
            add_log("INFO", f"[Crawler] LinkedIn ({i+1}/{len(job_cards)}): Loading job details: '{title}' at '{company}'...")
            
            # Navigate to job detail link
            detail_page = page.context.new_page()
            detail_page.goto(clean_url, timeout=30000)
            random_delay(settings)
            
            # Scrape description
            desc_text = ""
            
            # Click "Show more" button if it exists
            show_more_selectors = [
                "button.jobs-description__footer-button",
                "button.show-more-less-html__button",
                "button[aria-label='Show more description']"
            ]
            for selector in show_more_selectors:
                try:
                    btn = detail_page.query_selector(selector)
                    if btn and btn.is_visible():
                        btn.click()
                        time.sleep(1)
                        break
                except Exception:
                    pass
            
            desc_el = detail_page.query_selector(
                ".jobs-description__content, .jobs-box__html-content, .show-more-less-html__markup, .description__text"
            )
            if desc_el:
                desc_text = clean_text(desc_el.inner_text())
            else:
                body_el = detail_page.query_selector("main, article, body")
                if body_el:
                    desc_text = clean_text(body_el.inner_text())
                    
            detail_page.close()
            
            if not desc_text:
                desc_text = f"Job title: {title}. Company: {company}. Location: {loc}. Please visit the LinkedIn page for full details."
            
            # Evaluate using AI match maker
            add_log("INFO", f"[AI Matcher] Scoring job match...")
            match_res = evaluate_job(title, company, desc_text, loc)
            
            job_data = {
                "id": job_id,
                "title": title,
                "company": company,
                "location": loc,
                "url": clean_url,
                "platform": "LinkedIn",
                "description": desc_text,
                "salary": "Not specified",
                "match_score": match_res.get("match_score", 0),
                "match_explanation": match_res.get("explanation", ""),
                "matched_skills": ", ".join(match_res.get("matched_skills", [])),
                "missing_skills": ", ".join(match_res.get("missing_skills", [])),
                "cover_letter": match_res.get("cover_letter", ""),
                "status": "Matches"
            }
            
            add_job(job_data)
            scraped_jobs.append(job_data)
            add_log("INFO", f"[Crawler] LinkedIn Successfully stored '{title}' ({match_res.get('match_score')}% match)")
            
            random_delay(settings)
            
        except Exception as e:
            add_log("ERROR", f"[Crawler] LinkedIn: Error scraping job card: {str(e)}")
            traceback.print_exc()
            
    return scraped_jobs

def run_job_search():
    """Main crawler entry point. Orchestrates the full scraping process."""
    global CRAWLER_RUNNING
    if CRAWLER_RUNNING:
        add_log("WARNING", "[Crawler] Crawler is already running.")
        return
        
    set_crawler_running(True)
    add_log("INFO", "[Crawler] Starting JobForge AI Search Automation Engine...")
    
    settings = load_settings()
    chrome_path = settings.get("chrome_profile_path", "").strip()
    queries = settings.get("search_queries", [])
    locations = settings.get("locations", [])
    max_jobs_per_query = settings.get("max_jobs_to_scan", 10)
    
    if not queries:
        add_log("ERROR", "[Crawler] No search queries specified in settings.")
        set_crawler_running(False)
        return
        
    # We will launch Playwright
    with sync_playwright() as p:
        browser_context = None
        fallback_mode = False
        
        # Attempt to launch with your custom Chrome user profile
        if chrome_path and os.path.exists(chrome_path):
            add_log("INFO", f"[Crawler] Attempting to hook into local Chrome profile: {chrome_path}...")
            try:
                # On Windows, you can connect directly to their installed Chrome using channel="chrome"
                browser_context = p.chromium.launch_persistent_context(
                    user_data_dir=chrome_path,
                    channel="chrome",
                    headless=False, # Must be False so they can bypass captcha if needed
                    slow_mo=1000,
                    args=["--disable-blink-features=AutomationControlled"]
                )
                add_log("INFO", "[Crawler] Handshake successful! Google Chrome session hooked.")
            except Exception as e:
                # Usually fails if Chrome is currently open on their desktop due to profile locking
                add_log("WARNING", (
                    f"[Crawler] Profile Lock Warning: Google Chrome is currently open on your system, "
                    f"locking the directory: '{chrome_path}'."
                ))
                add_log("WARNING", "[Crawler] Playwright CANNOT access your active logins unless you close all Chrome windows.")
                add_log("WARNING", "[Crawler] Falling back to a clean, isolated Chromium session...")
                fallback_mode = True
        else:
            add_log("WARNING", "[Crawler] No valid local Chrome profile path found. Launching a clean private browser session...")
            fallback_mode = True
            
        if fallback_mode:
            try:
                # Launch clean isolated chromium
                browser = p.chromium.launch(
                    headless=False,
                    slow_mo=1000,
                    args=["--disable-blink-features=AutomationControlled"]
                )
                browser_context = browser.new_context()
                add_log("INFO", "[Crawler] Clean private browser started successfully.")
            except Exception as ex:
                add_log("ERROR", f"[Crawler] Browser Launch Fatal Error: {str(ex)}")
                set_crawler_running(False)
                return
                
        # Scraper Loop
        try:
            page = browser_context.pages[0] if browser_context.pages else browser_context.new_page()
            
            # Set stealth headers
            page.set_extra_http_headers({
                "Accept-Language": "en-US,en;q=0.9",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            })
            
            scraped_total = 0
            
            for location in locations:
                for query in queries:
                    if not CRAWLER_RUNNING:
                        break
                        
                    # Naukri search
                    try:
                        n_jobs = run_naukri_crawler(page, query, location, max_jobs_per_query, settings)
                        scraped_total += len(n_jobs)
                    except Exception as e:
                        add_log("ERROR", f"[Crawler] Naukri crawling failed for '{query}': {str(e)}")
                        
                    # LinkedIn search
                    if not CRAWLER_RUNNING:
                        break
                    try:
                        l_jobs = run_linkedin_crawler(page, query, location, max_jobs_per_query, settings)
                        scraped_total += len(l_jobs)
                    except Exception as e:
                        add_log("ERROR", f"[Crawler] LinkedIn crawling failed for '{query}': {str(e)}")
                        
            add_log("INFO", f"[Crawler] Search automation completed. Successfully scanned & matched {scraped_total} opportunities!")
            
        except Exception as e:
            add_log("ERROR", f"[Crawler] Fatal crash inside crawler sequence: {str(e)}")
            traceback.print_exc()
        finally:
            # Clean up
            try:
                browser_context.close()
            except Exception:
                pass
            set_crawler_running(False)

# Add support for url parsing
import urllib.parse
