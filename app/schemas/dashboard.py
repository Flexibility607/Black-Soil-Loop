from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReceiptItem(StrictModel):
    product_id: str = Field(min_length=1, max_length=64)
    batch_id: str | None = Field(default=None, min_length=1, max_length=64)
    unit: str = Field(min_length=1, max_length=64)
    expected_quantity: Decimal = Field(ge=0)
    received_quantity: Decimal = Field(ge=0)


class FulfillmentStatusPayload(StrictModel):
    summary_type: Literal["FULFILLMENT_STATUS"]
    task_id: str = Field(min_length=1, max_length=64)
    task_status: str = Field(min_length=1, max_length=32)
    receipt_status: str = Field(min_length=1, max_length=16)
    exception_summary: str | None = None
    received_items: list[ReceiptItem] | None = Field(default=None, max_length=500)
    fulfillment_version: int = Field(ge=1)
    updated_at: AwareDatetime


class InventorySummaryPayload(StrictModel):
    summary_type: Literal["INVENTORY_SUMMARY"]
    store_id: str = Field(min_length=1, max_length=64)
    product_id: str = Field(min_length=1, max_length=64)
    quantity: Decimal = Field(ge=0)
    unit: str = Field(min_length=1, max_length=64)
    low_stock: bool | None
    inventory_version: int = Field(ge=1)
    updated_at: AwareDatetime


class StoreOperationSummaryPayload(StrictModel):
    summary_type: Literal["STORE_OPERATION_SUMMARY"]
    partner_id: str = Field(min_length=1, max_length=64)
    store_id: str = Field(min_length=1, max_length=64)
    period_start: date
    period_end: date
    report_status: Literal["COMPLETE", "INCOMPLETE", "MISSING"]
    sales_amount: Decimal | None = Field(default=None, ge=0)
    currency: Literal["CNY"]
    order_count: int | None = Field(default=None, ge=0)
    average_order_amount: Decimal | None = Field(default=None, ge=0)
    quantity: Decimal | None = Field(default=None, ge=0)
    unit: str | None = Field(default=None, min_length=1, max_length=64)
    loss_quantity: Decimal | None = Field(default=None, ge=0)
    closing_inventory: Decimal | None = Field(default=None, ge=0)
    submitted_count: int = Field(ge=0)
    missing_items: list[str] = Field(max_length=64)
    report_version: int | None = Field(default=None, ge=1)
    store_operation_version: int = Field(ge=1)
    updated_at: AwareDatetime

    @model_validator(mode="after")
    def validate_report_state(self):
        numeric_values = (
            self.sales_amount,
            self.order_count,
            self.average_order_amount,
            self.quantity,
            self.loss_quantity,
            self.closing_inventory,
        )
        if self.period_end < self.period_start:
            raise ValueError("period_end 不能早于 period_start")
        if self.report_status == "MISSING":
            if (
                self.submitted_count != 0
                or self.report_version is not None
                or self.unit is not None
                or any(value is not None for value in numeric_values)
            ):
                raise ValueError("MISSING 摘要必须保留空业务值")
        elif self.submitted_count < 1 or self.report_version is None:
            raise ValueError("已上报摘要必须包含 submitted_count 和 report_version")
        return self


B02Payload = Annotated[
    FulfillmentStatusPayload | InventorySummaryPayload | StoreOperationSummaryPayload,
    Field(discriminator="summary_type"),
]


class B02OutboxEvent(StrictModel):
    schema_version: Literal["1.0"]
    event_id: str = Field(min_length=1, max_length=128)
    trace_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._:-]+$")
    object_type: Literal["fulfillment_summary", "inventory_summary", "store_operation_summary"]
    object_id: str = Field(min_length=1, max_length=256)
    object_version: int = Field(ge=1)
    occurred_at: AwareDatetime
    payload: B02Payload

    @model_validator(mode="after")
    def object_type_matches_payload(self):
        expected = {
            "FULFILLMENT_STATUS": "fulfillment_summary",
            "INVENTORY_SUMMARY": "inventory_summary",
            "STORE_OPERATION_SUMMARY": "store_operation_summary",
        }[self.payload.summary_type]
        if self.object_type != expected:
            raise ValueError("object_type 与 payload.summary_type 不一致")
        if isinstance(self.payload, StoreOperationSummaryPayload) and self.object_version != self.payload.store_operation_version:
            raise ValueError("object_version 必须等于 store_operation_version")
        return self


