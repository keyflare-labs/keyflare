import type {
  ListKeysResponse,
  CreateKeyResponse,
  RevokeKeyResponse,
  KeyType,
  Permission,
  KeyScope,
} from "@keyflare/shared";
import { api } from "../api/client.js";
import { success, error, dim, bold } from "../output/log.js";

export async function runKeysList() {
  const data = await api.get<ListKeysResponse>("/keys");
  const { keys } = data;

  if (keys.length === 0) {
    console.log(dim("No API keys found."));
    return;
  }

  const prefixW = Math.max(6, ...keys.map((k) => k.prefix.length));
  const typeW = 6;
  const labelW = Math.max(5, ...keys.map((k) => k.label.length));

  console.log(
    bold(
      `${"PREFIX".padEnd(prefixW)}  ${"TYPE".padEnd(typeW)}  ${"LABEL".padEnd(labelW)}  CREATED`
    )
  );
  for (const k of keys) {
    const created = new Date(k.created_at).toISOString().slice(0, 10);
    const revokedMark = k.revoked ? " [REVOKED]" : "";
    console.log(
      `${k.prefix.padEnd(prefixW)}  ${k.type.padEnd(typeW)}  ${k.label.padEnd(labelW)}  ${created}${revokedMark}`
    );
  }
}

export async function runKeysCreate(opts: {
  type: KeyType;
  label: string;
  scope?: string[];
  permission?: Permission;
}) {
  const scopes: KeyScope[] | undefined = opts.scope?.map((s) => {
    const [project, environment] = s.split(":");
    if (!project || !environment) {
      throw new Error(
        `Invalid scope "${s}" — expected format: project:environment`
      );
    }
    return { project, environment };
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
