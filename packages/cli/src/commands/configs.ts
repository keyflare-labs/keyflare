import type {
  ListConfigsResponse,
  CreateConfigResponse,
} from "@keyflare/shared";
import { api } from "../api/client.js";
import { success, error, dim, bold } from "../output/log.js";

export async function runConfigsList(project: string) {
  const data = await api.get<ListConfigsResponse>(
    `/projects/${project}/configs`
  );
  const { configs } = data;

  if (configs.length === 0) {
    console.log(
      dim(
        `No configs found in "${project}". Create one with: kfl configs create <name> --project ${project}`
      )
    );
    return;
  }

  const nameW = Math.max(6, ...configs.map((c) => c.name.length));
  const secretW = 7;

  console.log(bold(`${"CONFIG".padEnd(nameW)}  ${"SECRETS".padEnd(secretW)}  LAST UPDATED`));
  for (const c of configs) {
    const updated = new Date(c.created_at).toISOString().slice(0, 10);
    console.log(
      `${c.name.padEnd(nameW)}  ${String(c.secret_count).padEnd(secretW)}  ${updated}`
    );
  }
}

export async function runConfigsCreate(name: string, project: string) {
  const data = await api.post<CreateConfigResponse>(
    `/projects/${project}/configs`,
    { name }
  );
  success(`Config "${data.name}" created in project "${data.project}"`);
}

export async function runConfigsDelete(
  name: string,
  project: string,
  opts: { force?: boolean }
) {
  if (!opts.force) {
    const { confirm } = await import("@inquirer/prompts");
    const confirmed = await confirm({
      message: `Delete config "${name}" in project "${project}" and ALL its secrets?`,
      default: false,
    });
    if (!confirmed) {
      error("Aborted.");
      process.exit(1);
    }
  }

  await api.delete(`/projects/${project}/configs/${name}`);
  success(`Config "${name}" deleted from project "${project}"`);
}
