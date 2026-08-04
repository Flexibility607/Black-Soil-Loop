import hashlib
import json
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.dashboard import AssistantRateWindow
from app.schemas.dashboard import (
    AssistantAnswer,
    DashboardSnapshot,
    TranscriptionResult,
)

TOOL_NAMES = ("overview", "channel_mix", "daily_trend", "third_spaces")


def require_dashboard_proxy(request: Request, settings: Settings) -> None:
    if settings.dashboard_proxy_token is None:
        return
    supplied = request.headers.get("X-Dashboard-Token")
    if supplied != settings.dashboard_proxy_token:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHENTICATED", "message": "大屏代理令牌无效"})


def enforce_assistant_rate_limit(db: Session, request: Request, settings: Settings, route: str) -> None:
    source = (
        request.headers.get("CF-Connecting-IP")
        or request.headers.get("X-Forwarded-For", "").split(",", 1)[0].strip()
        or (request.client.host if request.client else "unknown")
    )
    salt = settings.dashboard_proxy_token or settings.b02_to_b01_shared_secret
    client_hash = hashlib.sha256(f"{salt}:{source}".encode()).hexdigest()
    now = datetime.now(timezone.utc)
    window = now.replace(second=0, microsecond=0)
    record = db.get(AssistantRateWindow, {"client_hash": client_hash, "window_started_at": window})
    if record is None:
        record = AssistantRateWindow(
            client_hash=client_hash,
            window_started_at=window,
            request_count=0,
            last_request_at=now,
            route=route,
        )
        db.add(record)
    if record.request_count >= settings.assistant_request_limit_per_minute:
        raise HTTPException(status_code=429, detail={"code": "RATE_LIMITED", "message": "语音助手请求过于频繁，请稍后再试"})
    record.request_count += 1
    record.last_request_at = now
    record.route = route
    db.commit()


async def transcribe_audio(
    settings: Settings,
    *,
    filename: str,
    content_type: str,
    content: bytes,
) -> TranscriptionResult:
    if not settings.openai_api_key:
        raise HTTPException(status_code=503, detail={"code": "AI_NOT_CONFIGURED", "message": "语音识别服务尚未配置"})
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{settings.openai_base_url.rstrip('/')}/audio/transcriptions",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                data={"model": settings.openai_transcribe_model, "language": "zh", "response_format": "json"},
                files={"file": (filename, content, content_type)},
            )
            response.raise_for_status()
            text = str(response.json().get("text", "")).strip()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail={"code": "TRANSCRIPTION_FAILED", "message": "语音识别暂时不可用"}) from exc
    if not text:
        raise HTTPException(status_code=422, detail={"code": "TRANSCRIPTION_EMPTY", "message": "没有识别到清晰语音"})
    return TranscriptionResult(text=text[:300], model=settings.openai_transcribe_model)


def select_dashboard_tools(question: str) -> list[str]:
    tools: list[str] = []
    if any(keyword in question for keyword in ("第三空间", "哪家", "排行", "门店", "销售情况")):
        tools.append("third_spaces")
    if any(keyword in question for keyword in ("占比", "营业额", "销售额", "传统门店", "经营订单")):
        tools.append("channel_mix")
    if any(keyword in question for keyword in ("趋势", "每天", "每日", "近7天", "近 7 天", "变化")):
        tools.append("daily_trend")
    if not tools or any(keyword in question for keyword in ("总需求", "预订单", "总体", "概况")):
        tools.insert(0, "overview")
    return list(dict.fromkeys(tools))[:3]


def _tool_context(snapshot: DashboardSnapshot, tools: list[str]) -> dict[str, Any]:
    context: dict[str, Any] = {
        "park_id": snapshot.park_id,
        "park_name": snapshot.park_name,
        "range_start": snapshot.range_start.isoformat(),
        "range_end": snapshot.range_end.isoformat(),
        "data_quality": snapshot.data_quality.model_dump(mode="json"),
    }
    if "overview" in tools:
        context["overview"] = snapshot.headline.model_dump(mode="json")
    if "channel_mix" in tools:
        context["channel_mix"] = [item.model_dump(mode="json") for item in snapshot.channel_mix]
    if "daily_trend" in tools:
        context["daily_trend"] = [item.model_dump(mode="json") for item in snapshot.daily_trend]
    if "third_spaces" in tools:
        context["third_spaces"] = [item.model_dump(mode="json") for item in snapshot.third_spaces]
    return context


ANSWER_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "answer": {"type": "string"},
        "chart": {
            "anyOf": [
                {"type": "null"},
                {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "kind": {"type": "string", "enum": ["donut", "bar", "line"]},
                        "title": {"type": "string"},
                        "categories": {"type": "array", "items": {"type": "string"}, "maxItems": 64},
                        "series": {
                            "type": "array",
                            "maxItems": 8,
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {
                                    "name": {"type": "string"},
                                    "data": {"type": "array", "items": {"type": "number"}, "maxItems": 64},
                                },
                                "required": ["name", "data"],
                            },
                        },
                        "unit": {"type": "string"},
                    },
                    "required": ["kind", "title", "categories", "series", "unit"],
                },
            ]
        },
    },
    "required": ["answer", "chart"],
}


def _extract_response_text(payload: dict[str, Any]) -> str:
    if isinstance(payload.get("output_text"), str):
        return payload["output_text"]
    for item in payload.get("output", []):
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") == "output_text" and isinstance(content.get("text"), str):
                return content["text"]
    return ""


async def answer_dashboard_question(
    settings: Settings,
    snapshot: DashboardSnapshot,
    question: str,
) -> AssistantAnswer:
    if not settings.openai_api_key:
        raise HTTPException(status_code=503, detail={"code": "AI_NOT_CONFIGURED", "message": "智能问答服务尚未配置"})
    tools = select_dashboard_tools(question)
    context = _tool_context(snapshot, tools)
    instructions = (
        "你是新安食品产业园大屏数据助手。仅依据给定的聚合数据回答，不推测缺失值，不输出个人信息。"
        "回答使用简洁中文，先给结论，再给关键数字；数据不足时明确说明。"
        "涉及占比、趋势、排行或对比时返回一个图表；图表只能使用 donut、bar、line。"
        "categories 与每个 series.data 长度必须一致。"
    )
    request_body = {
        "model": settings.openai_chat_model,
        "store": False,
        "reasoning": {"effort": "low"},
        "text": {
            "verbosity": "low",
            "format": {
                "type": "json_schema",
                "name": "dashboard_answer",
                "strict": True,
                "schema": ANSWER_SCHEMA,
            },
        },
        "input": [
            {"role": "system", "content": instructions},
            {
                "role": "user",
                "content": f"问题：{question}\n可用聚合工具：{', '.join(tools)}\n数据：{json.dumps(context, ensure_ascii=False)}",
            },
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{settings.openai_base_url.rstrip('/')}/responses",
                headers={"Authorization": f"Bearer {settings.openai_api_key}", "Content-Type": "application/json"},
                json=request_body,
            )
            response.raise_for_status()
            raw_text = _extract_response_text(response.json())
            model_answer = json.loads(raw_text)
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=502, detail={"code": "AI_RESPONSE_FAILED", "message": "智能问答暂时不可用"}) from exc

    return AssistantAnswer(
        answer=model_answer["answer"],
        chart=model_answer.get("chart"),
        data_cutoff=datetime.now(timezone.utc),
        tools_used=tools,
    )
