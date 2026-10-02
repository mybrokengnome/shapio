# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub's
**Report a vulnerability** form on this repository (Security → Advisories), with:

- the affected version (`npx shapio version`) and install path (npm or Docker);
- what an attacker can do, and the steps or a proof of concept to reproduce it;
- any configuration it depends on (for example `TRUST_PROXY`, `BASE_PATH`, the storage driver).

You will get an answer within a few days. Once a fix is available we publish a release and an advisory, and
credit you unless you prefer otherwise.

## Supported versions

Security fixes go into the latest release. Shapio is pre-1.0: upgrade to the newest version to get them.

## Scope

In scope: the `shapio` server and CLI, the admin, the published packages (`@shapio/client`,
`@shapio/schema`, `@shapio/editor-sdk`, `create-shapio`), the Docker image and the example configurations in
this repository. Out of scope: vulnerabilities in a self-hoster's own extensions, custom editors or
infrastructure, and reports that need an already compromised admin account or server.

Installs exposed to the internet before first-run setup should set `SETUP_REQUIRE_TOKEN=true` or run
`shapio admin create` first: by default the first person to open the Setup screen creates the owner.

Shapio sends no telemetry or error reports anywhere. An error reporter wired in through an extension is the
self-hoster's own code and configuration.

How Shapio is secured, and a production checklist: [documentation/security.md](documentation/security.md).
