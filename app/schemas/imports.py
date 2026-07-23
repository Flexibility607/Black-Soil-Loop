from typing import Literal

from pydantic import BaseModel, ConfigDict


class ImportConfirmRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirmed: Literal[True]
