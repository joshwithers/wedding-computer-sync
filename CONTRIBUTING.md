# Contributing

Thanks for your interest in improving Wedding Computer Sync!

## Bugs and ideas

Open an issue on this repo with what you expected, what happened, and the
plugin + Obsidian versions. Sync issues are much easier to chase with the
relevant lines from the developer console (Cmd/Ctrl+Shift+I) — the plugin
logs under `[wedding-computer-sync]`.

Issues that involve the server side of sync (the vault API) may get moved
to the main app repo:
[joshwithers/wedding-computer](https://github.com/joshwithers/wedding-computer).

## Development setup

```bash
npm install
npm run dev        # watch build → main.js
npm run typecheck  # strict TypeScript
npm run lint       # typescript-eslint type-checked rules — keep it at zero
npm run build      # production build
```

Copy `main.js` + `manifest.json` into
`<your vault>/.obsidian/plugins/wedding-computer-sync/` and reload Obsidian
to test. Point the plugin at a local Wedding Computer instance by changing
the Server URL in its settings.

## Pull requests

- Keep the plugin mobile-safe: use Obsidian's `requestUrl` and Vault API,
  never Node or Electron APIs.
- The sync token must only ever live in device-local storage
  (`app.saveLocalStorage`) — never in `data.json` or anything that syncs
  with the vault.
- Match the existing code style; `npm run typecheck` must pass.
- Releases are cut by tagging `main` with the version number (matching
  `manifest.json`); CI builds, attests, and attaches the assets.

## License

AGPL-3.0 — contributions are accepted under the same license.
