def validate_workspace(payload):
    errors = {}
    seat_count = payload.get("seat_count")
    if not isinstance(seat_count, int) or seat_count < 1 or seat_count > 100:
        errors["seat_count"] = "must be an integer between 1 and 100"

    marketing_opt_in = payload.get("marketing_opt_in", False)
    if not isinstance(marketing_opt_in, bool):
        errors["marketing_opt_in"] = "must be a boolean"
    return errors


def create_workspace(payload):
    errors = validate_workspace(payload)
    if errors:
        return {"status": 422, "errors": errors}
    return {
        "status": 201,
        "workspace": {
            "seat_count": payload["seat_count"],
            "marketing_opt_in": payload.get("marketing_opt_in", False),
        },
    }
