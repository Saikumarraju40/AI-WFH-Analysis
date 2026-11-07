from typing import Any


def automatic_rejection(policy_exceeded: bool, assessment: dict[str, Any]) -> dict[str, str | bool | None]:
    if policy_exceeded:
        return {
            "rejected": True,
            "code": "POLICY_LIMIT_EXCEEDED",
            "message": "The request exceeds the configured monthly work-from-home limit.",
        }

    reason_flag = assessment.get("ai_flag")
    if assessment.get("available") and reason_flag in {"INVALID_REASON", "CLARIFICATION_REQUIRED"}:
        if reason_flag == "INVALID_REASON":
            message = "The reason was assessed as unrelated to a work-from-home request. You may submit a new request with a valid work-related reason."
            code = "INVALID_REASON"
        else:
            message = "The reason did not include enough information to assess the request. You may submit a new request with a clear work-related reason."
            code = "INSUFFICIENT_REASON"
        return {"rejected": True, "code": code, "message": message}

    return {"rejected": False, "code": None, "message": "The request meets the initial checks and is sent for manager review."}
