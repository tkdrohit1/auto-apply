import datetime
from sqlalchemy import Column, Integer, String, Float, Text, ForeignKey, DateTime, JSON
from sqlalchemy.orm import relationship
from app.database import Base

class SearchQuery(Base):
    __tablename__ = "search_queries"

    id = Column(Integer, primary_key=True, index=True)
    keyword = Column(String, index=True)
    city = Column(String, index=True)
    status = Column(String, default="pending")  # pending, running, completed, failed
    leads_found = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    leads = relationship("Lead", back_populates="search_query", cascade="all, delete-orphan")


class Lead(Base):
    __tablename__ = "leads"

    id = Column(Integer, primary_key=True, index=True)
    search_query_id = Column(Integer, ForeignKey("search_queries.id"), nullable=True)
    name = Column(String, index=True)
    website = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    address = Column(String, nullable=True)
    rating = Column(Float, nullable=True)
    reviews_count = Column(Integer, default=0)
    niche = Column(String, index=True)
    city = Column(String, index=True)
    status = Column(String, default="discovered")  # discovered, crawled, analyzed, approved, contacted, rejected
    website_content = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    search_query = relationship("SearchQuery", back_populates="leads")
    opportunity = relationship("Opportunity", back_populates="lead", uselist=False, cascade="all, delete-orphan")
    outreach = relationship("Outreach", back_populates="lead", uselist=False, cascade="all, delete-orphan")


class Opportunity(Base):
    __tablename__ = "opportunities"

    id = Column(Integer, primary_key=True, index=True)
    lead_id = Column(Integer, ForeignKey("leads.id"), unique=True)
    pain_points = Column(JSON, nullable=True)  # List of strings
    ai_solutions = Column(JSON, nullable=True)  # List of strings
    savings_hours = Column(String, nullable=True)
    implementation_complexity = Column(String, nullable=True)  # Low, Medium, High
    priority_score = Column(Float, default=0.0)
    monthly_value = Column(String, nullable=True)
    analyzed_at = Column(DateTime, default=datetime.datetime.utcnow)

    lead = relationship("Lead", back_populates="opportunity")


class Outreach(Base):
    __tablename__ = "outreach"

    id = Column(Integer, primary_key=True, index=True)
    lead_id = Column(Integer, ForeignKey("leads.id"), unique=True)
    email_subject = Column(String, nullable=True)
    email_body = Column(Text, nullable=True)
    whatsapp_body = Column(Text, nullable=True)
    linkedin_body = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    lead = relationship("Lead", back_populates="outreach")
