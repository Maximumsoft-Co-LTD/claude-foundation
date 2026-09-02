# Change Loop harness walkthrough

A dependency-free interactive deck for the current OpenSpec-native workflow.

The six frames cover:

1. Change Loop's agreement → build → proof model.
2. Why lifecycle-agent orchestration was removed.
3. The `/investigate → /change → /build → /prove → /land` loop.
4. Claims, provider capabilities, adapters, receipts, and content-bound proof.
5. Receipt reuse, command deduplication, safe parallelism, and metrics.
6. Installation and the first change.

Serve the `website/` directory with any static HTTP server and open
`/demo/index.html`. Navigate with the arrow keys, Space, Page Up/Page Down,
Home/End, the on-screen controls, or the slide dots.

The deck uses `src/deck.js` for navigation and `src/main.js` for initialization.
