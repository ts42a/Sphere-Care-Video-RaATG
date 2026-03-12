"""
password_reset.py — Forgot Password router

    POST /auth/forgot-password     Send reset email
    POST /auth/reset-password      Reset password with token
"""
import os
import secrets
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr

from app.api.deps import get_db
from app import models
from app.core.config import SECRET_KEY
import bcrypt

router = APIRouter(prefix="/auth", tags=["Password Reset"])

# ── CONFIG ──
GMAIL_ADDRESS  = os.getenv("GMAIL_ADDRESS",  "carllu2537153344@gmail.com")
GMAIL_APP_PASS = os.getenv("GMAIL_APP_PASS", "")
FRONTEND_URL   = os.getenv("FRONTEND_URL",   "http://localhost:5500/src/pages")

# In-memory token store: { token: { user_id, expires_at } }
# For production use a DB table instead
_reset_tokens: dict = {}


# ── SCHEMAS ──
class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


# ── HELPERS ──
def _send_reset_email(to_email: str, reset_link: str):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Sphere Care — Reset Your Password"
    msg["From"]    = GMAIL_ADDRESS
    msg["To"]      = to_email

    html = f"""
    <div style="font-family:Manrope,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f0f4f8;border-radius:16px;">
      <div style="text-align:center;margin-bottom:24px;">
        <h2 style="color:#0f1b2d;font-size:22px;margin:0;">Sphere Care</h2>
        <p style="color:#5a6170;font-size:13px;margin:4px 0 0;">AI-Powered Aged Care Platform</p>
      </div>
      <div style="background:#fff;border-radius:14px;padding:28px;border:1px solid #e2e8f0;">
        <h3 style="color:#0f1b2d;font-size:18px;margin:0 0 12px;">Reset Your Password</h3>
        <p style="color:#5a6170;font-size:14px;line-height:1.6;margin:0 0 24px;">
          We received a request to reset your Sphere Care password.
          Click the button below to create a new password. This link expires in <strong>30 minutes</strong>.
        </p>
        <a href="{reset_link}"
           style="display:block;text-align:center;background:#0f1b2d;color:#fff;text-decoration:none;
                  padding:14px 24px;border-radius:10px;font-weight:700;font-size:14px;">
          Reset Password
        </a>
        <p style="color:#9aa0ac;font-size:12px;margin:20px 0 0;text-align:center;">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    </div>
    """

    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(GMAIL_ADDRESS, GMAIL_APP_PASS)
        server.sendmail(GMAIL_ADDRESS, to_email, msg.as_string())


# ── ROUTES ──

@router.post("/forgot-password")
def forgot_password(req: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """
    Check if email exists, generate a reset token, send email.
    Always returns 200 to avoid leaking which emails are registered.
    """
    user = db.query(models.User).filter(models.User.email == req.email).first()

    if user:
        token      = secrets.token_urlsafe(32)
        expires_at = datetime.utcnow() + timedelta(minutes=30)
        _reset_tokens[token] = {"user_id": user.id, "expires_at": expires_at}

        reset_link = f"{FRONTEND_URL}/register-login.html?reset_token={token}"

        try:
            _send_reset_email(req.email, reset_link)
        except Exception as e:
            # Don't expose email errors to client
            print(f"Email send error: {e}")

    return {"message": "If that email exists, a reset link has been sent."}


@router.post("/reset-password")
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    """
    Validate token and update password.
    """
    entry = _reset_tokens.get(req.token)

    if not entry:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token.")

    if datetime.utcnow() > entry["expires_at"]:
        del _reset_tokens[req.token]
        raise HTTPException(status_code=400, detail="Reset token has expired.")

    if len(req.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")

    user = db.query(models.User).filter(models.User.id == entry["user_id"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    user.password_hash = bcrypt.hashpw(
        req.new_password.encode(), bcrypt.gensalt()
    ).decode()
    db.commit()

    del _reset_tokens[req.token]

    return {"message": "Password reset successful."}