from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.schemas.common import ResponseEnvelope, response_envelope
from app.schemas.dashboard import AssistantAnswer, AssistantQuery, TranscriptionResult
from app.services.assistant import (
    answer_dashboard_question,
    enforce_assistant_rate_limit,
    require_dashboard_proxy,
    transcribe_audio,
)
from app.services.dashboard import build_dashboard_snapshot

router = APIRouter(tags=["Dashboard Assistant"])

ALLOWED_AUDIO_TYPES = {
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
}


@router.post("/public/assistant/transcriptions", response_model=ResponseEnvelope[TranscriptionResult])
async def create_transcription(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
    audio: Annotated[UploadFile, File()],
) -> dict:
    require_dashboard_proxy(request, settings)
    enforce_assistant_rate_limit(db, request, settings, "transcription")
    content_type = (audio.content_type or "").split(";", 1)[0].lower()
    if content_type not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(status_code=415, detail={"code": "UNSUPPORTED_AUDIO", "message": "仅支持 WebM、Ogg、MP4、WAV 或 MP3 音频"})
    content = await audio.read(settings.assistant_audio_max_bytes + 1)
    await audio.close()
    if not content:
        raise HTTPException(status_code=400, detail={"code": "EMPTY_AUDIO", "message": "录音内容为空"})
    if len(content) > settings.assistant_audio_max_bytes:
        raise HTTPException(status_code=413, detail={"code": "AUDIO_TOO_LARGE", "message": "录音不能超过 5 MiB"})
    result = await transcribe_audio(
        settings,
        filename=audio.filename or "question.webm",
        content_type=content_type,
        content=content,
    )
    return response_envelope(result, trace_id=request.state.trace_id)


@router.post("/public/assistant/query", response_model=ResponseEnvelope[AssistantAnswer])
async def query_dashboard_assistant(
    request: Request,
    payload: AssistantQuery,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    require_dashboard_proxy(request, settings)
    enforce_assistant_rate_limit(db, request, settings, "query")
    snapshot = build_dashboard_snapshot(
        db,
        settings,
        park_id=payload.park_id,
        start_at=payload.start_at,
        end_at=payload.end_at,
    )
    result = await answer_dashboard_question(settings, snapshot, payload.question)
    return response_envelope(result, trace_id=request.state.trace_id)
