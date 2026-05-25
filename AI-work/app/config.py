import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

class Config:
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
    DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./leads.db").strip()
    PORT = int(os.getenv("PORT", "8000"))
    
    @property
    def is_openai_enabled(self) -> bool:
        return bool(self.OPENAI_API_KEY)

settings = Config()
