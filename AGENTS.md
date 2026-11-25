# Whisk

Whisk is an open-source writing workspace with coding-agent assistance. It starts
from [T3 Code](https://github.com/pingdotgg/t3code), preserving its history, MIT
license, provider integrations, and useful workspace patterns.

## Product shape

The writing is the center of the app. Assistance should help the author think,
write, and present their work while leaving them in control of their words.

### Writing space

- A blank page where the author can simply write text.
- Sparse has a selection-anchored formatting toolbar: body, title, subtitle,
  H1–H3, bullets, numbering, and quotes. Use T3's existing Tiptap engine. Keep
  formatting as validated blocks alongside canonical plain text so AI prompts
  and highlight offsets remain independent of markup.
- In Sparse, menus and panes fade after 1.2 seconds of pointer inactivity over
  the writing page, with matching 175ms fade-in and fade-out. Never fade while
  the pointer is over a feature area, while a dialog/selection action is open,
  or in Designed or Review. Preserve keyboard focus, touch, and reduced motion.
- Hideable, independently resizable left and right panes, following T3 Code's
  interaction patterns. Persist widths and keep controls usable in narrow windows.
- The left pane contains projects and files. Reuse T3 Code's project navigation
  patterns as the foundation.
- The right pane contains Context, Todos, and Designer tabs. In Review, Notes
  replaces Designer.
- Notes are read and edited in the pane, never in a dialog over the text. Selecting
  a highlight scrolls Notes to its note; selecting a note scrolls the document to
  its passage. Unsaved note edits survive tab and view changes.

### Three writing views

1. **Sparse:** white paper, black text, simple and quiet. Just the author and the
   text. Typography, colors, and related preferences belong in settings.
2. **Designed:** preview the text as its audience will see it, using the document's
   design preferences.
3. **Review:** readable text with anchored highlights, notes, todos, and agent
   resolutions. Keep the writing editor mounted to preserve undo history.

**Shadow outline is a toggle, not a view.** It works across all three views.
Unwritten passages appear as distinct, muted AI suggestions, using the current
draft, context, and answers. Generation lives in Agent settings. Suggestions
never silently replace the author's writing.

Changing views must not lose text, undo history, context, or design preferences.
Generated suggestions are separate from authored text until explicitly accepted.

### Context view

- Helps the author describe what they are trying to achieve.
- Begins with the helper text **“I am trying to…”**.
- AI-generated questions and optional answers live in Agent settings and inform
  subsequent suggestions.

### Todos, highlights, and agents

- Todos belong to a document; authors can add them directly or from a highlight.
- Match the master's thesis reader's Good, Unclear, and Comment highlights,
  quote/context anchoring, editable notes, and preservation of missing passages.
- A selection can become a note to self, a linked todo, or a direct agent request.
  Private notes are not included in agent prompts unless explicitly sent.
- Keep general AI controls, model/workspace choices, outline/design generation,
  questions, cancellation, and provider/thread links in robot-icon Agent settings.
- Contextual highlight/todo actions can send a request directly to the agent.
  Store replies against the originating document and highlight. Never silently
  rewrite text or mark a todo resolved because an agent replied.
- Review's highlight toolbar stays beside the selected text, follows scrolling
  and resizing, and stays within the writing canvas. Sparse uses formatting
  actions in that location; it does not show review/AI actions.

### Project folders and files

- New project opens a folder browser using T3's environment filesystem APIs.
  Authors can select an existing folder or create a subfolder. Use the native
  picker only for a matching local desktop environment.
- Existing browser-only projects offer **Save to folder**. Never pick a storage
  folder on the author's behalf or discard the browser draft during migration.
- Store readable Markdown documents in the chosen folder, `.whisk/project.json`
  as the manifest, and `.whisk/documents/<id>.json` for document metadata,
  formatting, highlights, todos, context, and design. Keep stable file identities.
- Queue and debounce saves, use guarded atomic writes, and keep browser recovery
  copies. Detect changed files before overwriting. Reloading a conflicting folder
  preserves unsaved browser changes as a separate recovered project.
- Opening ordinary Markdown creates writing metadata while retaining its source
  until the body is edited. Preserve unsupported source rather than dropping it.
- Importing a JSON backup detaches folder bindings. Reattaching a folder is an
  explicit user action; a backup never authorizes overwriting another machine's files.

### Designer view

- Lets the author tell the system what the text should look like.
- Includes **“Who is this for?”** and **“Where is this for?”** fields.
- Includes a free-text area for design directions.
- Design changes are reflected in the Designed view.

## Open source and upstream

- Whisk is public and welcomes contributors: features, fixes, design,
  accessibility, tests, documentation, and constructive discussion.
- **When in doubt about open-source decisions, default to what T3 Code does.**
  Consult upstream's current implementation and guidance before inventing a
  policy. The explicit Whisk product shape and welcoming contribution policy
  above take precedence over upstream's restrictions on outside feature work.
- Keep the MIT license and upstream copyright notices. Credit T3 Code and keep
  the `upstream` remote pointing to `https://github.com/pingdotgg/t3code.git`.
- Reuse upstream architecture and dependencies where practical. Keep Whisk
  changes focused so upstream improvements remain possible to merge.
- Do not present upstream's hosted services, signed apps, or releases as Whisk
  products. Upstream release/deployment workflows are retained as references in
  `.github/upstream-workflows/`; active Whisk workflows use GitHub-hosted runners.

## Current foundation and architecture

The writing workspace is in `apps/web/src/writing`, at `/write`, and is the home
screen. It shares the React/Vite web application used by the Electron wrapper.
Folder-backed projects save through T3's authenticated filesystem APIs to the
selected machine. Browser storage retains drafts, UI preferences, folder bindings,
and recovery information. Legacy browser-only projects stay local until the author
chooses **Save to folder**. Export remains an independent backup path. The native
mobile client remains upstream's agent interface until a writing surface is added there.

Writing assistance uses existing T3 Code environment commands, selected workspaces or scratch projects,
provider selection, permissions, cancellation, and thread history. Never bypass
server authorization or put provider secrets in the browser. Only explicitly
requested generations start agent turns. Keep drafts editable during generation,
associate results with the originating document, and identify stale results.

- `apps/web`: React/Vite client; `apps/desktop`: Electron wrapper.
- `apps/server`: Effect services, WebSocket transport, orchestration, providers.
- `apps/mobile`: upstream React Native client.
- `packages/contracts`: typed wire contracts.
- `packages/client-runtime`: shared client state and commands.
- `packages/shared`: shared helpers.
- `.repos`: read-only upstream dependency references; never edit or import them.

Keep complexity at integration boundaries. Prefer inferred types; avoid `any`.
Use existing UI and state patterns where they fit. New writing controls begin in
English; preserve upstream translations and keep future localization possible.
Support narrow screens, keyboard navigation, visible focus, and reduced motion.

### Desktop identity

The packaged app must be able to run beside T3 Code. Its name, app id, `whisk://`
scheme, `~/.whisk-app` home, and `whisk-desktop` profile come from
`packages/shared/src/appIdentity.ts`; keep upstream merges from restoring T3's.
It never reads or migrates T3 profiles, installs the `t3` command at launch, or
registers web links. Upstream telemetry stays off by default.

## Development and verification

Install Vite+ using the upstream [development runbook](docs/operations/development.md).
Run `vp i`, then `vp run dev --home-dir .t3 --no-seed`. Use the startup pairing URL.
The writing workspace is `/write`; provider settings and agent threads remain
available through the inherited app.

- Run `vp run check:changed` before pushing. Use focused tests while iterating.
- Do not run repository-wide suites unless requested; CI owns broad upstream checks.
- Test persistence, malformed stored data, assistant response parsing, stale
  results, and other behavior that can damage or misattribute writing.
- Preserve old version-one drafts/backups, migrating the old outline view to
  Sparse with the outline toggle enabled. Preserve orphaned highlights and todos.
- Test guarded saves, partial writes, external edits, recovery, folder imports,
  formatting round trips, and selection toolbar placement in real browser tests.
- Use real browser tests for focus, typing, view switching, and pane behavior.
- Do not start a server against `~/.t3/userdata`, write to the live installation,
  bake localhost origins into bundles, or kill processes by name or pattern.
- Never commit credentials, pairing links, generated build output, or scratch notes.
- Use conventional commit titles and focused, reviewable changes.
- Create a pull request only when asked. Do not send unsolicited messages to others.

## Local image generation

All local image generation goes through the image gate: one request at a time,
30 seconds apart. On a usage limit, pause until `resets_at`. Never call the image
tool directly. Never draw in parallel or retry a limit yourself. Chats draw with
`node /Users/tuebecksaarie/Developer/Panache/scripts/image-gate/cli.mjs draw`.
The gate backend is the sole direct-tool caller. This is a maintainer's local
setup; contributors without it should ask how to supply any needed image assets.
