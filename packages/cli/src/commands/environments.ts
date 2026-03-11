import type {
  ListEnvironmentsResponse,
  CreateEnvironmentResponse,
} from "@keyflare/shared";
import { api } from "../api/client.js";
import { success, error, dim, bold } from "../output/log.js";

export async function runEnvironmentsList(project: string) {
  const data = await api.get<ListEnvironmentsResponse>(
    `/projects/${project}/environments`
  );
  const { environments } = data;

  if (environments.length === 0) {
    console.log(
      dim(
        `No environments found in "${project}". Create one with: kfl env create <name> --project ${project}`
      )
    );
    return;
  }

  const nameW = Math.max(11, ...environments.map((e) => e.name.length));
  const secretW = 7;

  console.log(bold(`${"ENVIRONMENT".padEnd(nameW)}  ${"SECRETS".padEnd(secretW)}  LAST UPDATED`));
  for (const e of environments) {
    const updated = new Date(e.created_at).toISOString().slice(0, 10);
    console.log(
      `${e.name.padEnd(nameW)}  ${String(e.secret_count).padEnd(secretW)}  ${updated}`
    );
  }
}

export async function runEnvironmentsCreate(name: string, project: string) {
  const data = await api.post<CreateEnvironmentResponse>(
    `/projects/${project}/environments`,
    { name }
  );
  success(`Environment "${data.name}" created in project "${data.project}"`);
}

export async function runEnvironmentsDelete(
  name: string,
  project: string,
  opts: { force?: boolean }
) {
  if (!opts.force) {
    const { confirm } = await import("@inquirer/prompts");
    const confirmed = await confirm({
      message: `Delete environment "${name}" in project "${project}" and ALL its secrets?`,
      default: false,
    });
    if (!confirmed) {
      error("Aborted.");
      process.exit(1);
    }
  }

  await api.delete(`/projects/${project}/environments/${name}`);
  success(`Environment "${name}" deleted from project "${project}"`);
}
