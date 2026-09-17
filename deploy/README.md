# Zalip release deployment

The running service configuration is deliberately kept outside this repository. It contains
deployment secrets and mutable data paths, so it must not be copied into a release checkout or
committed to Git.

For an update, clone the exact public source revision into an immutable release directory, then
run Docker Compose with the existing deployment configuration **first** and
`compose.release.yml` second. The override changes only the `web` build context. Existing
PostgreSQL, Redis, `/misskey/files`, `/misskey/.config` and the loopback port binding therefore
remain owned by the current deployment configuration.

Before `up -d`, make and verify a PostgreSQL dump. Build the `web` image first; only then recreate
the `web` service. After it is healthy, verify `/api/meta`, the cinema home, a public title route,
the signed-in library route, and the Source link. Record the exact commit deployed and preserve
the prior build context for rollback.
