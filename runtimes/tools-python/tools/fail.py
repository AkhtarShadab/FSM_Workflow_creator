"""Raises to demonstrate a non-zero exit and traceback on stderr."""

DESCRIPTION = "Raises RuntimeError so Execute returns ::SCRIPT.ERROR"


def run(args, payload):
    print("fail: raising")
    raise RuntimeError("tool failed")
