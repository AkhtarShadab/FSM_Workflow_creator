#!/usr/bin/env bash
# Echoes TOOL_ARGS and emits a SCRIPT.NEXT signal (D6 last-line contract).
echo "echo: start"
echo "echo: args=${TOOL_ARGS}"
echo '::SCRIPT.NEXT|message="ok"'
