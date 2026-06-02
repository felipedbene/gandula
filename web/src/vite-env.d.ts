/// <reference types="vite/client" />

/** App version, injected at build time from package.json (see vite.config.ts
 *  `define`). The UI reads this so the displayed version never drifts from the
 *  real one. */
declare const __APP_VERSION__: string;
