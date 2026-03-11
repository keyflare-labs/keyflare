import type {
  ListKeysResponse,
  CreateKeyResponse,
  RevokeKeyResponse,
  UpdateKeyResponse,
  KeyType,
  Permission,
  KeyScope,
} from "@keyflare/shared";
import { api } from "../api/client.js";
import { success, dim, bold } from "../output/log.js";

export async function runKeysList() {
  const data = await api.get<ListKeysResponse>("/keys");
  const { keys } = data;

  if (keys.length === 0) {
    console.log(dim("No API keys found."));
    return;
  }

  const prefixW = Math.max(6, ...keys.map((k) => k.prefix.length));
  const labelW = Math.max(5, ...keys.map((k) => k.label.length));

  console.log(
    bold(
      `${"PREFIX".padEnd(prefixW)}  ${"TYPE".padEnd(6)}  ${"LABEL".padEnd(labelW)}  ${"PERMISSION".padEnd(10)}  ${"SCOPES".padEnd(20)}  CREATED`
    )
  );
  for (const k of keys) {
    const created = new Date(k.created_at).toISOString().slice(0, 10);
    const revokedMark = k.revoked ? " [REVOKED]" : "";

    // Format permission and scopes
    const permission = k.type === "user" ? "full" : (k.permission ?? "read");
    const scopes = k.scopes
      ? k.scopes.map((s) => `${s.project}:${s.environment}`).join(", ")
      : (k.type === "user" ? "*" : "-");

    console.log(
      `${k.prefix.padEnd(prefixW)}  ${k.type.padEnd(6)}  ${k.label.padEnd(labelW)}  ${permission.padEnd(10)}  ${scopes.padEnd(20)}  ${created}${revokedMark}`
    );
  }
}

export async function runKeysCreate(opts: {
  type: KeyType;
  label: string;
  scope?: string[];
  permission?: Permission;
}) {
  // Validate system key requirements
  if (opts.type === "system") {
    if (!opts.scope || opts.scope.length === 0) {
      throw new Error(
        "System keys require --scope <project:environment>.\n" +
          "Example: --scope my-api:production\n" +
          "Use * for environment wildcard: --scope my-api:*"
      );
    }
    if (!opts.permission) {
      throw new Error(
        "System keys require --permission <read|readwrite>.\n" +
          "  read      — can only fetch secrets\n" +
          "  readwrite — can fetch and write secrets"
      );
    }
  }

  const scopes: KeyScope[] | undefined = opts.scope?.map((s) => {
    const [project, environment] = s.split(":");
    if (!project || !environment) {
      throw new Error(
        `Invalid scope "${s}" — expected format: project:environment`
      );
    }
    return { project: project.toLowerCase(), environment: environment.toLowerCase() };
  });

  const body: Record<string, unknown> = {
    type: opts.type,
    label: opts.label,
  };
  if (scopes) body.scopes = scopes;
  if (opts.permission) body.permission = opts.permission;

  const data = await api.post<CreateKeyResponse>("/keys", body);

  success(`API key created`);
  console.log(`\n  ${data.key}\n`);
  console.log(dim("⚠  Save this key — it cannot be retrieved again."));
}

export async function runKeysRevoke(prefix: string) {
  const data = await api.delete<RevokeKeyResponse>(`/keys/${prefix}`);
  success(`Key "${data.revoked}" revoked`);
}

export async function runKeysUpdate(prefix: string, opts: {
  scope: string[];
  permission: Permission;
}) {
  // Parse scopes
  const scopes: KeyScope[] = opts.scope.map((s) => {
    const [project, environment] = s.split(":");
    if (!project || !environment) {
      throw new Error(
        `Invalid scope "${s}" — expected format: project:environment`
      );
    }
    return { project: project.toLowerCase(), environment: environment.toLowerCase() };
  });

  const body = {
    scopes,
    permission: opts.permission,
  };

  const data = await api.put<UpdateKeyResponse>(`/keys/${prefix}`, body);

  const scopesStr = data.scopes.map((s) => `${s.project}:${s.environment}`).join(", ");
  success(`Key "${prefix}" updated`);
  console.log(`\n  Type:       ${data.type}`);
  console.log(`  Label:      ${data.label}`);
  console.log(`  Permission: ${data.permission}`);
  console.log(`  Scopes:     ${scopesStr}\n`);
}
