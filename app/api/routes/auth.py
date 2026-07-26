from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import Settings, get_settings
from app.core.security import create_token, decode_token, verify_password
from app.db.session import get_db
from app.models.user import RevokedToken, User, utc_now
from app.schemas.auth import CurrentUser, LoginRequest, RefreshRequest, TokenPair
from app.schemas.common import ResponseEnvelope, response_envelope

router = APIRouter(prefix="/auth", tags=["Auth"])


def current_user_data(user: User) -> CurrentUser:
    return CurrentUser(
        user_id=user.user_id,
        username=user.username,
        role=user.role,
        park_id=user.park_id,
        enterprise_ids=user.enterprise_ids or [],
    )


def issue_tokens(user: User, settings: Settings) -> TokenPair:
    access_token, _, _ = create_token(
        user,
        "access",
        timedelta(minutes=settings.access_token_expire_minutes),
        settings,
    )
    refresh_token, _, _ = create_token(
        user,
        "refresh",
        timedelta(days=settings.refresh_token_expire_days),
        settings,
    )
    return TokenPair(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.access_token_expire_minutes * 60,
        refresh_expires_in=settings.refresh_token_expire_days * 24 * 60 * 60,
    )


@router.post("/login", response_model=ResponseEnvelope[TokenPair])
def login(
    body: LoginRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    user = db.scalar(
        select(User).where(User.username == body.username, User.is_active.is_(True)).with_for_update()
    )
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail={"code": "UNAUTHENTICATED", "message": "用户名或密码错误"})
    user.session_version += 1
    user.last_login_at = utc_now()
    user.last_activity_at = user.last_login_at
    db.commit()
    return response_envelope(issue_tokens(user, settings).model_dump(), trace_id=request.state.trace_id)


@router.post("/refresh", response_model=ResponseEnvelope[TokenPair])
def refresh(
    body: RefreshRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    try:
        payload = decode_token(body.refresh_token, "refresh", settings)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHENTICATED", "message": "刷新令牌无效或已过期"}) from exc
    if db.get(RevokedToken, payload["jti"]) is not None:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHENTICATED", "message": "刷新令牌已失效"})
    user = db.scalar(select(User).where(User.user_id == payload["sub"], User.is_active.is_(True)))
    if user is None:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHENTICATED", "message": "用户不存在或已停用"})
    if payload.get("session_version") != user.session_version:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHENTICATED", "message": "会话已在其他设备重新登录"})
    if user.last_activity_at is not None:
        last_activity = user.last_activity_at
        if last_activity.tzinfo is None:
            last_activity = last_activity.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) - last_activity > timedelta(minutes=settings.idle_timeout_minutes):
            raise HTTPException(status_code=401, detail={"code": "SESSION_TIMEOUT", "message": "会话已因无操作超时，请重新登录"})
    user.last_activity_at = datetime.now(timezone.utc)
    db.commit()
    return response_envelope(issue_tokens(user, settings).model_dump(), trace_id=request.state.trace_id)


@router.get("/me", response_model=ResponseEnvelope[CurrentUser])
def me(request: Request, user: Annotated[User, Depends(get_current_user)]) -> dict:
    return response_envelope(current_user_data(user).model_dump(), trace_id=request.state.trace_id)


@router.post("/logout", response_model=ResponseEnvelope[dict[str, bool]])
def logout(
    body: RefreshRequest,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    try:
        payload = decode_token(body.refresh_token, "refresh", settings)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHENTICATED", "message": "刷新令牌无效或已过期"}) from exc
    if payload["sub"] != user.user_id:
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": "不能注销其他用户的会话"})
    if payload.get("session_version") != user.session_version:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHENTICATED", "message": "会话已失效"})
    user.session_version += 1
    user.last_activity_at = None
    if db.get(RevokedToken, payload["jti"]) is None:
        db.add(
            RevokedToken(
                jti=payload["jti"],
                expires_at=datetime.fromtimestamp(payload["exp"], timezone.utc),
            )
        )
    db.commit()
    return response_envelope({"logged_out": True}, trace_id=request.state.trace_id)
