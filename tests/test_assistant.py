import json
from datetime import datetime, timezone
from typing import ClassVar

import pytest

from app.core.config import Settings
from app.schemas.dashboard import DashboardSnapshot
from app.services.assistant import (
    answer_dashboard_question,
    select_dashboard_tools,
    transcribe_audio,
)


class FakeResponse:
    def __init__(self, payload: dict):
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self.payload


class FakeClient:
    requests: ClassVar[list[dict]] = []

    def __init__(self, *, timeout: float):
        self.timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None

    async def post(self, url: str, **kwargs):
        self.requests.append({"url": url, **kwargs})
        if url.endswith("/audio/transcriptions"):
            return FakeResponse({"text": "第三空间营业额占比是多少"})
        if kwargs["json"].get("tools"):
            return FakeResponse({
                "id": "resp-tool",
                "output": [{"type": "function_call", "name": "channel_mix", "call_id": "call-1", "arguments": "{}"}],
            })
        return FakeResponse({"output_text": json.dumps({"answer": "渠道结构已完成比较。"}, ensure_ascii=False)})


def empty_snapshot() -> DashboardSnapshot:
    return DashboardSnapshot.model_validate(
        {
            "park_id": "PARK-1",
            "park_name": "测试园区",
            "range_start": datetime(2026, 8, 1, tzinfo=timezone.utc),
            "range_end": datetime(2026, 8, 2, tzinfo=timezone.utc),
            "period": "30d",
            "headline": {"preorder_count": 0, "demand_totals": [], "operation_order_count": 0, "sales_amount": 0, "currency": "CNY"},
            "channel_mix": [
                {"channel_type": "TRADITIONAL_STORE", "display_name": "传统门店", "preorder_count": 0, "demand_totals": [], "operation_order_count": 57, "operation_order_share": 57.0, "sales_amount": 5700, "sales_share": 57.0},
                {"channel_type": "THIRD_SPACE", "display_name": "第三空间", "preorder_count": 0, "demand_totals": [], "operation_order_count": 43, "operation_order_share": 43.0, "sales_amount": 4300, "sales_share": 43.0},
            ],
            "daily_trend": [],
            "third_spaces": [],
            "map_nodes": [],
            "map_edges": [],
            "data_quality": {
                "store_count": 0,
                "reporting_store_count": 0,
                "missing_store_classification_count": 0,
                "missing_coordinate_count": 0,
                "missing_report_count": 0,
                "report_coverage": None,
                "warnings": [],
            },
            "data_cutoff": datetime(2026, 8, 2, tzinfo=timezone.utc),
        }
    )


def test_assistant_tool_selection_is_allowlisted() -> None:
    assert select_dashboard_tools("第三空间销售排行如何") == ["third_spaces"]
    assert select_dashboard_tools("最近七天营业额趋势") == ["channel_mix", "daily_trend"]
    assert set(select_dashboard_tools("给我园区总体概况")) <= {"overview", "channel_mix", "daily_trend", "third_spaces"}


@pytest.mark.asyncio
async def test_openai_transcription_and_structured_response_are_mockable(monkeypatch) -> None:
    FakeClient.requests.clear()
    monkeypatch.setattr("app.services.assistant.httpx.AsyncClient", FakeClient)
    settings = Settings(
        database_url="sqlite+pysqlite://",
        jwt_secret="test-secret-with-at-least-32-bytes",
        openai_api_key="test-key",
    )
    transcription = await transcribe_audio(
        settings,
        filename="question.webm",
        content_type="audio/webm",
        content=b"audio",
    )
    answer = await answer_dashboard_question(settings, empty_snapshot(), transcription.text)

    assert transcription.text.startswith("第三空间")
    assert answer.chart is not None and answer.chart.kind == "donut"
    request = FakeClient.requests[-1]
    assert request["url"].endswith("/responses")
    assert request["json"]["model"] == "gpt-5.6-terra"
    assert request["json"]["text"]["format"]["strict"] is True
    assert "SQL" not in json.dumps(request["json"], ensure_ascii=False)
    assert answer.chart.series[0].data == [5700.0, 4300.0]
