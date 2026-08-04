from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "B01 Web Backend"
    environment: str = "development"
    database_url: str
    jwt_secret: str = Field(default="dev-only-change-this-secret-use-32-bytes", min_length=32)
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 120
    refresh_token_expire_days: int = 7
    idle_timeout_minutes: int = 30
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ]
    default_dashboard_park_id: str | None = None
    demo_data_enabled: bool = False
    dashboard_service_token: str | None = None
    b02_to_b01_shared_secret: str = Field(
        default="development-b02-shared-secret-change-me",
        min_length=16,
    )
    service_signature_tolerance_seconds: int = Field(default=300, ge=30, le=900)
    b02_max_body_bytes: int = Field(default=1024 * 1024, ge=1024, le=5 * 1024 * 1024)
    openai_api_key: str | None = None
    openai_base_url: str = "https://api.openai.com/v1"
    openai_chat_model: str = "gpt-5.6-terra"
    openai_transcription_model: str = "gpt-transcribe"
    assistant_transcription_limit_per_minute: int = Field(default=6, ge=1, le=120)
    assistant_query_limit_per_minute: int = Field(default=12, ge=1, le=240)
    assistant_audio_max_bytes: int = Field(default=5 * 1024 * 1024, ge=1024)
    assistant_audio_max_seconds: int = Field(default=30, ge=1, le=120)

    @model_validator(mode="after")
    def reject_weak_production_secrets(self):
        if self.environment.lower() in {"production", "prod"}:
            weak_b02 = (
                len(self.b02_to_b01_shared_secret) < 32
                or self.b02_to_b01_shared_secret.startswith("development-")
                or "change-me" in self.b02_to_b01_shared_secret
            )
            if weak_b02:
                raise ValueError("B02_TO_B01_SHARED_SECRET must be a strong production secret")
            if not self.dashboard_service_token or len(self.dashboard_service_token) < 24:
                raise ValueError("DASHBOARD_SERVICE_TOKEN must be configured in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
