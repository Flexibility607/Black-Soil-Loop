import hashlib
import json
import re
from collections import defaultdict
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
CHANNEL_LABELS = {"TRADITIONAL_STORE": "传统门店", "THIRD_SPACE": "第三空间"}


def require_dashboard_proxy(request: Request, settings: Settings) -> None:
    if settings.dashboard_service_token is None:
        return
    supplied = request.headers.get("X-Dashboard-Service-Token")
    if supplied != settings.dashboard_service_token:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHENTICATED", "message": "大屏代理令牌无效"})


def enforce_assistant_rate_limit(db: Session, request: Request, settings: Settings, route: str) -> None:
    source = (
        request.headers.get("CF-Connecting-IP")
        or request.headers.get("X-Forwarded-For", "").split(",", 1)[0].strip()
        or (request.client.host if request.client else "unknown")
    )
    salt = settings.dashboard_service_token or settings.b02_to_b01_shared_secret
    client_hash = hashlib.sha256(f"{salt}:{source}".encode()).hexdigest()
    now = datetime.now(timezone.utc)
    window = now.replace(second=0, microsecond=0)
    record = db.get(
        AssistantRateWindow,
        {"client_hash": client_hash, "route": route, "window_started_at": window},
    )
    if record is None:
        record = AssistantRateWindow(
            client_hash=client_hash,
            window_started_at=window,
            request_count=0,
            last_request_at=now,
            route=route,
        )
        db.add(record)
    limit = (
        settings.assistant_transcription_limit_per_minute
        if route == "transcription"
        else settings.assistant_query_limit_per_minute
    )
    if record.request_count >= limit:
        raise HTTPException(status_code=429, detail={"code": "RATE_LIMITED", "message": "语音助手请求过于频繁，请稍后再试"})
    record.request_count += 1
    record.last_request_at = now
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
                data={"model": settings.openai_transcription_model, "language": "zh", "response_format": "json"},
                files={"file": (filename, content, content_type)},
            )
            response.raise_for_status()
            text = str(response.json().get("text", "")).strip()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail={"code": "TRANSCRIPTION_FAILED", "message": "语音识别暂时不可用"}) from exc
    if not text:
        raise HTTPException(status_code=422, detail={"code": "TRANSCRIPTION_EMPTY", "message": "没有识别到清晰语音"})
    return TranscriptionResult(text=text[:300], model=settings.openai_transcription_model)


def normalize_audio_upload(filename: str, content_type: str, content: bytes) -> tuple[str, str, bytes]:
    """Normalize upload metadata in memory; reject malformed Ogg containers early."""
    if content_type == "audio/ogg":
        if not content.startswith(b"OggS"):
            raise HTTPException(status_code=415, detail={"code": "UNSUPPORTED_AUDIO", "message": "Ogg 音频容器无效"})
        return "question.ogg", "audio/ogg", content
    return filename, content_type, content


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


TOOL_SCHEMAS = [
    {
        "type": "function",
        "name": name,
        "description": {
            "overview": "读取园区预订需求和经营概览",
            "channel_mix": "读取传统门店与第三空间渠道占比",
            "daily_trend": "读取统计周期内的每日趋势",
            "third_spaces": "读取第三空间销售排行",
        }[name],
        "parameters": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
        "strict": True,
    }
    for name in TOOL_NAMES
]

LANGUAGE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {"answer": {"type": "string"}},
    "required": ["answer"],
}


def _requested_tool(response_payload: dict[str, Any], question: str) -> tuple[str, str | None]:
    for item in response_payload.get("output", []):
        if item.get("type") == "function_call" and item.get("name") in TOOL_NAMES:
            return item["name"], item.get("call_id")
    return select_dashboard_tools(question)[0], None


def _facts(snapshot: DashboardSnapshot, tool_name: str) -> str:
    if tool_name == "overview":
        demand = "、".join(f"{item.quantity:g} {item.unit}" for item in snapshot.headline.demand_totals) or "暂无有效需求量"
        return f"有效预订单 {snapshot.headline.preorder_count} 笔；分单位需求为 {demand}。"
    if tool_name == "channel_mix":
        return " ".join(
            f"{item.display_name}经营订单 {item.operation_order_count} 笔、营业额 {item.sales_amount:.2f} 元。"
            for item in snapshot.channel_mix
        )
    if tool_name == "daily_trend":
        order_total = sum(item.operation_order_count for item in snapshot.daily_trend)
        sales_total = sum(item.sales_amount for item in snapshot.daily_trend)
        return f"统计周期累计经营订单 {order_total} 笔，营业额 {sales_total:.2f} 元。"
    ranked = snapshot.third_spaces[:3]
    if not ranked:
        return "当前统计周期暂无第三空间经营日报。"
    return "；".join(
        f"{index}. {item.store_name}：{item.operation_order_count} 笔、{item.sales_amount:.2f} 元"
        for index, item in enumerate(ranked, start=1)
    ) + "。"


