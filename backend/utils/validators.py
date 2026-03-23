def validate_password(password: str):
    if len(password) < 6:
        raise ValueError("Password too short")
