# Project Guidance

- Keep policy calculations deterministic and separate from AI-generated reason assessments.
- Automatically reject requests exceeding the configured monthly policy limit; this policy finding must not depend on AI output.
- A valid local-model finding of INVALID_REASON or CLARIFICATION_REQUIRED may trigger automatic rejection; model unavailability must never trigger rejection based on reason.
- Requests passing automatic screening require manager approval; automated rejections must be shown to employee and manager and recorded in the audit log.
- Do not infer diagnoses or ask for unnecessary sensitive medical details.
- Record AI assessments and human actions in the audit log with actor and timestamp.
- Enforce employee/manager roles and employee request ownership in the API, not only in the UI.
- Keep authentication secrets out of source control; manager bootstrap must use the configured one-time key.
- Preserve the FastAPI/PostgreSQL backend and React/TypeScript frontend architecture.
- Run the frontend production build, backend Python compilation, and focused tests after relevant changes.
