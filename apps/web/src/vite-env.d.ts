/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The WorkOS AuthKit client the build belongs to. Set by the deploy, per
   * environment; absent locally, on disk and in tests, which means no door.
   */
  readonly VITE_WORKOS_CLIENT_ID?: string;
  /** A hosted Runlog the dev server proxies /api and /ws to; see .env.example. */
  readonly VITE_RUNLOG_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** The app's version from package.json, and the git sha the publish workflow built; empty locally. */
declare const __RUNLOG_VERSION__: string;
declare const __RUNLOG_SHA__: string;
