import unittest

from app.assessment import automatic_rejection


class AutomaticDecisionTests(unittest.TestCase):
    def test_policy_limit_exceeded_is_rejected_independent_of_reason(self):
        decision = automatic_rejection(True, {"available": True, "ai_flag": "STANDARD_REVIEW"})

        self.assertTrue(decision["rejected"])
        self.assertEqual(decision["code"], "POLICY_LIMIT_EXCEEDED")

    def test_invalid_or_unclear_reason_is_rejected(self):
        for reason_flag, expected_code in [
            ("INVALID_REASON", "INVALID_REASON"),
            ("CLARIFICATION_REQUIRED", "INSUFFICIENT_REASON"),
        ]:
            with self.subTest(reason_flag=reason_flag):
                decision = automatic_rejection(False, {"available": True, "ai_flag": reason_flag})
                self.assertTrue(decision["rejected"])
                self.assertEqual(decision["code"], expected_code)

    def test_acceptable_or_unavailable_assessment_goes_to_manager(self):
        for assessment in [
            {"available": True, "ai_flag": "STANDARD_REVIEW"},
            {"available": True, "ai_flag": "ADDITIONAL_CONSIDERATION"},
            {"available": False, "ai_flag": "STANDARD_REVIEW"},
            {"available": False, "ai_flag": "INVALID_REASON"},
            {"available": False, "ai_flag": "CLARIFICATION_REQUIRED"},
        ]:
            with self.subTest(assessment=assessment):
                decision = automatic_rejection(False, assessment)
                self.assertFalse(decision["rejected"])


if __name__ == "__main__":
    unittest.main()
