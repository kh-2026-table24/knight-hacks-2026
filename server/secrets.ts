import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { join } from "node:path";

// Cloud Run sets K_SERVICE on every instance; locally it's unset.
export const onCloudRun = Boolean(process.env.K_SERVICE);

// Locally, keys come from .env.local (gitignored). On Cloud Run they're read from Secret Manager,
// using the service's own identity, so no key is ever in the code, the image or the env vars.
const ENV_FILE = join(import.meta.dirname, "..", ".env.local");

const cache = new Map<string, Promise<string>>();

/**
 * A secret's value. `envName` is the variable to read from .env.local locally; `secretName` is the
 * Secret Manager secret to read on Cloud Run.
 */
export function getSecret(envName: string, secretName: string): Promise<string> {
  let value = cache.get(envName);
  if (!value) {
    value = onCloudRun ? fromSecretManager(secretName) : fromEnvFile(envName);
    cache.set(envName, value);
    value.catch(() => cache.delete(envName));
  }
  return value;
}

async function fromEnvFile(envName: string) {
  if (!process.env[envName]) {
    try {
      process.loadEnvFile(ENV_FILE);
    } catch {
      // No .env.local: fall through to the error below.
    }
  }
  const value = process.env[envName];
  if (!value) throw new Error(`${envName} is not set. Add ${envName}=<key> to .env.local in the project root.`);
  return value;
}

async function fromSecretManager(secretName: string) {
  const client = new SecretManagerServiceClient();
  const project = await client.getProjectId();
  const [version] = await client.accessSecretVersion({ name: `projects/${project}/secrets/${secretName}/versions/latest` });
  const value = version.payload?.data?.toString().trim();
  if (!value) throw new Error(`Secret ${secretName} is empty or missing in project ${project}`);
  return value;
}
