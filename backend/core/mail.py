import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# ⚠️ replace with your actual credentials or env vars later
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587
SMTP_EMAIL = "your_email@gmail.com"
SMTP_PASSWORD = "your_app_password"


def send_email(to_email: str, subject: str, body: str) -> bool:
    try:
        msg = MIMEMultipart()
        msg["From"] = SMTP_EMAIL
        msg["To"] = to_email
        msg["Subject"] = subject

        msg.attach(MIMEText(body, "plain"))

        server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
        server.starttls()
        server.login(SMTP_EMAIL, SMTP_PASSWORD)

        server.sendmail(SMTP_EMAIL, to_email, msg.as_string())
        server.quit()

        return True

    except Exception as e:
        print(f"[MAIL ERROR] {e}")
        return False


# ========================
# Helper functions
# ========================
def send_otp_email(to_email: str, otp: str) -> bool:
    subject = "Sphere Care - Your OTP Code"
    body = f"""
Your OTP code is: {otp}

This code will expire shortly.
Do not share it with anyone.
"""
    return send_email(to_email, subject, body)


def send_password_reset_email(to_email: str, token: str) -> bool:
    subject = "Sphere Care - Password Reset"
    body = f"""
Use the following token to reset your password:

{token}

If you did not request this, ignore this email.
"""
    return send_email(to_email, subject, body)
