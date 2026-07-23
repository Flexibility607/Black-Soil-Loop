from datetime import datetime, timezone
from typing import Generic, Literal, TypeVar
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class ErrorItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_key: str | None = None
    error_code: str
    message: str
    sheet_name: str | None = None
    row_number: int | None = Field(default=None, ge=2)


class ResponseEnvelope(BaseModel, Generic[T]):
    model_config = ConfigDict(extra="forbid")

    status: str
    code: str
    data: T | None = None
    errors: list[ErrorItem] = Field(default_factory=list)
    trace_id: str
    data_cutoff: datetime


class EventRequest(BaseModel, Generic[T]):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"]
    event_id: str = Field(min_length=1, max_length=128)
    object_type: str = Field(min_length=1, max_length=64)
    object_id: str = Field(min_length=1, max_length=255)
    object_version: int = Field(ge=1)
    occurred_at: datetime
    payload: T


def response_envelope(
    data: T | None,
    *,
    status: str = "PROCESSED",
    code: str = "OK",
    trace_id: str | None = None,
    errors: list[ErrorItem] | None = None,
) -> dict:
    return {
        "status": status,
        "code": code,
        "data": data,
        "errors": errors or [],
        "trace_id": trace_id or f"TRACE-{uuid4().hex[:12].upper()}",
        "data_cutoff": datetime.now(timezone.utc),
    }
