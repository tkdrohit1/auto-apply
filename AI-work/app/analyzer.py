import logging
import json
import asyncio
from datetime import datetime
from pydantic import BaseModel, Field
from typing import List, Dict, Any
from openai import OpenAI
from sqlalchemy.orm import Session
from app.config import settings
from app.models import Lead, Opportunity, Outreach
from app.database import SessionLocal

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class BusinessAnalysis(BaseModel):
    pain_points: List[str] = Field(description="3-4 repetitive or manual workflows the business is likely struggling with.")
    ai_solutions: List[str] = Field(description="3 custom, low-complexity, high-ROI AI automation systems to solve those pain points.")
    savings_hours: str = Field(description="Estimated weekly hours saved (e.g. '15-20 hours/week').")
    implementation_complexity: str = Field(description="Overall complexity score of the suggested solution: 'Low', 'Medium', or 'High'.")
    priority_score: float = Field(description="Lead priority rating (0.0 to 10.0) based on review volume, website presence, and manual signals.")
    monthly_value: str = Field(description="Potential monthly revenue/savings value to the business (e.g., '$800 - $1,500').")
    
    # Custom high-converting outreach copy
    email_subject: str = Field(description="High-open rate personalized email subject line focusing on time savings.")
    email_body: str = Field(description="Concise, benefit-focused cold email offering the customized MVP solution.")
    whatsapp_body: str = Field(description="A friendly, concise direct message script for WhatsApp outreach.")
    linkedin_body: str = Field(description="A brief, professional networking connection pitch for LinkedIn.")


# Realistic Consulting Templates for high-yield niches (used as Fallback when OpenAI key is missing)
NICHES_FALLBACK_ANALYSIS = {
    "Real Estate": {
        "pain_points": [
            "Manually responding to lead inquiries from Zillow, Realtor.com, and website forms.",
            "Repetitive coordination and scheduling of property viewings with potential buyers.",
            "Manual data entry of client details and listing feedbacks into the CRM (e.g. KVCore)."
        ],
        "ai_solutions": [
            "AI-powered WhatsApp/SMS Lead Qualification Agent to instant-respond and filter buyers.",
            "Autonomous viewing scheduler integrated with Google Calendar and MLS listing details.",
            "CRM Auto-Updater that parses inbound email leads and logs feedback automatically."
        ],
        "savings_hours": "18-22 hours/week",
        "implementation_complexity": "Low",
        "priority_score": 8.8,
        "monthly_value": "$1,200 - $2,500",
        "email_subject": "Automating lead follow-ups for {company_name}",
        "email_body": (
            "Hi {contact_name},\n\n"
            "I noticed that your team at {company_name} is actively managing high-value listings in {city}. "
            "Typically, real estate agencies lose up to 15 hours a week manually qualifying Zillow/website leads and coordinating viewings.\n\n"
            "I built a custom workflow that automates lead qualification and client scheduling on autopilot, "
            "saving about 20 hours/week and ensuring no lead goes cold.\n\n"
            "Would you be open to a quick 5-minute interactive demo customized for {company_name}'s current listings?\n\n"
            "Best regards,\n[Your Name]\nAI Automation Partner"
        ),
        "whatsapp_body": "Hi there! Noticed your listings in {city}. I build simple WhatsApp bots that qualify real estate leads and book viewings automatically on your calendar. Usually saves agents 20 hours/week. Do you have 2 mins for a quick video demo?",
        "linkedin_body": "Hi John, I help real estate agencies in {city} automate lead qualifications and viewings scheduling. Noticed your active listings—would love to share a 2-minute case study on how we save agencies 20 hrs/week."
    },
    "Clinic": {
        "pain_points": [
            "Manual handling of patient booking inquiries, cancellations, and rescheduled visits via phone.",
            "Answering repetitive FAQ queries regarding insurance, hours, doctor availability, and treatment preps.",
            "Manual data entry of intake forms and insurance verification documents into the EHR system."
        ],
        "ai_solutions": [
            "AI Appointment Scheduling Assistant running on Web & WhatsApp to coordinate bookings 24/7.",
            "FAQ Chatbot trained on clinic policies, hours, and insurance parameters.",
            "AI Document OCR & Parser to extract details from patient intake PDFs directly into your records."
        ],
        "savings_hours": "25-30 hours/week",
        "implementation_complexity": "Medium",
        "priority_score": 9.2,
        "monthly_value": "$2,000 - $4,000",
        "email_subject": "Reducing phone call overload at {company_name}",
        "email_body": (
            "Hi {contact_name},\n\n"
            "I was looking at {company_name}'s healthcare offerings in {city}. For clinics, up to 40% of front-desk time is consumed "
            "by simple, repetitive phone inquiries regarding appointment booking, cancellations, and basic FAQs.\n\n"
            "I design simple, HIPAA-friendly AI voice and chat assistants that handle standard bookings and answer FAQs "
            "on your website and WhatsApp 24/7, reducing phone load by up to 60%.\n\n"
            "Would you be open to a brief demo showing how this integrates seamlessly with your booking calendar?\n\n"
            "Best regards,\n[Your Name]\nClinic Automation Expert"
        ),
        "whatsapp_body": "Hello! I help medical and wellness clinics in {city} automate patient scheduling and FAQs using simple, secure web bots. It frees up your front-desk by 20+ hours a week. Can I send a 1-minute preview?",
        "linkedin_body": "Hello, noticed your clinic in {city}. We specialize in building secure AI booking coordinators that handle repetitive patient calls and FAQs, allowing front desk staff to focus on in-person patients. Let's connect!"
    },
    "Accounting": {
        "pain_points": [
            "Chasing clients via email/text to submit monthly receipts, bank statements, and tax documents.",
            "Manual extraction and data entry of invoices, bills, and receipts into accounting tools (QuickBooks/Xero).",
            "Drafting customized financial reports and sending repetitive reminders for tax deadlines."
        ],
        "ai_solutions": [
            "Automated Document Collection Bot that sends personalized follow-ups and links to client portals.",
            "AI OCR Receipt Processor that extracts line-items and auto-categorizes transactions in QuickBooks.",
            "AI Client reporting coordinator that converts monthly sheets into simple plain-text summary emails."
        ],
        "savings_hours": "15-20 hours/week",
        "implementation_complexity": "Medium",
        "priority_score": 8.5,
        "monthly_value": "$1,000 - $2,000",
        "email_subject": "Automating document collection for {company_name} clients",
        "email_body": (
            "Hi {contact_name},\n\n"
            "I noticed {company_name} provides premier financial and accounting services in {city}. "
            "Accounting firms often lose countless billable hours chasing clients for missing receipts and manually entering invoice data.\n\n"
            "I help CPAs implement automated receipt extraction and smart client document collection agents, "
            "slashing manual data entry by 75%.\n\n"
            "I’d love to show you a quick dashboard showing how we parse client folders into transaction entries in 5 seconds.\n\n"
            "Best regards,\n[Your Name]\nFintech Automation Consultant"
        ),
        "whatsapp_body": "Hi! I help accounting firms in {city} eliminate the hassle of chasing clients for documents. I build automated receipt-parsing workflows that hook directly into QuickBooks. Happy to show a quick 2-minute walkthrough!",
        "linkedin_body": "Hi, I help CPAs in {city} automate receipt data-entry and missing document follow-ups. We build simple AI triggers that save staff 15+ hours a week during busy seasons. Would love to share our workflow."
    }
}

