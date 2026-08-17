// Stub for the `server-only` import guard when running under Vitest.
// Next.js's own bundler aliases `server-only` to a no-op on the server and
// to an error-throwing module on the client; outside that bundler (plain
// Node, as Vitest runs) it always throws. This mirrors the server-side
// behavior so unit tests can still exercise server-only modules directly.
export {};
