from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.schemas.common import ResponseEnvelope, response_envelope
from app.services.b02_exchange import (
    authenticate_b02_request,
    parse_b02_event,
    process_b02_event,
)

router = APIRouter(tags=["B02 Exchange"])


@router.post("/internal/b02/events", response_model=ResponseEnvelope[dict])
async def receive_b02_event(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
    service_id: Annotated[str | None, Header(alias="X-Service-Id")] = None,
    timestamp: Annotated[str | None, Header(alias="X-Timestamp")] = None,
    nonce: Annotated[str | None, Header(alias="X-Nonce")] = None,
    signature: Annotated[str | None, Header(alias="X-Signature")] = None,
) -> dict:
    body = await request.body()
    authenticate_b02_request(
        db,
        settings,
        method=request.method,
        path=request.url.path,
        body=body,
        service_id=service_id,
        timestamp=timestamp,
        nonce=nonce,
        signature=signature,
    )
    event = parse_b02_event(body)
    request.state.trace_id = event.trace_id
    code, data = process_b02_event(db, event, body)
    return response_envelope(data, code=code, trace_id=event.trace_id)
