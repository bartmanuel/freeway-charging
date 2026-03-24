/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_API_KEY: string;
  readonly VITE_OCM_API_KEY: string;
  readonly VITE_WORKER_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
