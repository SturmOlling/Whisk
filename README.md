# Whisk

A quiet place to write, with AI assistance when you want it.

Whisk is a public fork of [T3 Code](https://github.com/pingdotgg/t3code). We are
building on its agent integrations and workspace foundations to help people
write, think through context, and design how their words reach an audience.

## The writing foundation

- A blank writing page. Controls fade only in Sparse, and stay visible while
  you read or use a feature area.
- Resizable projects/files on the left; Context, Todos, and Designer on the right.
  In Review, Notes replaces Designer: select a highlight to see its note, or a note
  to find its passage.
- Folder-based projects with readable Markdown files and metadata beside them.
  Existing browser-only projects can be moved using **Save to folder**.
- **Sparse**, **Designed**, and **Review** views, with a separate shadow-outline toggle.
- Select text in Sparse for title, subtitle, H1–H3, bullets, numbering, and quotes.
  Selection toolbars appear beside the text and stay within the writing area.
- Good, Unclear, and Comment highlights with private notes, linked todos, and
  direct requests to your agent. Review keeps marks attached as you edit.
- Robot-icon **Agent settings** for model/workspace selection, outline/design
  generation, optional questions, and agent responses.
- Audience, destination, typography, color, and layout preferences.
- File autosave with conflict detection, browser recovery, and Markdown/JSON export.

Open `/write` after starting the app. The initial document is blank. Configure
an installed, authenticated agent through **Agent settings** to update
outlines and questions. Generations are explicit and use your provider account;
suggestions remain separate from your writing until you accept them.

This is an early foundation. **New project** lets you browse folders on a connected
machine or create a folder. A project stores stable Markdown files in that folder,
a manifest at `.whisk/project.json`, and document metadata under `.whisk/documents/`.
Notes, todos, context, design, and formatting travel with these files. Open the
same folder to load a project in another browser. This is filesystem storage,
rather than a cloud sync service.

Existing drafts remain in browser storage until you choose **Save to folder**.
Browser recovery also protects edits made just before closing or during a failed
save. Whisk refuses to overwrite a changed file; **Reload folder, keep recovery
copy** opens the disk version and keeps your unsaved work in a separate project.
Export your workspace for an additional backup. JSON backup imports detach folder
bindings so restoring a backup cannot silently overwrite existing files.

In Agent settings, use **Apply design directions** to turn free-text directions
into layout, typography, and color choices through your agent. The manual design
controls update the Designed preview immediately.

Whisk has no published releases yet. T3 Code's desktop and mobile downloads install
T3 Code, not Whisk. You can [build the desktop app](#desktop-app) yourself. There is
no mobile writing app; the mobile client in this repository is T3 Code's agent interface.

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
The explicit home directory keeps development data inside this checkout. On a Mac,
you can double-click `Start Whisk.command` instead.

The inherited [development runbook](docs/operations/development.md) and
[architecture overview](docs/internals/overview.md) explain the underlying T3
Code system. Pages under `docs/` are inherited and mostly describe upstream T3 Code.

## Desktop app

Whisk can also run as its own desktop app. It uses a separate name, data folder
(`~/.whisk-app`), and `whisk://` links, so it can sit beside T3 Code. Install the
[build prerequisites](docs/operations/development.md#desktop-artifacts), then run:

```sh
vp run dist:desktop:dmg:arm64   # Mac with Apple silicon
vp run dist:desktop:dmg:x64     # Mac with Intel
vp run dist:desktop:linux       # Linux
```

The result is in `release/`. Maintainers can also run the **Whisk desktop** workflow
on GitHub; a `whisk-v*` tag makes a draft release. Builds are unsigned and do not
update themselves. On a Mac, the first time you open a downloaded build, allow it
under System Settings → Privacy & Security.

The Intel Mac build is the one in use. The Linux build is not yet tested, the Apple
silicon build has not been built, and Windows is not set up.

The desktop app does not see drafts kept in your web browser. Use **Back up
workspace** in the browser, then **Import workspace…** in the app.

## Privacy

Whisk keeps your writing in your folders and browser. When you ask an agent for
help, it receives the text that request needs. Product usage data, which goes to
T3 Code, is off unless you turn it on with `T3CODE_TELEMETRY_ENABLED=true`.

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
