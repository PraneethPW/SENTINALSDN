from datetime import datetime, timedelta, timezone
from ipaddress import IPv4Address
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator


class Login(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class Flow(BaseModel):
    observed_at: datetime
    switch_id: str = Field(pattern=r"^[0-9]{1,20}$")
    source_ip: IPv4Address
    destination_ip: IPv4Address
    protocol: Literal[1, 6, 17]
    destination_port: int | None = Field(default=None, ge=0, le=65535)
    packets: int = Field(ge=1, le=10**12)
    bytes: int = Field(ge=1, le=10**15)
    interval_seconds: float = Field(ge=0.1, le=300, allow_inf_nan=False)
    duration_seconds: float = Field(ge=0, le=10**9, allow_inf_nan=False)

    @field_validator("observed_at")
    @classmethod
    def recent_timestamp(cls, value):
        now = datetime.now(timezone.utc)
        if value.tzinfo is None or value < now - timedelta(hours=1) or value > now + timedelta(seconds=30):
            raise ValueError("observed_at must be timezone-aware and within the last hour")
        return value

    @model_validator(mode="after")
    def packet_semantics(self):
        if self.bytes < self.packets:
            raise ValueError("Byte count must be at least packet count")
        if self.protocol == 1 and self.destination_port is not None:
            raise ValueError("ICMP does not have a transport port")
        return self


class DiscoveredLink(BaseModel):
    source: str = Field(pattern=r"^[0-9]{1,20}$")
    target: str = Field(pattern=r"^[0-9]{1,20}$")
    source_port: int = Field(ge=1, le=65535)
    target_port: int = Field(ge=1, le=65535)


class DiscoveredHost(BaseModel):
    mac: str = Field(pattern=r"^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$")
    addresses: list[IPv4Address] = Field(max_length=32)
    switch_id: str = Field(pattern=r"^[0-9]{1,20}$")
    port: int = Field(ge=1, le=65535)


class PortCounters(BaseModel):
    switch_id: str = Field(pattern=r"^[0-9]{1,20}$")
    port: int = Field(ge=1, le=65535)
    rx_bytes: int = Field(ge=0, le=2**64 - 1)
    tx_bytes: int = Field(ge=0, le=2**64 - 1)
    rx_dropped: int = Field(ge=0, le=2**64 - 1)
    tx_dropped: int = Field(ge=0, le=2**64 - 1)
    rx_errors: int = Field(ge=0, le=2**64 - 1)
    tx_errors: int = Field(ge=0, le=2**64 - 1)


class DiscoveredTopology(BaseModel):
    available: bool = False
    links: list[DiscoveredLink] = Field(default_factory=list, max_length=2048)
    hosts: list[DiscoveredHost] = Field(default_factory=list, max_length=4096)
    ports: list[PortCounters] = Field(default_factory=list, max_length=4096)


class Batch(BaseModel):
    source_type: Literal["sdn_controller", "isolated_lab"] = "sdn_controller"
    topology: DiscoveredTopology = Field(default_factory=DiscoveredTopology)
    batch_id: UUID
    captured_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    collector_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    switches: list[str] = Field(max_length=256)
    controller_status: Literal["connected", "unreachable", "error"]
    version: str = Field(default="1.0.0", max_length=32)
    flows: list[Flow] = Field(max_length=1000)

    @field_validator("captured_at")
    @classmethod
    def recent_capture(cls, value):
        return Flow.recent_timestamp(value)

    @field_validator("switches")
    @classmethod
    def valid_switches(cls, value):
        if any(not s.isdigit() or len(s) > 20 for s in value):
            raise ValueError("Invalid switch datapath ID")
        return list(dict.fromkeys(value))


class IncidentUpdate(BaseModel):
    assignee_id: UUID | None = None
    revision: int | None = Field(default=None, ge=1)
    status: Literal["open", "acknowledged", "resolved"]
    notes: str = Field(default="", max_length=2000)


class CommandResult(BaseModel):
    status: Literal["enforced", "failed", "revoked"]
    detail: str = Field(min_length=1, max_length=2000)


class ExplainRequest(BaseModel):
    incident_id: UUID
