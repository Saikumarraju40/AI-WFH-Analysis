# WFH Request Assessment

An automated screening workflow for work-from-home requests. FastAPI and PostgreSQL calculate monthly usage and store requests/audit events. The local Ollama model validates whether a reason is clear and work-related under the configured rule; only requests that pass screening go to manager review.

## Requirements

- Python 3.11+
- Node.js 20+
- Docker Desktop (or a local PostgreSQL 16+ instance)
- Ollama with `qwen2.5:3b` pulled locally for reason screening; without it, the system does not auto-reject based on the reason and sends otherwise policy-compliant requests to manager review.

## Start locally

### Docker Compose (recommended)

Install Docker Desktop from an Administrator PowerShell terminal:

```powershell
winget install --id Docker.DockerDesktop --exact --accept-package-agreements --accept-source-agreements
```

Complete Docker Desktop's first-run setup (including WSL 2 if prompted), then from the project root:

```powershell
Copy-Item .env.example .env
py -c "import secrets; print(secrets.token_urlsafe(48))"
```

Run the Python command twice and put the generated values into `.env` as `JWT_SECRET` and `BOOTSTRAP_KEY`. Then build and start PostgreSQL, Ollama with `qwen2.5:3b`, the API, and the frontend:

```powershell
docker compose up --build
```

The first start downloads the local AI model and may take several minutes. Open `http://localhost:5173`; the API docs are at `http://localhost:8000/docs`. Stop the services with `docker compose down`; PostgreSQL data and the downloaded model are preserved in named volumes.

### Manual local setup

1. Start PostgreSQL from the project root:

   ```powershell
   docker compose up -d postgres
   ```

2. In a terminal, install the API dependencies and start FastAPI:

   ```powershell
   cd backend
   Copy-Item .env.example .env
   py -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
   ```

   Before starting the API, edit `.env` and set unique random values for `JWT_SECRET` and `BOOTSTRAP_KEY`. The API is at `http://localhost:8000`; interactive API docs are at `/docs`.

3. In a second terminal, install and start the UI:

   ```powershell
   cd frontend
   npm.cmd install
   npm.cmd run dev
   ```

   Open the Vite URL printed in the terminal. The development server proxies `/api` requests to FastAPI.

4. Optional local AI setup:

   ```powershell
   ollama pull qwen2.5:3b
   ollama serve
   ```

   Configure `OLLAMA_URL` and `OLLAMA_MODEL` in the environment if needed. Backend defaults are in `backend/app/database.py`; copy `backend/.env.example` to `backend/.env` to override them. `MONTHLY_WFH_LIMIT` defaults to five calendar days.

## Workflow

Employees submit requested dates and a short reason. The backend counts approved days by calendar month independently from reason analysis. Requests over the configured monthly limit are automatically rejected. The local model can also auto-reject a clearly unrelated reason or one too vague to assess; sensitive or potentially relevant circumstances are not treated as invalid by default. If the model is unavailable, the reason is not auto-rejected and a policy-compliant request goes to manager review. Every automated rejection is recorded and shown in both employee and manager views. Requests that pass screening continue to manager approval.

The starter policy is in `policy/wfh-policy.md`; replace it with the approved company policy before production use. Final-decision emails use SMTP when `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and `SMTP_FROM` are configured; delivery status is audited. Data-retention controls and production deployment hardening are still required before real employee use.

## Separate portals

- The first manager uses **First-time manager setup** on the manager login tab with the `BOOTSTRAP_KEY` from `backend/.env`. Only one manager can be bootstrapped this way.
- After signing in, managers create employee accounts from **Employee access**. Passwords must be at least 12 characters; share them securely.
- Employee accounts include job title, department, and team. **Employee directory** lists every employee account, including manager name/email, and supports 10 or more employees without a fixed list limit.
- Employees sign in on the employee tab and can submit requests and view only their own request history. Managers can review requests and make lead recommendations and final decisions.
- Automated policy/reason rejections appear in both portals with the policy finding or reason flag; they cannot be approved through the manager review controls.
- **My details** shows the signed-in user's name, work email, role, title, department, and team; employee profiles also show the assigned manager's contact details.
- The API verifies bearer tokens and enforces roles and employee ownership; hiding controls in the UI is not the security boundary.

## Checks

```powershell
cd frontend
npm.cmd run build
cd ..\backend
.\.venv\Scripts\python.exe -m compileall app
```
