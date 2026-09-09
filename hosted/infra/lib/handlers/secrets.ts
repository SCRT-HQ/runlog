import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { traced } from "./xray.js";

/**
 * The API's secrets, read when first needed and kept for the container.
 *
 * Every secret is created by the stack with a random placeholder so the
 * stack deploys before anyone has a key; a value that does not look like
 * the real thing means "not configured", and the feature stays off. That
 * is the switch: filling a secret turns a feature on, and no deploy is
 * needed to do it. The value never passes through this repository.
 */

export type SecretReader = (name: string) => Promise<string | null>;

/** Whether a value is the real thing, by the shape the service gives its keys. */
export function looksLike(kind: "stripe-key" | "webhook-secret" | "workos-key" | "discord-token" | "discord-secret", value: string | null | undefined): value is string {
  if (!value) return false;
  switch (kind) {
    case "discord-secret":
      // An OAuth2 client secret: thirty-two characters of base64url, no dots.
      return /^[A-Za-z0-9_-]{32}$/.test(value);
    case "discord-token":
      // Three base64url parts joined by dots: the application id encoded,
      // a timestamp, and the secret itself.
      return /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}$/.test(value);
    case "stripe-key":
      return /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(value);
    case "webhook-secret":
      return /^whsec_[A-Za-z0-9]+$/.test(value);
    case "workos-key":
      // A sandbox key reads sk_test_…; a production key is sk_ and the
      // encoded body straight after, with no environment word in it.
      return /^sk_(test_)?[A-Za-z0-9_=-]{20,}$/.test(value);
  }
}

export function secretsReader(): SecretReader {
  const client = traced(new SecretsManagerClient({}));
  const cache = new Map<string, Promise<string | null>>();
  return (name) => {
    let pending = cache.get(name);
    if (!pending) {
      pending = client
        .send(new GetSecretValueCommand({ SecretId: name }))
        .then((out) => out.SecretString?.trim() ?? null)
        .catch((error: unknown) => {
          console.error(`secret ${name} could not be read`, error);
          cache.delete(name);
          return null;
        });
      cache.set(name, pending);
    }
    return pending;
  };
}
