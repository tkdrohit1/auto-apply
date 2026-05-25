import os
import logging
from fastapi import FastAPI, Depends, BackgroundTasks, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import List, Optional
from datetime import datetime

from app.config import settings
from app.database import engine, Base, get_db
from app.models import Lead, SearchQuery, Opportunity, Outreach
from app.scraper import scrape_google_maps
from app.analyzer import analyze_business_lead

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize SQLite database tables automatically
logger.info("Initializing database tables...")
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="AI Opportunity Detection & Outreach Engine",
    description="Automated local SMB discovery, AI opportunity audit, lead scoring, and custom outreach manager.",
    version="1.0.0"
)

# Set up directories
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
static_dir = os.path.join(BASE_DIR, "static")
templates_dir = os.path.join(BASE_DIR, "templates")

# Ensure static and templates folders exist
os.makedirs(os.path.join(static_dir, "css"), exist_ok=True)
os.makedirs(os.path.join(static_dir, "js"), exist_ok=True)
os.makedirs(templates_dir, exist_ok=True)

# Mount static files
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Templates
templates = Jinja2Templates(directory=templates_dir)


# API Models
class SearchRequest(BaseModel):
    keyword: str = Field(..., example="Real Estate")
    city: str = Field(..., example="Miami")
    limit: Optional[int] = Field(8, ge=1, le=30)

class StatusUpdateRequest(BaseModel):
    status: str = Field(..., example="approved")

class OutreachSaveRequest(BaseModel):
    email_subject: str
    email_body: str
    whatsapp_body: str
    linkedin_body: str


# Helper serialization utilities
def serialize_lead(lead: Lead) -> dict:
    opp = lead.opportunity
    out = lead.outreach
    return {
        "id": lead.id,
        "name": lead.name,
        "website": lead.website,
        "phone": lead.phone,
        "address": lead.address,
        "rating": lead.rating,
        "reviews_count": lead.reviews_count,
        "niche": lead.niche,
        "city": lead.city,
        "status": lead.status,
        "website_content": lead.website_content,
        "created_at": lead.created_at.isoformat() if lead.created_at else None,
        "opportunity": {
            "pain_points": opp.pain_points if opp else [],
            "ai_solutions": opp.ai_solutions if opp else [],
            "savings_hours": opp.savings_hours if opp else None,
            "implementation_complexity": opp.implementation_complexity if opp else None,
            "priority_score": opp.priority_score if opp else 0.0,
            "monthly_value": opp.monthly_value if opp else None,
            "analyzed_at": opp.analyzed_at.isoformat() if opp and opp.analyzed_at else None
        } if opp else None,
        "outreach": {
            "email_subject": out.email_subject if out else "",
            "email_body": out.email_body if out else "",
            "whatsapp_body": out.whatsapp_body if out else "",
            "linkedin_body": out.linkedin_body if out else "",
            "updated_at": out.updated_at.isoformat() if out and out.updated_at else None
        } if out else None
    }


# Web UI Dashboard Route
@app.get("/", response_class=HTMLResponse)
async def serve_dashboard(request: Request):
    """Renders the main glassmorphic HTML dashboard."""
    return templates.TemplateResponse("dashboard.html", {"request": request, "openai_enabled": settings.is_openai_enabled})


# Rest API Endpoints

@app.post("/api/search")
async def trigger_search(request: SearchRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Triggers an asynchronous background search on Google Maps."""
    # Create search query entry
    query = SearchQuery(
        keyword=request.keyword.strip(),
        city=request.city.strip(),
        status="pending",
        leads_found=0
    )
    db.add(query)
    db.commit()
    db.refresh(query)
    
    # Enqueue background task
    background_tasks.add_task(
        scrape_google_maps,
        keyword=query.keyword,
        city=query.city,
        search_query_id=query.id,
        limit=request.limit
    )
    
    return {
        "status": "enqueued",
        "query_id": query.id,
        "keyword": query.keyword,
        "city": query.city,
        "created_at": query.created_at.isoformat()
    }


@app.get("/api/search/history")
async def get_search_history(db: Session = Depends(get_db)):
    """Returns the list of recent search queries."""
    queries = db.query(SearchQuery).order_by(desc(SearchQuery.created_at)).limit(20).all()
    return [
        {
            "id": q.id,
            "keyword": q.keyword,
            "city": q.city,
            "status": q.status,
            "leads_found": q.leads_found,
            "created_at": q.created_at.isoformat()
        }
        for q in queries
    ]


@app.get("/api/leads")
async def get_leads(db: Session = Depends(get_db)):
    """Fetches all discovered business leads."""
    leads = db.query(Lead).order_by(desc(Lead.created_at)).all()
    return [serialize_lead(lead) for lead in leads]


@app.get("/api/leads/{lead_id}")
async def get_single_lead(lead_id: int, db: Session = Depends(get_db)):
    """Fetches details for a single lead."""
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return serialize_lead(lead)


@app.post("/api/leads/{lead_id}/analyze")
async def trigger_lead_analysis(lead_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Triggers background AI Audit and outreach generation on a single lead."""
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
        
    lead.status = "analyzing"
    db.commit()
    
    background_tasks.add_task(
        analyze_business_lead,
        lead_id=lead_id
    )
    return {"status": "analyzing", "lead_id": lead_id}


@app.post("/api/leads/{lead_id}/update-status")
async def update_lead_status(lead_id: int, request: StatusUpdateRequest, db: Session = Depends(get_db)):
    """Updates the pipeline CRM status of a lead."""
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
        
    valid_statuses = ["discovered", "crawled", "analyzing", "analyzed", "approved", "contacted", "rejected"]
    status_lower = request.status.lower()
    if status_lower not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")
        
    lead.status = status_lower
    db.commit()
    return {"status": "success", "lead_id": lead.id, "new_status": lead.status}


@app.post("/api/leads/{lead_id}/outreach")
async def save_outreach_drafts(lead_id: int, request: OutreachSaveRequest, db: Session = Depends(get_db)):
    """Saves manually edited versions of the AI outreach drafts."""
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
        
    out = db.query(Outreach).filter(Outreach.lead_id == lead_id).first()
    if not out:
        out = Outreach(lead_id=lead_id)
        db.add(out)
        
    out.email_subject = request.email_subject
    out.email_body = request.email_body
    out.whatsapp_body = request.whatsapp_body
    out.linkedin_body = request.linkedin_body
    out.updated_at = datetime.utcnow()
    
    db.commit()
    return {"status": "success", "lead_id": lead_id}


@app.get("/api/stats")
async def get_stats(db: Session = Depends(get_db)):
    """Calculates overall metrics to populate the dashboard stats block."""
    total_leads = db.query(Lead).count()
    analyzed_leads = db.query(Lead).filter(Lead.status.in_(["analyzed", "approved", "contacted"])).count()
    contacted_leads = db.query(Lead).filter(Lead.status == "contacted").count()
    
    # High Priority leads: priority_score >= 8.5
    high_priority = db.query(Lead).join(Opportunity).filter(Opportunity.priority_score >= 8.5).count()
    
    return {
        "total_discovered": total_leads,
        "total_analyzed": analyzed_leads,
        "high_priority": high_priority,
        "contacted": contacted_leads
    }
