import json
import secrets
import smtplib
from datetime import date
from email.message import EmailMessage
from typing import Literal

import httpx
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine, get_db, settings
from .assessment import automatic_rejection
from .auth import create_access_token, get_current_user, hash_password, require_role, verify_password
from .models import AuditEvent, User, WfhRequest
from .policy import calculate_usage, policy_reference

app = FastAPI(title="WFH Request Assessment", version="0.1.0")


class RequestCreate(BaseModel):
    requested_dates: list[date] = Field(min_length=1)
    reason: str = Field(min_length=3, max_length=2000)

    @field_validator("requested_dates")
    @classmethod
    def dates_must_be_unique(cls, dates: list[date]) -> list[date]:
        if len(set(dates)) != len(dates):
            raise ValueError("Requested dates must be unique")
        return sorted(dates)


class LeadDecision(BaseModel):
    recommendation: Literal["recommend_approval", "request_clarification", "recommend_rejection", "consider_exception"]
    note: str = Field(default="", max_length=1000)


class ManagerDecision(BaseModel):
    decision: Literal["approved", "rejected"]
    note: str = Field(default="", max_length=1000)


class AccountInput(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=254)
    display_name: str = Field(min_length=1, max_length=120)
    job_title: str = Field(default="", max_length=120)
    department: str = Field(default="", max_length=120)
    team: str = Field(default="", max_length=120)
    password: str = Field(min_length=12, max_length=256)


class LoginInput(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=254)
    password: str = Field(min_length=1, max_length=256)


class ManagerBootstrap(AccountInput):
    bootstrap_key: str = Field(min_length=1, max_length=256)


@app.on_event("startup")
def create_tables() -> None:
    Base.metadata.create_all(bind=engine)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def account_payload(user: User, manager: User | None = None) -> dict[str, str | int | None]:
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "role": user.role,
        "job_title": user.job_title,
        "department": user.department,
        "team": user.team,
        "manager_name": manager.display_name if manager else None,
        "manager_email": manager.email if manager else None,
    }


def account_with_manager(user: User, db: Session) -> dict[str, str | int | None]:
    manager = db.scalar(select(User).where(User.email == user.manager_email)) if user.manager_email else None
    return account_payload(user, manager)


@app.post("/api/auth/bootstrap-manager", status_code=201)
def bootstrap_manager(payload: ManagerBootstrap, db: Session = Depends(get_db)) -> dict:
    if not settings.bootstrap_key:
        raise HTTPException(status_code=503, detail="Manager bootstrap is not configured")
    if not secrets.compare_digest(payload.bootstrap_key, settings.bootstrap_key):
        raise HTTPException(status_code=403, detail="Invalid bootstrap key")
    if db.scalar(select(User.id).where(User.role == "manager")):
        raise HTTPException(status_code=409, detail="A manager account already exists")
    if db.scalar(select(User.id).where(User.email == payload.email.lower())):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user = User(
        email=payload.email.lower(),
        display_name=payload.display_name,
        role="manager",
        job_title=payload.job_title,
        department=payload.department,
        team=payload.team,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"access_token": create_access_token(user), "token_type": "bearer", "user": account_with_manager(user, db)}


@app.post("/api/auth/login")
def login(payload: LoginInput, db: Session = Depends(get_db)) -> dict:
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    return {"access_token": create_access_token(user), "token_type": "bearer", "user": account_with_manager(user, db)}


