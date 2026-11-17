# event-storming-mcp

A live EventStorming board for [scrum-domain-modeling](docs/data-format.md) domain models.

- **One local server** shows each registered model as a live board. Every open page redraws within a second when the model changes, so a meeting can watch one diagram on a shared screen while an agent edits it.
- **An MCP server** lets agents read, search and edit the model with validation, see the history and restore a version.
- **Drag to pan**: drag empty canvas with the mouse to move the big picture, state diagrams and context map, on the board and in the generated pages; pinch or Ctrl/⌘ + wheel zooms.
- **Inline editing** on the big picture: double-click a sticky to change its text, add and delete stickies, drag from a sticky's handle to draw an arrow, select an arrow and press Delete.
- **History** of every change (person, agent or file), with the board before and after side by side and a restore button.
- **The model CLI** (`init`, `validate`, `render`, `check`) that renders the committed HTML pages.

The model is the JSON in the product repository (`data/*.json`); the HTML pages are generated from it and committed too. The format is in [docs/data-format.md](docs/data-format.md).

## Run

Node 22.18 or later. Nothing to install: `npx` fetches it from GitHub.

```sh
npx -y github:nowly-lab/event-storming-mcp add <model-dir>   # register a model folder (the one with data/big-picture.json)
npx -y github:nowly-lab/event-storming-mcp                   # start the server and open the board
npx -y github:nowly-lab/event-storming-mcp status | stop
```

## MCP

Claude Code:

```sh
claude mcp add event-storming -- npx -y github:nowly-lab/event-storming-mcp mcp
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.event-storming]
command = "npx"
args = ["-y", "github:nowly-lab/event-storming-mcp", "mcp"]
```

`mcp` is a stdio server that starts the shared server when none runs and relays to its `/mcp` (Streamable HTTP), so every agent and page sees one store. Tools:

| Tool | What it does |
| --- | --- |
| `list_projects`, `register_project` | Registered models; register a model folder |
| `get_model`, `find_nodes`, `validate` | Read the data and its version, find stickies, check rules |
| `apply_changes` | Edit with ops (`addNode`, `updateNode`, `removeNode`, `addEdge`, `removeEdge`, `upsertDomain`, `replaceFile`) based on the version you read |
| `list_history`, `get_version`, `restore_version` | History and restore |
| `open_page` | The board's URL, optionally opened in the browser |

## Rules the store keeps

- A write names the version it was based on and is refused when that is no longer the latest; nothing is overwritten silently.
- Structural errors (broken shape, unknown or duplicate ids) are refused. Modeling-rule violations are saved as a draft and shown on the board; the committed HTML is written only when the whole model validates.
- Deleting a sticky also removes its arrows, the stickies attached to it, glossary references and the transitions that use it. The page lists them before you confirm.
- Edits to the JSON files from outside (an agent, git) become new versions.
- One project per repository and model folder: several checkouts (worktrees) of one repository share a project and its history. Writes go to the checkout chosen on the page (the latest registered by default).

## Model CLI

```sh
npx -y github:nowly-lab/event-storming-mcp init     <model-dir>              # empty data files; never overwrites
npx -y github:nowly-lab/event-storming-mcp validate <model-dir>
npx -y github:nowly-lab/event-storming-mcp render   <model-dir>              # validate, then write the HTML pages
npx -y github:nowly-lab/event-storming-mcp check    <model-dir> [--repo DIR] # pages current; with --repo every evidence path and symbol exists
```

Exit codes: 0 ok, 1 fix the data or pages, 2 usage.

## Data and safety

- State lives in `~/.event-storming-mcp` (`EVENT_STORMING_MCP_DATA_DIR` changes it): `projects/<slug>/project.json`, `projects/<slug>/history.jsonl` (one line per version) and `blobs/<sha256>` (file contents, stored once). No database.
- The server listens on 127.0.0.1 only and checks the Host header. Page writes carry a per-page nonce; `/mcp` refuses requests with an `Origin` header.
- One server per data folder: before touching any model it listens on a lock port derived only from the folder, and the operating system lets one process hold that port. The page's HTTP port is separate (random, or `--port` / `EVENT_STORMING_MCP_PORT`).
- `EVENT_STORMING_MCP_BROWSER=none` opens no browser.

## Develop

```sh
npm install
npm test           # node --test
npm run typecheck
npm run build
node scripts/compare-renders.mjs <model-dir>...                      # render matches the committed pages, byte for byte
node scripts/e2e-browser.mjs <server-url> <slug> <model-dir> <out>   # browser check with system Chrome
node scripts/e2e-session.mjs <server-url> <slug> <out>               # 「このセッションの変更」 and the mouse wheel (changes the model: use a copy)
node scripts/e2e-timeline.mjs <server-url> <slug> <out>              # timeline lanes (use a copy of test/model/fixtures/timeline)
```

The ELK layout bundle in `model/vendor` is elkjs 0.9.3 under EPL-2.0 ([ELK-LICENSE.md](model/vendor/ELK-LICENSE.md)); the rest is MIT.
