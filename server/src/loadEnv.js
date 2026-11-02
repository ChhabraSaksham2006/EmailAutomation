import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Monorepo root .env (two levels up from server/src) and current working directory .env
const ROOT_ENV_PATH = path.resolve(__dirname, '../../.env');
const CWD_ENV_PATH = path.resolve(process.cwd(), '.env');

/**
 * Loads (and reloads) environment variables from the monorepo root `.env`
 * and workspace `.env` so `--workspace=server` and `--workspace=worker`
 * always pick up the root `.env` file immediately.
 */
export function reloadEnv() {
  dotenv.config({ path: ROOT_ENV_PATH, override: true });
  if (CWD_ENV_PATH !== ROOT_ENV_PATH) {
    dotenv.config({ path: CWD_ENV_PATH, override: true });
  }
}

reloadEnv();