@app.get("/api/auth/me")
def current_account(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return account_with_manager(user, db)


@app.post("/api/auth/employees", status_code=201)
def create_employee(
    payload: AccountInput,
    manager: User = Depends(require_role("manager")),
    db: Session = Depends(get_db),
) -> dict:
    if db.scalar(select(User.id).where(User.email == payload.email.lower())):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user = User(
        email=payload.email.lower(),
        display_name=payload.display_name,
        role="employee",
        job_title=payload.job_title,
        department=payload.department,
        team=payload.team,
        manager_email=manager.email,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return account_with_manager(user, db)


@app.get("/api/auth/users")
def list_employee_accounts(
    manager: User = Depends(require_role("manager")),
    db: Session = Depends(get_db),
) -> list[dict]:
    employees = db.scalars(
        select(User).where(User.role == "employee").order_by(User.display_name, User.email)
    ).all()
    return [account_with_manager(employee, db) for employee in employees]


@app.get("/api/policy")
def current_policy() -> dict[str, str | int]:
    return {
        "monthly_wfh_limit": settings.monthly_wfh_limit,
        "policy_reference": policy_reference(settings.monthly_wfh_limit),
    }


async def assess_reason(reason: str) -> dict[str, str | bool]:
    prompt = f"""Assess whether the employee's stated reason is sufficiently clear and work-related for a work-from-home request. Return JSON with keys reason_summary, ai_flag (STANDARD_REVIEW, ADDITIONAL_CONSIDERATION, CLARIFICATION_REQUIRED, or INVALID_REASON), explanation, and suggested_next_action (Review, Ask for clarification, Consider an exception, or Reject automatically). Use INVALID_REASON only when the reason clearly states an unrelated purpose. Use CLARIFICATION_REQUIRED when it is too vague to assess. Do not treat a medical or personal circumstance as automatically invalid, infer a diagnosis, or request sensitive details; use ADDITIONAL_CONSIDERATION for potentially relevant circumstances. This assessment is only the reason-validation input to a separate policy workflow.\nReason: {reason}"""
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(
                f"{settings.ollama_url.rstrip('/')}/api/generate",
                json={"model": settings.ollama_model, "prompt": prompt, "stream": False, "format": "json"},
            )
            response.raise_for_status()
            result = json.loads(response.json()["response"])
        allowed_flags = {"STANDARD_REVIEW", "ADDITIONAL_CONSIDERATION", "CLARIFICATION_REQUIRED", "INVALID_REASON"}
        allowed_actions = {"Review", "Ask for clarification", "Consider an exception", "Reject automatically"}
        if result.get("ai_flag") not in allowed_flags or result.get("suggested_next_action") not in allowed_actions:
            raise ValueError("Unexpected assessment values")
        return {
            "reason_summary": str(result.get("reason_summary", "Reason provided for review"))[:500],
            "ai_flag": result["ai_flag"],
            "explanation": str(result.get("explanation", "Review the stated reason."))[:1000],
            "suggested_next_action": result["suggested_next_action"],
            "available": True,
        }
    except (httpx.HTTPError, KeyError, ValueError, json.JSONDecodeError):
        return {
            "reason_summary": "AI assessment unavailable",
            "ai_flag": "STANDARD_REVIEW",
            "explanation": "The local model did not return a usable assessment. A human should review the request; this is not a policy finding.",
            "suggested_next_action": "Review",
            "available": False,
        }


def serialize_request(request: WfhRequest) -> dict:
    return {
        "id": request.id,
        "employee_id": request.employee_id,
        "employee_email": request.employee_email,
        "requested_dates": request.requested_dates,
        "reason": request.reason,
        "status": request.status,
        "lead_recommendation": request.lead_recommendation,
        "manager_decision": request.manager_decision,
        "review": request.review,
        "created_at": request.created_at.isoformat(),
    }


def add_audit(db: Session, request_id: int, event_type: str, actor: str, details: dict) -> None:
    db.add(AuditEvent(request_id=request_id, event_type=event_type, actor=actor, details=details))


def send_outcome_notification(request_id: int, recipient: str, decision: str, actor: str) -> None:
    delivery = "skipped"
    if settings.smtp_host:
        message = EmailMessage()
        display_decision = "rejected automatically" if decision == "auto_rejected" else decision
        message["Subject"] = f"Work-from-home request {display_decision}"
        message["From"] = settings.smtp_from
        message["To"] = recipient
        if decision == "auto_rejected":
            message.set_content("Your work-from-home request was rejected automatically after screening. Review the request details in the employee portal.")
        else:
            message.set_content(f"Your work-from-home request has been {decision}. Contact your manager if you have questions.")
        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
                smtp.starttls()
                if settings.smtp_username:
                    smtp.login(settings.smtp_username, settings.smtp_password or "")
                smtp.send_message(message)
            delivery = "sent"
        except (OSError, smtplib.SMTPException):
            delivery = "failed"

    with SessionLocal() as db:
        add_audit(
            db,
            request_id,
            "employee_notification",
            actor,
            {"recipient": recipient, "decision": decision, "delivery": delivery},
        )
        db.commit()


@app.post("/api/requests", status_code=201)
async def submit_request(
    payload: RequestCreate,
    background_tasks: BackgroundTasks,
    employee: User = Depends(require_role("employee")),
    db: Session = Depends(get_db),
) -> dict:
    previous_requests = db.scalars(
        select(WfhRequest).where(
            WfhRequest.employee_id == employee.email,
            WfhRequest.manager_decision == "approved",
        )
    ).all()
    previous_dates = [date.fromisoformat(day) for item in previous_requests for day in item.requested_dates]
    usage = calculate_usage(previous_dates, payload.requested_dates, settings.monthly_wfh_limit)
    assessment = await assess_reason(payload.reason)
    policy_exceedance = any(month["exceeds_limit"] for month in usage)
    automatic_decision = automatic_rejection(policy_exceedance, assessment)
    review = {
        "monthly_usage": usage,
        "reason_summary": assessment["reason_summary"],
        "policy_finding": {
            "exceeds_limit": policy_exceedance,
            "reference": policy_reference(settings.monthly_wfh_limit),
            "finding": "Exceeds configured monthly limit" if policy_exceedance else "Within configured monthly limit",
        },
        "ai_flag": assessment["ai_flag"],
        "explanation": assessment["explanation"],
        "suggested_next_action": assessment["suggested_next_action"],
        "automatic_decision": automatic_decision,
    }
    request = WfhRequest(
        employee_id=employee.email,
        employee_email=employee.email,
        requested_dates=[day.isoformat() for day in payload.requested_dates],
        reason=payload.reason,
        status="auto_rejected" if automatic_decision["rejected"] else "submitted",
        review=review,
    )
    db.add(request)
    db.flush()
    add_audit(db, request.id, "ai_assessment", "system", review)
    if automatic_decision["rejected"]:
        add_audit(db, request.id, "automatic_rejection", "system", automatic_decision)
        background_tasks.add_task(
            send_outcome_notification,
            request.id,
            employee.email,
            "auto_rejected",
            "system",
        )
    db.commit()
    db.refresh(request)
    return serialize_request(request)


@app.get("/api/requests")
def list_requests(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict]:
    query = select(WfhRequest).order_by(WfhRequest.created_at.desc())
    if user.role == "employee":
        query = query.where(WfhRequest.employee_email == user.email)
    requests = db.scalars(query).all()
    return [serialize_request(request) for request in requests]


@app.post("/api/requests/{request_id}/lead")
def record_lead_decision(
    request_id: int,
    payload: LeadDecision,
    manager: User = Depends(require_role("manager")),
    db: Session = Depends(get_db),
) -> dict:
    request = db.get(WfhRequest, request_id)
    if request is None:
        raise HTTPException(status_code=404, detail="Request not found")
    if request.status == "auto_rejected":
        raise HTTPException(status_code=409, detail="Automatically rejected requests cannot be sent for manager approval")
    request.lead_recommendation = payload.recommendation
    request.status = "awaiting_manager" if payload.recommendation != "request_clarification" else "clarification_requested"
    add_audit(db, request.id, "lead_recommendation", manager.email, payload.model_dump())
    db.commit()
    db.refresh(request)
    return serialize_request(request)


@app.post("/api/requests/{request_id}/manager")
def record_manager_decision(
    request_id: int,
    payload: ManagerDecision,
    background_tasks: BackgroundTasks,
    manager: User = Depends(require_role("manager")),
    db: Session = Depends(get_db),
) -> dict:
    request = db.get(WfhRequest, request_id)
    if request is None:
        raise HTTPException(status_code=404, detail="Request not found")
    if request.status == "auto_rejected":
        raise HTTPException(status_code=409, detail="Automatically rejected requests cannot be approved")
    if request.lead_recommendation is None:
        raise HTTPException(status_code=409, detail="A lead recommendation is required before the manager decision")
    request.manager_decision = payload.decision
    request.status = payload.decision
    add_audit(db, request.id, "manager_decision", manager.email, payload.model_dump())
    background_tasks.add_task(
        send_outcome_notification,
        request.id,
        request.employee_email,
        payload.decision,
        manager.email,
    )
    db.commit()
    db.refresh(request)
    return serialize_request(request)


@app.get("/api/requests/{request_id}/audit")
def request_audit(
    request_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    request = db.get(WfhRequest, request_id)
    if request is None:
        raise HTTPException(status_code=404, detail="Request not found")
    if user.role != "manager" and request.employee_email != user.email:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    events = db.scalars(
        select(AuditEvent).where(AuditEvent.request_id == request_id).order_by(AuditEvent.created_at)
    ).all()
    return [
        {"event_type": event.event_type, "actor": event.actor, "details": event.details, "created_at": event.created_at.isoformat()}
        for event in events
    ]
