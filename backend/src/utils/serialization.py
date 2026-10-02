from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import inspect
from sqlalchemy.ext.hybrid import hybrid_property


def api_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return f"{value:.2f}"
    if isinstance(value, datetime | date):
        return value.isoformat()
    return value


def model_dict(instance: Any) -> dict[str, Any]:
    mapper = inspect(instance).mapper
    fields = {attribute.key: getattr(instance, attribute.key) for attribute in mapper.column_attrs}
    for key, descriptor in mapper.all_orm_descriptors.items():
        if isinstance(descriptor, hybrid_property):
            fields[key] = getattr(instance, key)
    return {key: api_value(value) for key, value in fields.items()}
