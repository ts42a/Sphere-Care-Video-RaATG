# Standalone LLM Setup (`ai/llm`)

This folder is intentionally isolated from backend pipeline logic.
Use it to test prompts directly against your LLM provider.

## 1) Install dependency

```bash
pip install httpx
```

## 2) Set environment variables (PowerShell)

```powershell
$env:AI_LLM_PROVIDER="ollama"
$env:AI_OLLAMA_BASE_URL="http://127.0.0.1:11434"
$env:AI_OLLAMA_MODEL="llama3.2:3b"
```

## 3) Run one prompt

```bash
python -m ai.llm.chat --prompt "Say hello in one line."
```

## 4) Interactive mode

```bash
python -m ai.llm.chat --interactive
```

Optional system prompt:

```bash
python -m ai.llm.chat --interactive --system "You are concise."
```

## Notes

- `AI_LLM_PROVIDER` supports `ollama`, `openai`, `openai_compatible`.
- If provider is disabled/off, command returns an error by design.
- This module does not depend on backend workers or API routes.

