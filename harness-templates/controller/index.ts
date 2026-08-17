/**
 * Harness controller — uses @fsm/engine to execute fsm.json.
 *
 * Environment (see .env.example):
 *   OPENAI_API_KEY, ANTHROPIC_API_KEY, PLATFORM_SECRET
 */
import { runFsm } from "@fsm/engine";

void runFsm;

console.log(
  "Controller stub using @fsm/engine. Wire executors and run fsm.json."
);
