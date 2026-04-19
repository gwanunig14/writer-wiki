import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getAppPaths } from "./config";
import type { ProviderName } from "$lib/types/domain";

type SecretMap = Partial<Record<ProviderName, string>>;

function readSecrets(): SecretMap {
  const { secretsPath } = getAppPaths();
  if (!existsSync(secretsPath)) {
    return {};
  }

  return JSON.parse(readFileSync(secretsPath, "utf-8")) as SecretMap;
}

function writeSecrets(secrets: SecretMap) {
  const { secretsPath } = getAppPaths();
  writeFileSync(secretsPath, JSON.stringify(secrets, null, 2));
}

export function saveProviderKey(provider: ProviderName, apiKey: string) {
  const secrets = readSecrets();
  secrets[provider] = apiKey;
  writeSecrets(secrets);
}

export function getProviderKey(provider: ProviderName): string | null {
  return readSecrets()[provider] ?? null;
}
