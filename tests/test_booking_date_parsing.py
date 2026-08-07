import unittest

from restaurant_agent.app import LOCAL_TZ, normalize_date, to_booking_datetime


class BookingDateParsingTests(unittest.TestCase):
    def test_normalize_date_supports_dmy_format(self) -> None:
        self.assertEqual(normalize_date("10-07-2026"), "2026-07-10")

    def test_to_booking_datetime_supports_dmy_and_24h_time(self) -> None:
        dt = to_booking_datetime("10-07-2026", "22:00")
        self.assertEqual(dt.date().isoformat(), "2026-07-10")
        self.assertEqual(dt.time().strftime("%H:%M"), "22:00")
        self.assertEqual(dt.tzinfo, LOCAL_TZ)


if __name__ == "__main__":
    unittest.main()
