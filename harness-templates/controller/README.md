# Controller

This stub is the exported run loop. It uses `@fsm/engine` — the same
package the platform uses — so exported runs and in-app runs share one
implementation.

Wire live executors and the gRPC tool bridge before replacing the stub
`index.ts` entrypoint.
