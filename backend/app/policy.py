from collections import Counter
from datetime import date


def policy_reference(monthly_limit: int) -> str:
    return (
        f"WFH policy: maximum {monthly_limit} approved work-from-home days per calendar month; "
        "requests above this limit are automatically rejected."
    )


def month_key(day: date) -> str:
    return day.strftime("%Y-%m")


def calculate_usage(
    previously_approved_dates: list[date], requested_dates: list[date], monthly_limit: int
) -> list[dict[str, int | str | bool]]:
    previous = Counter(month_key(day) for day in previously_approved_dates)
    requested = Counter(month_key(day) for day in requested_dates)
    return [
        {
            "month": month,
            "previously_approved_days": previous[month],
            "requested_days": requested[month],
            "projected_total": previous[month] + requested[month],
            "limit": monthly_limit,
            "exceeds_limit": previous[month] + requested[month] > monthly_limit,
        }
        for month in sorted(previous.keys() | requested.keys())
    ]