class DemandTotal(StrictModel):
    unit: str
    quantity: float


class DashboardHeadline(StrictModel):
    preorder_count: int
    demand_totals: list[DemandTotal]
    operation_order_count: int
    sales_amount: float
    currency: Literal["CNY"]


class ChannelMetric(StrictModel):
    channel_type: Literal["TRADITIONAL_STORE", "THIRD_SPACE"]
    display_name: str
    preorder_count: int
    demand_totals: list[DemandTotal]
    operation_order_count: int
    operation_order_share: float | None
    sales_amount: float
    sales_share: float | None


class DailyTrendPoint(StrictModel):
    date: date
    channel_type: Literal["TRADITIONAL_STORE", "THIRD_SPACE"]
    preorder_count: int
    demand_totals: list[DemandTotal]
    operation_order_count: int
    sales_amount: float


class ThirdSpaceMetric(StrictModel):
    store_id: str
    store_name: str
    city: str | None
    longitude: float | None
    latitude: float | None
    preorder_count: int
    demand_totals: list[DemandTotal]
    operation_order_count: int
    sales_amount: float
    last_report_date: date | None
    last_report_status: Literal["COMPLETE", "INCOMPLETE", "MISSING"] | None
    is_demo: bool = False


class MapNode(StrictModel):
    node_id: str
    node_type: Literal["PARK", "TRADITIONAL_STORE", "THIRD_SPACE"]
    display_name: str
    city: str | None
    longitude: float
    latitude: float


class MapEdge(StrictModel):
    source_id: str
    target_id: str
    channel_type: Literal["TRADITIONAL_STORE", "THIRD_SPACE"]


class DashboardDataQuality(StrictModel):
    store_count: int
    reporting_store_count: int
    missing_store_classification_count: int
    missing_coordinate_count: int
    missing_report_count: int
    report_coverage: float | None
    excluded_preorder_count: int = 0
    excluded_demand_totals: list[DemandTotal] = []
    expected_report_count: int = 0
    received_report_count: int = 0
    warnings: list[str]


class DashboardSnapshot(StrictModel):
    park_id: str | None
    park_name: str
    range_start: datetime
    range_end: datetime
    period: Literal["7d", "30d", "month"]
    headline: DashboardHeadline
    channel_mix: list[ChannelMetric]
    daily_trend: list[DailyTrendPoint]
    third_spaces: list[ThirdSpaceMetric]
    map_nodes: list[MapNode]
    map_edges: list[MapEdge]
    data_quality: DashboardDataQuality
    data_cutoff: datetime
    demo_mode: bool = False


class InternalMetric(StrictModel):
    label: str
    value: float
    unit: str
    status: str | None = None


class DashboardInternalMetrics(StrictModel):
    capacity: list[InternalMetric]
    inventory_alerts: list[InternalMetric]
    freezer: list[InternalMetric]
    transport: list[InternalMetric]


class AuthenticatedDashboardSnapshot(DashboardSnapshot):
    internal: DashboardInternalMetrics


class AssistantQuery(StrictModel):
    question: str = Field(min_length=1, max_length=300)
    park_id: str | None = Field(default=None, max_length=64)
    period: Literal["7d", "30d", "month"] = "30d"


class AssistantChartSeries(StrictModel):
    name: str
    data: list[float] = Field(max_length=64)


class AssistantChart(StrictModel):
    kind: Literal["donut", "bar", "line"]
    title: str
    categories: list[str] = Field(max_length=64)
    series: list[AssistantChartSeries] = Field(max_length=8)
    unit: str

    @model_validator(mode="after")
    def validate_series_lengths(self):
        if any(len(item.data) != len(self.categories) for item in self.series):
            raise ValueError("图表 categories 与 series.data 长度必须一致")
        return self


class AssistantAnswer(StrictModel):
    answer: str
    chart: AssistantChart | None
    data_cutoff: datetime
    tools_used: list[Literal["overview", "channel_mix", "daily_trend", "third_spaces"]]


class TranscriptionResult(StrictModel):
    text: str
    model: str
