from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PatchModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ParkCreate(PatchModel):
    park_id: str = Field(min_length=1, max_length=64)
    park_name: str = Field(min_length=1, max_length=255)
    address: str | None = None
    longitude: float | None = Field(default=None, ge=-180, le=180)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    status: Literal["ACTIVE", "INACTIVE"]
    remark: str | None = None


class ParkLegacyImportCreate(PatchModel):
    """Compatibility schema for workbooks created before migration 0010."""

    park_id: str = Field(min_length=1, max_length=64)
    park_name: str = Field(min_length=1, max_length=255)
    address: str | None = None
    status: Literal["ACTIVE", "INACTIVE"]
    remark: str | None = None


class ParkPatch(PatchModel):
    park_name: str | None = Field(default=None, min_length=1, max_length=255)
    address: str | None = None
    longitude: float | None = Field(default=None, ge=-180, le=180)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    status: Literal["ACTIVE", "INACTIVE"] | None = None
    remark: str | None = None


class EnterpriseCreate(PatchModel):
    enterprise_id: str = Field(min_length=1, max_length=64)
    park_id: str = Field(min_length=1, max_length=64)
    enterprise_name: str = Field(min_length=1, max_length=255)
    industry: str = Field(min_length=1, max_length=128)
    enterprise_contact_name: str | None = None
    enterprise_phone: str | None = None
    enterprise_address: str | None = None
    status: Literal["ACTIVE", "INACTIVE"]
    remark: str | None = None


class EnterprisePatch(PatchModel):
    park_id: str | None = None
    enterprise_name: str | None = Field(default=None, min_length=1, max_length=255)
    industry: str | None = Field(default=None, min_length=1, max_length=128)
    enterprise_contact_name: str | None = None
    enterprise_phone: str | None = None
    enterprise_address: str | None = None
    status: Literal["ACTIVE", "INACTIVE"] | None = None
    remark: str | None = None


class EnterpriseTagCreate(PatchModel):
    enterprise_id: str = Field(min_length=1, max_length=64)
    tag: str = Field(min_length=1, max_length=128)
    remark: str | None = None


class EnterpriseTagPatch(PatchModel):
    remark: str | None = None


class PartnerCreate(PatchModel):
    partner_id: str = Field(min_length=1, max_length=64)
    partner_name: str = Field(min_length=1, max_length=255)
    partner_type: str = Field(min_length=1, max_length=128)
    partner_contact_name: str = Field(min_length=1, max_length=128)
    partner_phone: str = Field(min_length=1, max_length=64)
    partner_address: str = Field(min_length=1, max_length=500)
    relationship_status: Literal["ACTIVE", "INACTIVE"]
    remark: str | None = None


class PartnerPatch(PatchModel):
    partner_name: str | None = Field(default=None, min_length=1, max_length=255)
    partner_type: str | None = Field(default=None, min_length=1, max_length=128)
    partner_contact_name: str | None = Field(default=None, min_length=1, max_length=128)
    partner_phone: str | None = Field(default=None, min_length=1, max_length=64)
    partner_address: str | None = Field(default=None, min_length=1, max_length=500)
    relationship_status: Literal["ACTIVE", "INACTIVE"] | None = None
    remark: str | None = None


class StoreCreate(PatchModel):
    store_id: str = Field(min_length=1, max_length=64)
    enterprise_id: str | None = Field(default=None, max_length=64)
    partner_id: str = Field(min_length=1, max_length=64)
    park_id: str = Field(min_length=1, max_length=64)
    channel_type: Literal["TRADITIONAL_STORE", "THIRD_SPACE"]
    reporting_authorized: bool = False
    store_name: str = Field(min_length=1, max_length=255)
    store_contact_name: str = Field(min_length=1, max_length=128)
    store_phone: str = Field(min_length=1, max_length=64)
    delivery_address: str = Field(min_length=1, max_length=500)
    city: str | None = Field(default=None, min_length=1, max_length=128)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    relationship_status: Literal["ACTIVE", "INACTIVE"]
    remark: str | None = None


class StoreLegacyImportCreate(PatchModel):
    """Compatibility schema for workbooks created before migration 0010."""

    store_id: str = Field(min_length=1, max_length=64)
    partner_id: str = Field(min_length=1, max_length=64)
    store_name: str = Field(min_length=1, max_length=255)
    store_contact_name: str = Field(min_length=1, max_length=128)
    store_phone: str = Field(min_length=1, max_length=64)
    delivery_address: str = Field(min_length=1, max_length=500)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    relationship_status: Literal["ACTIVE", "INACTIVE"]
    remark: str | None = None


class StorePatch(PatchModel):
    enterprise_id: str | None = Field(default=None, max_length=64)
    partner_id: str | None = None
    park_id: str | None = Field(default=None, min_length=1, max_length=64)
    channel_type: Literal["TRADITIONAL_STORE", "THIRD_SPACE"] | None = None
    reporting_authorized: bool | None = None
    store_name: str | None = Field(default=None, min_length=1, max_length=255)
    store_contact_name: str | None = Field(default=None, min_length=1, max_length=128)
    store_phone: str | None = Field(default=None, min_length=1, max_length=64)
    delivery_address: str | None = Field(default=None, min_length=1, max_length=500)
    city: str | None = Field(default=None, min_length=1, max_length=128)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    relationship_status: Literal["ACTIVE", "INACTIVE"] | None = None
    remark: str | None = None
