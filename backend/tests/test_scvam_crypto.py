"""Tests for backend/services/scvam/crypto.py — real AES-GCM encrypt/decrypt."""
import os
import pytest

# Patch config before importing crypto
import sys
from unittest.mock import patch

# We patch SECRET_KEY so tests don't need a real .env
with patch.dict("os.environ", {"SECRET_KEY": "test-secret-key-for-unit-tests"}):
    # Re-import with patched env
    import importlib
    if "backend.core.config" in sys.modules:
        importlib.reload(sys.modules["backend.core.config"])

from backend.services.scvam.crypto import (
    encrypt_json_bundle,
    decrypt_json_bundle,
    bundle_to_b64,
    bundle_from_b64,
)


ORG_ID = 42
SAMPLE_PAYLOAD = {"summary": "Test summary", "events": [], "model": "scvam2.1"}


def test_encrypt_returns_bytes():
    blob = encrypt_json_bundle(ORG_ID, SAMPLE_PAYLOAD)
    assert isinstance(blob, bytes)


def test_encrypted_blob_longer_than_12_bytes():
    blob = encrypt_json_bundle(ORG_ID, SAMPLE_PAYLOAD)
    assert len(blob) > 12  # 12 bytes IV + ciphertext


def test_decrypt_roundtrip():
    blob = encrypt_json_bundle(ORG_ID, SAMPLE_PAYLOAD)
    result = decrypt_json_bundle(ORG_ID, blob)
    assert result["summary"] == "Test summary"
    assert result["model"] == "scvam2.1"


def test_different_org_cannot_decrypt():
    blob = encrypt_json_bundle(ORG_ID, SAMPLE_PAYLOAD)
    with pytest.raises(Exception):
        decrypt_json_bundle(ORG_ID + 1, blob)


def test_bundle_to_b64_and_back():
    blob = encrypt_json_bundle(ORG_ID, SAMPLE_PAYLOAD)
    b64 = bundle_to_b64(blob)
    assert isinstance(b64, str)
    recovered = bundle_from_b64(b64)
    assert recovered == blob


def test_invalid_blob_raises():
    with pytest.raises(ValueError):
        decrypt_json_bundle(ORG_ID, b"tooshort")


def test_each_encrypt_produces_different_ciphertext():
    blob1 = encrypt_json_bundle(ORG_ID, SAMPLE_PAYLOAD)
    blob2 = encrypt_json_bundle(ORG_ID, SAMPLE_PAYLOAD)
    # Different IVs each time
    assert blob1 != blob2
