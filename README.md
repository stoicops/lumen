# Lumen Local Studio

Development starter for a local, GUI-first software inspection companion powered by REA. Independent project; no upstream endorsement implied.

## Run

Requires Node 24.11+ and a desktop supported by Electron.

```bash
npm ci
npm test
npm run build
npm run verify:rea
npm start
```

Select an extracted JavaScript application folder or ASAR. Static analysis does not launch the target. Projects and full evidence bundles are saved in the app's user-data directory. Open LM Studio's local server at 127.0.0.1:1234 or Ollama at 127.0.0.1:11434, load a model, refresh discovery, and ask a question over the summary. Analysis works without a model.

The current UI exposes the raw summary; the visual map, beginner findings, streaming/multi-turn chat and installers remain future work. This is not a released or production-hardened application. See CLAUDE.md for concrete limitations and next actions.

The app restricts its model requests to numeric loopback HTTP endpoints and rejects redirects. A separately configured provider might relay requests elsewhere; this app cannot enforce the provider's own networking.

## Files

- docs/REQUIREMENTS.md: full acceptance criteria and milestones.
- docs/UPSTREAM-NOTES.md: inspected engine contracts and integration pitfalls.
- CLAUDE.md: implementation state and continuation instructions.
- VERIFIED.md: recorded verification outcomes.
- src/core: REA adapter, local provider and project store.
- src/desktop: trusted main and sandboxed preload bridge.
- src/ui: React interface.
- fixtures/simple-app: owned input fixture; do not execute during static tests.

No proprietary assets are bundled. Review dependency licences and packaging before distribution.
