from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.security import decode_token
from app.db.session import get_db
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=False)


def authentication_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"code": "UNAUTHENTICATED", "message": "请先登录或重新登录"},
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    if credentials is None:
        raise authentication_error()
    try:
        payload = decode_token(credentials.credentials, "access", settings)
    except ValueError as exc:
        raise authentication_error() from exc
    user = db.scalar(select(User).where(User.user_id == payload["sub"], User.is_active.is_(True)))
    if user is None:
        raise authentication_error()
    if payload.get("session_version") != user.session_version:
        raise authentication_error()
    now = datetime.now(timezone.utc)
    if user.last_activity_at is not None:
        last_activity = user.last_activity_at
        if last_activity.tzinfo is None:
            last_activity = last_activity.replace(tzinfo=timezone.utc)
        if now - last_activity > timedelta(minutes=settings.idle_timeout_minutes):
            raise authentication_error()
    user.last_activity_at = now
    db.commit()
    return user
