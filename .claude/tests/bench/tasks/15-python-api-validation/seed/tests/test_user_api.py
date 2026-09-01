import unittest

from user_api import create_workspace, validate_workspace


class WorkspaceApiTests(unittest.TestCase):
    def test_valid_workspace_defaults_marketing_preference(self):
        self.assertEqual(create_workspace({"seat_count": 25}), {
            "status": 201,
            "workspace": {"seat_count": 25, "marketing_opt_in": False},
        })

    def test_seat_range_and_marketing_type(self):
        self.assertIn("seat_count", validate_workspace({"seat_count": 0}))
        self.assertIn("seat_count", validate_workspace({"seat_count": 101}))
        self.assertIn("marketing_opt_in", validate_workspace({
            "seat_count": 25, "marketing_opt_in": "yes",
        }))


if __name__ == "__main__":
    unittest.main()
