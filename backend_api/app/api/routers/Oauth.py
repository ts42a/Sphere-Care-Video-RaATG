"""
oauth.py — Google OAuth 2.0 router

    GET  /auth/google/login       Redirect user to Google consent screen
    GET  /auth/google/callback    Handle Google callback, return JWT
"""
import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse

from app.core.config import SECRET_KEY as JWT_SECRET_KEY
from app import models, schemas
from app.db.session import SessionLocal
from jose import jwt
from datetime import datetime, timedelta

router = APIRouter(prefix="/auth", tags=["OAuth"])

# ── CONFIG ──────────────────────────────────────────
import os
GOOGLE_CLIENT_ID     = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI  = "http://localhost:8000/auth/google/callback"

GOOGLE_AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO  = "https://www.googleapis.com/oauth2/v3/userinfo"

FRONTEND_SUCCESS = "http://localhost:5500/src/pages/dashboard.html"
FRONTEND_FAIL    = "http://localhost:5500/src/pages/register-login.html?error=oauth_failed"

JWT_SECRET    = JWT_SECRET_KEY
JWT_ALGORITHM = "HS256"
JWT_EXPIRE    = 60 * 24  # 24 hours in minutes


# ── HELPERS ─────────────────────────────────────────

def _create_token(user_id: int, email: str, role: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=JWT_EXPIRE)
    return jwt.encode(
        {"sub": str(user_id), "email": email, "role": role, "exp": expire},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


def _get_or_create_user(email: str, full_name: str) -> models.User:
    """Find existing user by email, or create a new one for OAuth logins."""
    db = SessionLocal()
    try:
        user = db.query(models.User).filter(models.User.email == email).first()
        if not user:
            user = models.User(
                full_name=full_name,
                email=email,
                password_hash="oauth_google",  # no password for OAuth users
                role="staff",
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        return user
    finally:
        db.close()


# ── ROUTES ──────────────────────────────────────────

@router.get("/google/login")
def google_login():
    """
    Redirect the browser to Google's OAuth consent screen.
    Called when user clicks the Google button in register-login.html.
    """
    params = {
        "client_id":     GOOGLE_CLIENT_ID,
        "redirect_uri":  GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope":         "openid email profile",
        "access_type":   "online",
        "prompt":        "select_account",
    }
    query = "&".join(f"{k}={v}" for k, v in params.items())
    return RedirectResponse(url=f"{GOOGLE_AUTH_URL}?{query}")


@router.get("/google/callback")
async def google_callback(code: str = None, error: str = None):
    """
    Google redirects here after the user approves.
    Exchange code → token → user info → JWT → redirect to dashboard.
    """
    if error or not code:
        return RedirectResponse(url=FRONTEND_FAIL)

    async with httpx.AsyncClient() as client:
        # 1. Exchange code for access token
        token_res = await client.post(GOOGLE_TOKEN_URL, data={
            "code":          code,
            "client_id":     GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri":  GOOGLE_REDIRECT_URI,
            "grant_type":    "authorization_code",
        })
        if token_res.status_code != 200:
            return RedirectResponse(url=FRONTEND_FAIL)

        access_token = token_res.json().get("access_token")

        # 2. Fetch user info from Google
        info_res = await client.get(
            GOOGLE_USERINFO,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if info_res.status_code != 200:
            return RedirectResponse(url=FRONTEND_FAIL)

        info      = info_res.json()
        email     = info.get("email")
        full_name = info.get("name", email)

    if not email:
        return RedirectResponse(url=FRONTEND_FAIL)

    # 3. Get or create user in DB
    user = _get_or_create_user(email=email, full_name=full_name)

    # 4. Create JWT
    jwt_token = _create_token(user.id, user.email, user.role)

    # 5. Redirect to frontend dashboard with token in URL fragment
    #    The frontend JS reads it and stores in localStorage
    return RedirectResponse(
        url=f"{FRONTEND_SUCCESS}?token={jwt_token}"
    )
