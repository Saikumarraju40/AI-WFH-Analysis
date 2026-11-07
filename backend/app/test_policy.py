import unittest
from datetime import date

from app.policy import calculate_usage, policy_reference


class MonthlyUsageTests(unittest.TestCase):
    def test_usage_is_grouped_by_calendar_month_and_limit_is_independent(self):
        usage = calculate_usage(
            [date(2026, 11, 2), date(2026, 11, 3), date(2026, 12, 1)],
            [date(2026, 11, 10), date(2026, 11, 11), date(2026, 12, 2)],
            3,
        )

        self.assertEqual(usage, [
            {"month": "2026-11", "previously_approved_days": 2, "requested_days": 2, "projected_total": 4, "limit": 3, "exceeds_limit": True},
            {"month": "2026-12", "previously_approved_days": 1, "requested_days": 1, "projected_total": 2, "limit": 3, "exceeds_limit": False},
        ])

    def test_policy_reference_uses_the_configured_limit(self):
        self.assertIn("maximum 3 approved", policy_reference(3))


if __name__ == "__main__":
    unittest.main()
