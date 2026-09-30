from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import inspect


def api_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return f"{value:.2f}"
    if isinstance(value, datetime | date):
        return value.isoformat()
    return value


def model_dict(instance: Any) -> dict[str, Any]:
    mapper = inspect(instance).mapper
    return {attribute.key: api_value(getattr(instance, attribute.key)) for attribute in mapper.column_attrs}
