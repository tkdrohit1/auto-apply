import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from pathlib import Path
from dotenv import load_dotenv
import config

# Load .env variables
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

def send_referral_email(to_email: str, subject: str, html_body: str) -> dict:
    """
    Sends a referral email with a PDF resume attachment using SMTP credentials.
    Prioritizes UI settings.json over legacy .env variables.
    """
    settings = config.load_settings()
    
    smtp_host = settings.get("smtp_host") or os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port_str = settings.get("smtp_port") or os.getenv("SMTP_PORT", "465")
    smtp_email = (settings.get("smtp_email") or os.getenv("SMTP_EMAIL", "")).strip()
    smtp_password = (settings.get("smtp_password") or os.getenv("SMTP_PASSWORD", "")).strip()
    resume_path_str = (settings.get("resume_pdf_path") or os.getenv("RESUME_PDF_PATH", "")).strip()

    if not smtp_email or not smtp_password:
        return {
            "success": False, 
            "message": "SMTP credentials are not configured. Please supply Sender Email and App Password in settings."
        }

    try:
        smtp_port = int(smtp_port_str)
    except ValueError:
        smtp_port = 465

    try:
        # Create message container
        msg = MIMEMultipart()
        msg["From"] = smtp_email
        msg["To"] = to_email
        msg["Subject"] = subject

        # Attach html body
        msg.attach(MIMEText(html_body, "html"))

        # Attach PDF Resume if it exists
        has_attachment = False
        if resume_path_str:
            resume_path = Path(resume_path_str)
            if resume_path.exists() and resume_path.is_file():
                filename = resume_path.name
                with open(resume_path, "rb") as attachment:
                    part = MIMEBase("application", "octet-stream")
                    part.set_payload(attachment.read())
                    encoders.encode_base64(part)
                    part.add_header(
                        "Content-Disposition",
                        f"attachment; filename={filename}",
                    )
                    msg.attach(part)
                    has_attachment = True
            else:
                print(f"[Mailer] Resume PDF file not found at: {resume_path_str}")

        # Connect to SMTP Server
        # Check if port is 465 (SSL) or 587 (TLS/starttls)
        if smtp_port == 465:
            server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=15)
        else:
            server = smtplib.SMTP(smtp_host, smtp_port, timeout=15)
            server.starttls()

        server.login(smtp_email, smtp_password)
        server.sendmail(smtp_email, to_email, msg.as_string())
        server.quit()

        attach_msg = " with resume PDF attached" if has_attachment else " (without attachment)"
        return {
            "success": True, 
            "message": f"Successfully sent referral email to {to_email}{attach_msg}."
        }
    except Exception as e:
        return {
            "success": False, 
            "message": f"SMTP dispatch failed: {str(e)}"
        }
