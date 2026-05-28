from __future__ import annotations

import base64
import hashlib
import json
import os
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from backend.core import config as app_config


def _derive_key(organization_id: int) -> bytes:
    material = f"{app_config.SECRET_KEY}:scvam:{organization_id}".encode("utf-8")
    return hashlib.sha256(material).digest()


def encrypt_json_bundle(organization_id: int, payload: dict[str, Any]) -> bytes:
    """AES-GCM encrypt JSON; returns iv(12) + ciphertext wire format."""
    key = _derive_key(organization_id)
    iv = os.urandom(12)
    aes = AESGCM(key)
    plain = json.dumps(payload, ensure_ascii=True).encode("utf-8")
    ct = aes.encrypt(iv, plain, None)
    return iv + ct


def decrypt_json_bundle(organization_id: int, blob: bytes) -> dict[str, Any]:
    if len(blob) < 13:
        raise ValueError("Invalid scvam.enc blob")
    iv, ct = blob[:12], blob[12:]
    key = _derive_key(organization_id)
    plain = AESGCM(key).decrypt(iv, ct, None)
    return json.loads(plain.decode("utf-8"))


def bundle_to_b64(blob: bytes) -> str:
    return base64.b64encode(blob).decode("ascii")


def bundle_from_b64(b64: str) -> bytes:
    return base64.b64decode(b64)
