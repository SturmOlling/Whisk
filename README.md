# Whisk

A quiet place to write, with AI assistance when you want it.

Whisk is a public fork of [T3 Code](https://github.com/pingdotgg/t3code). We are
building on its agent integrations and workspace foundations to help people
write, think through context, and design how their words reach an audience.

## The writing foundation

- A blank writing page with controls that recede while you write.
- Projects and documents in a hideable left pane; context and design on the right.
- **Sparse**, **Shadow outline**, and **Designed** views of the same draft.
- Optional AI questions and outline suggestions, using your configured agent.
- Audience, destination, typography, color, and layout preferences.
- Browser-local autosave and Markdown/JSON export.

Open `/write` after starting the app. The initial document is blank. Configure
an installed, authenticated agent in the inherited provider settings to update
outlines and questions. Generations are explicit and use your provider account;
suggestions remain separate from your writing until you accept them.

This is an early foundation. Writing data lives in this browser, rather than
server-backed files, and does not sync across devices. Export your work for a
backup. Native mobile still has T3 Code's agent interface. Use **Apply design directions** to turn free-text directions into layout,
typography, and color choices through your agent. The manual design controls
update the Designed preview immediately. Upstream desktop/mobile downloads install T3 Code,
not Whisk; Whisk does not yet publish packaged releases.

## Run from source

Install [Vite+](https://viteplus.dev/guide/) (it manages the pinned Node and pnpm
versions), then:

```sh
git clone https://github.com/SturmOlling/Whisk.git
cd Whisk
vp i
vp run dev --home-dir .t3 --no-seed
```

Open the pairing URL printed by the dev runner. Do not publish that URL or token.
The explicit home directory keeps development data inside this checkout.

The inherited [development runbook](docs/operations/development.md) and
[architecture overview](docs/internals/overview.md) explain the underlying T3
Code system. Some inherited documentation still describes upstream T3 Code.

## Contribute

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup,
verification, and ways to help. [AGENTS.md](AGENTS.md) records the product shape
and engineering guidance; [CLAUDE.md](CLAUDE.md) points to the same instructions.

When in doubt about open-source decisions, default to what T3 Code does, while
honoring Whisk's product direction and welcoming contribution policy.

## License and attribution

[MIT](LICENSE), the same license as T3 Code. Copyright notices and upstream
history are preserved. Whisk is an independent project and is not an official
T3 Tools product. Thank you to the T3 Code team and contributors.
