import unittest

import jwt

from app.auth import create_access_token, hash_password, verify_password
from app.database import settings
from app.main import account_payload
from app.models import User


class AuthenticationTests(unittest.TestCase):
    def test_password_hash_verifies_only_matching_password(self):
        password_hash = hash_password("correct-horse-battery")

        self.assertTrue(verify_password("correct-horse-battery", password_hash))
        self.assertFalse(verify_password("different-password", password_hash))

    def test_access_token_contains_account_role(self):
        user = User(id=3, email="manager@example.com", display_name="Manager", role="manager", password_hash="unused")

        claims = jwt.decode(create_access_token(user), settings.jwt_secret, algorithms=["HS256"])

        self.assertEqual(claims["sub"], "manager@example.com")
        self.assertEqual(claims["role"], "manager")
        self.assertIn("exp", claims)

    def test_employee_profile_includes_assigned_manager_details(self):
        manager = User(
            id=1,
            email="manager@example.com",
            display_name="Morgan Lee",
            role="manager",
            job_title="People Manager",
            department="Operations",
            team="Workplace",
            password_hash="unused",
        )
        employee = User(
            id=2,
            email="employee@example.com",
            display_name="Taylor Chen",
            role="employee",
            job_title="Analyst",
            department="Operations",
            team="Planning",
            manager_email=manager.email,
            password_hash="unused",
        )

        profile = account_payload(employee, manager)

        self.assertEqual(profile["manager_name"], "Morgan Lee")
        self.assertEqual(profile["manager_email"], "manager@example.com")
        self.assertEqual(profile["team"], "Planning")


if __name__ == "__main__":
    unittest.main()
