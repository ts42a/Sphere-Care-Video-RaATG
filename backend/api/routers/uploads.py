"""
upload.py — Universal File Upload router

Any page in Sphere Care that needs to upload files uses this router.
"""

import os
import uuid
from fastapi import APIRouter, UploadFile, File, HTTPException, Query
from fastapi.responses import JSONResponse

router = APIRouter(tags=["Upload"])

#storage folders
UPLOAD_ROOTS = {
    "image":    "uploads/images",
    "video":    "uploads/videos",
    "audio":    "uploads/audio",
    "document": "uploads/documents",
}
for path in UPLOAD_ROOTS.values():
    os.makedirs(path, exist_ok=True)

#limits
MAX_FILE_MB    = 500
MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024

#allowed MIME types → category
MIME_CATEGORY = {
    # images
    "image/jpeg":    "image",
    "image/png":     "image",
    "image/gif":     "image",
    "image/webp":    "image",
    "image/svg+xml": "image",
    "image/bmp":     "image",
    # video
    "video/mp4":       "video",
    "video/quicktime": "video",
    "video/x-msvideo": "video",
    "video/webm":      "video",
    "video/mpeg":      "video",
    "video/ogg":       "video",
    "video/x-matroska": "video",
    "video/3gpp":      "video",
    # audio
    "audio/mpeg":      "audio",
    "audio/mp4":       "audio",
    "audio/ogg":       "audio",
    "audio/wav":       "audio",
    "audio/webm":      "audio",
    "audio/aac":       "audio",
    "audio/flac":      "audio",
    "audio/x-m4a":     "audio",
    "audio/x-wav":     "audio",
    "audio/vnd.wav":   "audio",
    # documents
    "application/pdf":  "document",
    "application/msword": "document",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
    "application/vnd.ms-excel": "document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
    "application/vnd.ms-powerpoint": "document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
    "text/plain": "document",
    "text/csv":   "document",
}


#helpers
def _fmt_size(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size / (1024 * 1024):.1f} MB"


async def _save_file(file: UploadFile) -> dict:
    """Validate and save one UploadFile. Returns file info dict."""
    content_type = file.content_type or ""

    if content_type not in MIME_CATEGORY:
        raise HTTPException(
            status_code=415,
            detail=f"File type '{content_type}' not allowed. "
                   f"Supported: images, videos, PDF, Word, Excel, PowerPoint, plain text.",
        )

    data = await file.read()

    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"'{file.filename}' exceeds the {MAX_FILE_MB} MB limit.",
        )

    category = MIME_CATEGORY[content_type]
    folder   = UPLOAD_ROOTS[category]

    # sanitise filename
    original  = file.filename or "file"
    safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in original)
    unique    = f"{uuid.uuid4().hex}_{safe_name}"
    save_path = os.path.join(folder, unique)

    with open(save_path, "wb") as f:
        f.write(data)

    # Build URL from the actual folder path (avoids image→images, audio→audios mismatches)
    url_subpath = UPLOAD_ROOTS[category]  # e.g. "uploads/audio"
    return {
        "url":           f"/{url_subpath}/{unique}",
        "filename":      original,
        "size":          len(data),
        "size_readable": _fmt_size(len(data)),
        "type":          category,        # "image" | "video" | "audio" | "document"
        "content_type":  content_type,
    }


#routes

@router.post("/file")
async def upload_single_file(file: UploadFile = File(...)):
    """
    Upload a single file. Used by Messages, Records, Flags, etc.

    Returns:
        url           – e.g. /uploads/images/abc123_photo.jpg
        filename      – original filename
        size          – bytes
        size_readable – e.g. "2.4 MB"
        type          – "image" | "video" | "document"
        content_type  – original MIME type
    """
    result = await _save_file(file)
    return JSONResponse(content=result, status_code=201)


@router.post("/files")
async def upload_multiple_files(files: list[UploadFile] = File(...)):
    """
    Upload multiple files in one request.
    If any file fails, the whole request fails and already-saved files are cleaned up.

    Returns: { files: [...], count: N }
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")

    saved_paths = []
    results     = []

    try:
        for file in files:
            info = await _save_file(file)
            results.append(info)
            category = info["type"]
            filename = info["url"].split("/")[-1]
            saved_paths.append(os.path.join(UPLOAD_ROOTS[category], filename))
    except HTTPException:
        # clean up any files already saved in this batch
        for path in saved_paths:
            try:
                os.remove(path)
            except OSError:
                pass
        raise

    return JSONResponse(content={"files": results, "count": len(results)}, status_code=201)


@router.delete("/file")
async def delete_file(url: str = Query(..., description="The /uploads/... URL returned at upload time")):
    """
    Delete a previously uploaded file by its URL.

    Example: DELETE /upload/file?url=/uploads/images/abc123_photo.jpg
    """
    if not url.startswith("/uploads/"):
        raise HTTPException(status_code=400, detail="Invalid file URL.")

    relative  = url[len("/uploads/"):]        # e.g. images/abc123_photo.jpg
    full_path = os.path.join("uploads", relative)

    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="File not found.")

    # prevent path traversal
    abs_path = os.path.realpath(full_path)
    abs_base = os.path.realpath("uploads")
    if not abs_path.startswith(abs_base):
        raise HTTPException(status_code=400, detail="Invalid path.")

    os.remove(abs_path)
    return JSONResponse(content={"deleted": True, "url": url})
