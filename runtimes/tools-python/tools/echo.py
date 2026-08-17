"""Echoes args and payload; emits a SCRIPT.NEXT signal."""

ARG_SCHEMA = {
    "type": "object",
    "properties": {"text": {"type": "string"}},
}

DESCRIPTION = "Echoes args and payload; emits a SCRIPT.NEXT signal"


def run(args, payload):
    print("echo: start")
    print("echo: tool=echo")
    return {
        "signal": '::SCRIPT.NEXT|message="ok"',
        "result": {"args": args, "payload": payload},
    }
