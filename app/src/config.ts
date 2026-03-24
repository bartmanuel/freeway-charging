// API base URL — resolved at build time from VITE_WORKER_URL env var.
// .env             → https://freeway-charge-api.bartmanuel.workers.dev  (dev/test)
// .env.production  → https://api.letsjustdrive.app                      (prod build)
export const WORKER_URL = import.meta.env.VITE_WORKER_URL;