DEFAULT_FALLBACK = {
    "pain_points": [
        "Manual client onboarding and repetitive email welcome sequences.",
        "Answering identical customer inquiries regarding pricing, services, and availability.",
        "Updating spreadsheets and CRM contact records manually from lead forms."
    ],
    "ai_solutions": [
        "AI Client Onboarding Workflow that triggers forms, welcome packages, and task assignments.",
        "Interactive FAQ Web Assistant to resolve customer queries instantly.",
        "No-code CRM Integrator that auto-updates and tags contact profiles based on lead actions."
    ],
    "savings_hours": "12-16 hours/week",
    "implementation_complexity": "Low",
    "priority_score": 8.0,
    "monthly_value": "$500 - $1,200",
    "email_subject": "Automating manual operations at {company_name}",
    "email_body": (
        "Hi {contact_name},\n\n"
        "I was checking out {company_name} in {city}. Many growing businesses struggle to scale because "
        "their team gets bogged down in repetitive admin tasks, like manual client follow-ups and data entry.\n\n"
        "I build simple, low-complexity workflow automation systems that take care of these repetitive tasks, "
        "saving your team 15+ hours every single week.\n\n"
        "Would you be open to a quick 5-minute brainstorm on where we can free up your team's time?\n\n"
        "Best regards,\n[Your Name]\nWorkflow Automation Specialist"
    ),
    "whatsapp_body": "Hi! I help businesses in {city} automate repetitive office tasks, like CRM updates and client welcome sequences, saving about 15 hours a week. Got 2 minutes for a quick chat?",
    "linkedin_body": "Hi John, I build automated workflows that take repetitive tasks off your plate (CRM, onboarding, follow-ups). Noticed {company_name}'s great work in {city} and wanted to see if you're exploring AI ops."
}