def _chart(snapshot: DashboardSnapshot, tool_name: str, question: str) -> dict[str, Any] | None:
    if tool_name == "overview":
        return {
            "kind": "bar",
            "title": "园区分单位需求",
            "categories": [item.unit for item in snapshot.headline.demand_totals],
            "series": [{"name": "需求量", "data": [item.quantity for item in snapshot.headline.demand_totals]}],
            "unit": "按单位分别显示",
        } if snapshot.headline.demand_totals else None
    if tool_name == "channel_mix":
        sales = any(word in question for word in ("营业额", "销售额", "金额"))
        return {
            "kind": "donut",
            "title": "营业额渠道占比" if sales else "经营订单渠道占比",
            "categories": [item.display_name for item in snapshot.channel_mix],
            "series": [{
                "name": "营业额" if sales else "经营订单数",
                "data": [item.sales_amount if sales else float(item.operation_order_count) for item in snapshot.channel_mix],
            }],
            "unit": "元" if sales else "笔",
        }
    if tool_name == "third_spaces":
        sales = any(word in question for word in ("营业额", "销售额", "金额"))
        rows = snapshot.third_spaces[:8]
        return {
            "kind": "bar",
            "title": "第三空间销售排行",
            "categories": [item.store_name for item in rows],
            "series": [{
                "name": "营业额" if sales else "经营订单数",
                "data": [item.sales_amount if sales else float(item.operation_order_count) for item in rows],
            }],
            "unit": "元" if sales else "笔",
        } if rows else None

    sales = any(word in question for word in ("营业额", "销售额", "金额"))
    grouped: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for item in snapshot.daily_trend:
        label = CHANNEL_LABELS.get(item.channel_type, item.channel_type)
        grouped[item.date.isoformat()][label] += item.sales_amount if sales else item.operation_order_count
    categories = sorted(grouped)
    series_names = ["传统门店", "第三空间"]
    return {
        "kind": "line",
        "title": "每日营业额趋势" if sales else "每日经营订单趋势",
        "categories": categories,
        "series": [
            {"name": name, "data": [grouped[day][name] for day in categories]}
            for name in series_names
        ],
        "unit": "元" if sales else "笔",
    }


async def answer_dashboard_question(
    settings: Settings,
    snapshot: DashboardSnapshot,
    question: str,
) -> AssistantAnswer:
    if not settings.openai_api_key:
        raise HTTPException(status_code=503, detail={"code": "AI_NOT_CONFIGURED", "message": "智能问答服务尚未配置"})
    instructions = (
        "你是新安食品产业园大屏数据助手。仅依据给定的聚合数据回答，不推测缺失值，不输出个人信息。"
        "先调用一个最匹配的聚合工具。回答只组织语言，不自行写任何数字、比例或金额；数字由服务端追加。"
    )
    tool_request = {
        "model": settings.openai_chat_model,
        "store": False,
        "reasoning": {"effort": "low"},
        "instructions": instructions,
        "input": question,
        "tools": TOOL_SCHEMAS,
        "tool_choice": "required",
        "parallel_tool_calls": False,
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            first_response = await client.post(
                f"{settings.openai_base_url.rstrip('/')}/responses",
                headers={"Authorization": f"Bearer {settings.openai_api_key}", "Content-Type": "application/json"},
                json=tool_request,
            )
            first_response.raise_for_status()
            first_payload = first_response.json()
            tool_name, call_id = _requested_tool(first_payload, question)
            context = _tool_context(snapshot, [tool_name])
            if call_id:
                language_request = {
                    "model": settings.openai_chat_model,
                    "store": False,
                    "previous_response_id": first_payload.get("id"),
                    "input": [{
                        "type": "function_call_output",
                        "call_id": call_id,
                        "output": json.dumps(context, ensure_ascii=False),
                    }],
                    "text": {
                        "verbosity": "low",
                        "format": {
                            "type": "json_schema",
                            "name": "dashboard_language",
                            "strict": True,
                            "schema": LANGUAGE_SCHEMA,
                        },
                    },
                }
                response = await client.post(
                    f"{settings.openai_base_url.rstrip('/')}/responses",
                    headers={"Authorization": f"Bearer {settings.openai_api_key}", "Content-Type": "application/json"},
                    json=language_request,
                )
                response.raise_for_status()
                raw_text = _extract_response_text(response.json())
                model_answer = json.loads(raw_text)
                lead = str(model_answer.get("answer", "")).strip()
            else:
                lead = ""
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=502, detail={"code": "AI_RESPONSE_FAILED", "message": "智能问答暂时不可用"}) from exc

    if not lead or re.search(r"\d", lead):
        lead = "已按当前统计周期完成聚合。"
    tools = [tool_name]

    return AssistantAnswer(
        answer=f"{lead}{_facts(snapshot, tool_name)}",
        chart=_chart(snapshot, tool_name, question),
        data_cutoff=snapshot.data_cutoff,
        tools_used=tools,
    )
