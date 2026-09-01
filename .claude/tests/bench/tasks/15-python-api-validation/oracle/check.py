import importlib.util
import json
import os
from pathlib import Path
import sys


root = Path(sys.argv[1]).resolve()
spec = importlib.util.spec_from_file_location("delivered_user_api", root / "user_api.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def rejects(value):
    return "seat_count" in module.validate_workspace({"seat_count": value})


results = {
    "AC1_regression_first": os.environ.get("AC1") == "pass",
    "AC2_validation_layer": rejects(True) and rejects(False),
    "AC3_integer_boundaries": (
        not rejects(1) and not rejects(100) and rejects(0) and rejects(101)
    ),
    "AC4_representation_boundaries": rejects(1.0) and rejects("1"),
    "AC5_response_compatibility": (
        module.create_workspace({"seat_count": True})["status"] == 422
        and module.create_workspace({"seat_count": 25}) == {
            "status": 201,
            "workspace": {"seat_count": 25, "marketing_opt_in": False},
        }
        and module.create_workspace({"seat_count": 25, "marketing_opt_in": True})["workspace"]["marketing_opt_in"] is True
        and "marketing_opt_in" in module.validate_workspace({"seat_count": 25, "marketing_opt_in": 1})
    ),
}
rendered = {key: "pass" if value else "fail" for key, value in results.items()}
score = sum(results.values())
print(json.dumps({
    "results": rendered,
    "score": score,
    "max": len(results),
    "verdict": "pass" if score == len(results) else "fail",
}))