def get_mock_analysis(lead: Lead) -> Dict[str, Any]:
    """Generates a highly-accurate localized mock analysis for testing."""
    niche_found = "default"
    for niche in NICHES_FALLBACK_ANALYSIS.keys():
        if niche.lower() in lead.niche.lower():
            niche_found = niche
            break
            
    template = NICHES_FALLBACK_ANALYSIS.get(niche_found, DEFAULT_FALLBACK)
    
    # Calculate customized priority score based on rating/reviews
    # Businesses with low ratings OR fewer reviews OR no website have higher automation potential!
    priority = template["priority_score"]
    if not lead.website:
        priority += 0.8
    if lead.rating and lead.rating < 4.0:
        priority += 0.5
    if lead.reviews_count and lead.reviews_count < 15:
        priority += 0.3
        
    priority = round(min(priority, 9.9), 1)

    # Format outreach copies with real business details
    contact_name = "Team"
    company_name = lead.name
    city = lead.city
    
    email_sub = template["email_subject"].format(company_name=company_name, city=city)
    email_body = template["email_body"].format(contact_name=contact_name, company_name=company_name, city=city)
    whatsapp = template["whatsapp_body"].format(contact_name=contact_name, company_name=company_name, city=city)
    linkedin = template["linkedin_body"].format(contact_name=contact_name, company_name=company_name, city=city)
    
    return {
        "pain_points": template["pain_points"],
        "ai_solutions": template["ai_solutions"],
        "savings_hours": template["savings_hours"],
        "implementation_complexity": template["implementation_complexity"],
        "priority_score": priority,
        "monthly_value": template["monthly_value"],
        "email_subject": email_sub,
        "email_body": email_body,
        "whatsapp_body": whatsapp,
        "linkedin_body": linkedin
    }


async def analyze_business_lead(lead_id: int):
    """
    Performs AI opportunity audit on a Lead.
    Uses OpenAI gpt-4o-mini structured output to return detailed pain points, 
    AI solutions, scores, and draft outreaches.
    Falls back gracefully to rich custom mock analysis if OpenAI is disabled/fails.
    """
    db = SessionLocal()
    try:
        lead = db.query(Lead).filter(Lead.id == lead_id).first()
        if not lead:
            logger.error(f"Lead ID {lead_id} not found.")
            return

        logger.info(f"Analyzing lead: {lead.name} ({lead.niche})")

        # Check if OpenAI is enabled
        if settings.is_openai_enabled:
            try:
                # Initialize OpenAI client
                client = OpenAI(api_key=settings.OPENAI_API_KEY)
                
                # Construct context
                website_snippet = lead.website_content[:2000] if lead.website_content else "No website content scraped."
                reviews_snippet = f"Google Rating: {lead.rating} Stars, Reviews Count: {lead.reviews_count}"
                
                system_prompt = (
                    "You are a professional B2B AI Operations Consultant. Your job is to analyze local small businesses, "
                    "find their likely repetitive manual pain points, design 3 simple, high-ROI AI automation MVPs "
                    "(e.g., website chatbot, auto lead responder, document extractor), score their lead priority (0 to 10), "
                    "and write high-converting, personalized cold outreach messages.\n\n"
                    "Focus your pitch on operational time savings, reducing hires, and faster client responses. "
                    "Do NOT sell 'AI hype' or generic buzzwords; sell tangible time savings and business results. "
                    "Keep email and messaging pitches incredibly concise, casual, and highly personalized."
                )
                
                user_prompt = (
                    f"Analyze this business:\n"
                    f"Name: {lead.name}\n"
                    f"Niche: {lead.niche}\n"
                    f"Location: {lead.city}\n"
                    f"Website URL: {lead.website or 'No Website'}\n"
                    f"Scraped Web Content: {website_snippet}\n"
                    f"Google Rating & Reviews: {reviews_snippet}\n\n"
                    f"Please generate a complete audit report and matching cold outreach drafts (email, WhatsApp, LinkedIn) for this business."
                )

                response = client.beta.chat.completions.parse(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    response_format=BusinessAnalysis,
                    temperature=0.7
                )
                
                analysis = response.choices[0].message.parsed
                data = analysis.model_dump()
                
            except Exception as ai_e:
                logger.error(f"OpenAI API call failed: {ai_e}. Falling back to template analysis.")
                data = get_mock_analysis(lead)
        else:
            logger.info("OpenAI API key not provided in .env. Using mock template analysis.")
            await asyncio.sleep(1.5)  # Simulate network latency
            data = get_mock_analysis(lead)

        # Save Opportunity
        # First check if it already exists
        opp = db.query(Opportunity).filter(Opportunity.lead_id == lead.id).first()
        if not opp:
            opp = Opportunity(lead_id=lead.id)
            db.add(opp)
            
        opp.pain_points = data["pain_points"]
        opp.ai_solutions = data["ai_solutions"]
        opp.savings_hours = data["savings_hours"]
        opp.implementation_complexity = data["implementation_complexity"]
        opp.priority_score = data["priority_score"]
        opp.monthly_value = data["monthly_value"]
        opp.analyzed_at = datetime.utcnow()

        # Save Outreach
        outr = db.query(Outreach).filter(Outreach.lead_id == lead.id).first()
        if not outr:
            outr = Outreach(lead_id=lead.id)
            db.add(outr)
            
        outr.email_subject = data["email_subject"]
        outr.email_body = data["email_body"]
        outr.whatsapp_body = data["whatsapp_body"]
        outr.linkedin_body = data["linkedin_body"]
        outr.updated_at = datetime.utcnow()

        # Update lead status
        lead.status = "analyzed"
        db.commit()
        logger.info(f"Successfully analyzed and scored lead {lead.name}.")
        
    except Exception as e:
        logger.error(f"Fatal error in analyze_business_lead: {e}")
    finally:
        db.close()
