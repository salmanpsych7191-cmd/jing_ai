import base64
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from restaurant_agent.app import app, create_booking, BookingCreate, DASHBOARD_USERNAME, DASHBOARD_PASSWORD


class AgentRoutesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        credentials = base64.b64encode(f"{DASHBOARD_USERNAME}:{DASHBOARD_PASSWORD}".encode()).decode()
        self.client.headers.update({"Authorization": f"Basic {credentials}"})

    def test_mark_visited_route(self) -> None:
        booking = create_booking(
            BookingCreate(
                guest_name="Aamir",
                phone="+971500000000",
                date="2030-01-01",
                time="19:00",
                guests=2,
                special_requests="",
            )
        )

        response = self.client.post(
            "/mark-visited",
            json={
                "booking_id": booking["id"],
                "guest_phone": "+971500000000",
                "guest_name": "Aamir",
                "bill_amount": 350,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "visit_processed")

    def test_respond_to_review_route(self) -> None:
        with patch("restaurant_agent.app.draft_review_response", return_value="Thanks for your feedback"):
            response = self.client.post(
                "/respond-to-review",
                json={
                    "reviewer_name": "Ahmed",
                    "review_text": "Food was great",
                    "rating": 5,
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["draft_response"], "Thanks for your feedback")

    def test_todays_bookings_route(self) -> None:
        response = self.client.get("/todays-bookings")
        self.assertEqual(response.status_code, 200)
        self.assertIn("bookings", response.json())


if __name__ == "__main__":
    unittest.main()
