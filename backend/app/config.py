from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    environment: str = "development"
    database_url: str = ""
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    collector_token: str = ""
    model_path: Path = Path("artifacts/model.joblib")
    model_sha256: str = ""
    detection_threshold: float = Field(default=0.90, ge=0.5, le=1)
    minimum_attack_packets: int = Field(default=100, ge=1)
    session_hours: int = Field(default=8, ge=1, le=24)
    openrouter_api_key: str = ""
    openrouter_model: str = "openrouter/free"
    mitigation_enabled: bool = False
    retention_days: int = Field(default=7, ge=1, le=90)
    log_level: str = "INFO"

    @property
    def origins(self) -> list[str]:
        return [origin.strip().rstrip("/") for origin in self.cors_origins.split(",") if origin.strip()]

    @model_validator(mode="after")
    def production_requirements(self):
        if self.collector_token and len(self.collector_token) < 32:
            raise ValueError("COLLECTOR_TOKEN must contain at least 32 characters")
        if self.environment == "production":
            sslmode = parse_qs(urlsplit(self.database_url).query).get("sslmode", [""])[0]
            if not self.database_url or sslmode not in ("require", "verify-ca", "verify-full"):
                raise ValueError("Production requires a TLS-enabled Neon DATABASE_URL")
            if (
                not self.collector_token
                or not self.origins
                or not all(o.startswith("https://") and "*" not in o for o in self.origins)
            ):
                raise ValueError("Production requires COLLECTOR_TOKEN and HTTPS CORS_ORIGINS")
        return self


@lru_cache
def settings() -> Settings:
    return Settings()
