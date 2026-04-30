from __future__ import annotations

import argparse

from ai.llm.client import chat_once


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Standalone LLM prompt runner (ai/llm only).")
    parser.add_argument("--prompt", type=str, default="", help="Single prompt to send.")
    parser.add_argument("--system", type=str, default="", help="Optional system prompt.")
    parser.add_argument(
        "--interactive",
        action="store_true",
        help="Interactive mode (type prompts until /exit).",
    )
    return parser


def _run_interactive(system_prompt: str) -> int:
    print("Interactive LLM mode. Type /exit to quit.")
    while True:
        try:
            user_text = input("\nYou> ").strip()
        except EOFError:
            return 0
        if not user_text:
            continue
        if user_text.lower() in {"/exit", "exit", "quit"}:
            return 0
        try:
            answer = chat_once(user_text, system_prompt=system_prompt)
            print(f"LLM> {answer}")
        except Exception as exc:
            print(f"[ERROR] {exc}")
            return 1


def main() -> int:
    args = _build_parser().parse_args()
    if args.interactive:
        return _run_interactive(args.system)

    if not args.prompt.strip():
        print("Provide --prompt or use --interactive.")
        return 2

    try:
        answer = chat_once(args.prompt, system_prompt=args.system)
    except Exception as exc:
        print(f"[ERROR] {exc}")
        return 1
    print(answer)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

