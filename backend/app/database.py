import secrets

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://wfh:wfh@localhost:5432/wfh_assessment"
    monthly_wfh_limit: int = 5
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:3b"
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from: str = "wfh-requests@localhost"
    jwt_secret: str = Field(default_factory=lambda: secrets.token_urlsafe(32))
    jwt_expiry_minutes: int = 480
    bootstrap_key: str | None = None

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
