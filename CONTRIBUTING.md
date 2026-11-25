# Contributing to Whisk

Whisk welcomes contributions from everyone. Useful work includes writing
features, bug fixes, accessibility, design, tests, documentation, and feedback.
You do not need to be a maintainer or vouched contributor to open an issue or PR.

Read [AGENTS.md](AGENTS.md) for the product shape and architecture. When in doubt
about open-source decisions, follow [T3 Code](https://github.com/pingdotgg/t3code),
while honoring Whisk's explicit direction and contribution policy.

## Get started

1. Fork Whisk and clone your fork.
2. Install [Vite+](https://viteplus.dev/guide/) and run `vp i`.
3. Run `vp run dev --home-dir .t3 --no-seed` and open its private pairing URL.
4. Visit `/write` for the writing workspace.

To build the desktop app, see [Desktop app](README.md#desktop-app). Its identity is
in `packages/shared/src/appIdentity.ts`.

Keep development state inside `.t3`. Never test against a live T3 Code database.
To keep upstream available, add `git remote add upstream https://github.com/pingdotgg/t3code.git`.

## Propose and build

Search existing [issues](https://github.com/SturmOlling/Whisk/issues) before
starting. Small improvements can go straight to a PR. For a large change, open
an issue first so we can discuss the approach and avoid duplicated work.

Keep each PR focused. Explain the problem, what changes for the writer, and how
you checked it. Use a conventional title such as `feat(writing): add document
search`. Include screenshots for visual changes, and never include private
writing, provider credentials, or pairing URLs in examples.

Run focused tests during development and `vp run check:changed` before pushing.
Test behavior that could lose or misattribute writing. Broad upstream suites
are not required for a small writing change. Say clearly if a check could not run.

AI-assisted contributions are welcome. Review the result, understand the code,
and report the checks you actually ran. Be kind, specific, and constructive in
issues and reviews. Contributions are licensed under the repository's MIT license.
