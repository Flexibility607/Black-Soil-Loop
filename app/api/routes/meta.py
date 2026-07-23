from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.api.deps import get_current_user
from app.models.user import User
from app.schemas.common import ResponseEnvelope, response_envelope

router = APIRouter(prefix="/meta", tags=["Meta"])

DICTIONARIES = {
    "status": ["ACTIVE", "INACTIVE", "DRAFT", "CONFIRMED", "NOT_STARTED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "EXPIRED"],
    "source_type": ["MANUAL", "FILE", "CALCULATED"],
    "payment_status": ["UNKNOWN", "PAID", "PARTIAL", "UNPAID"],
    "calculation_status": ["OK", "DATA_MISSING", "RULE_MISSING", "INVALID"],
    "currency": ["CNY"],
    "import_batch_status": ["UPLOADED", "PRECHECKING", "READY_TO_CONFIRM", "PRECHECK_FAILED", "IMPORTING", "COMPLETED", "FAILED", "EXPIRED"],
}


@router.get("/dictionaries", response_model=ResponseEnvelope[dict[str, list[str]]])
def dictionaries(request: Request, _: Annotated[User, Depends(get_current_user)]) -> dict:
    return response_envelope(DICTIONARIES, trace_id=request.state.trace_id)

