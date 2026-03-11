import type {
  ListProjectsResponse,
  CreateProjectResponse,
  DeleteProjectResponse,
} from "@keyflare/shared";
import { api } from "../api/client.js";
import { success, error, dim, bold, yellow, cyan } from "../output/log.js";

export async function runProjectsList() {
  const data = await api.get<ListProjectsResponse>("/projects");
  const { projects } = data;

  if (projects.length === 0) {
    console.log(
      yellow(bold("No projects found.")) +
        " " +
        cyan("Create one with: kfl projects create <name>") +
        "\n",
    );
    return;
  }

  const nameW = Math.max(4, ...projects.map((p) => p.name.length));
  const envW = 12;

  console.log(
    bold(`${"NAME".padEnd(nameW)}  ${"ENVIRONMENTS".padEnd(envW)}  CREATED`),
  );
  for (const p of projects) {
    const created = new Date(p.created_at).toISOString().slice(0, 10);
    console.log(
      `${p.name.padEnd(nameW)}  ${String(p.environment_count).padEnd(envW)}  ${created}`,
    );
  }
}

export async function runProjectsCreate(
  name: string,
  opts?: { environmentless?: boolean },
) {
  const body: { name: string; environmentless?: boolean } = { name };
  if (opts?.environmentless) body.environmentless = true;
  const data = await api.post<CreateProjectResponse>("/projects", body);
  if (opts?.environmentless) {
    success(`Project "${data.name}" created`);
    console.log("");
    console.log(
      cyan("Next: add environments (e.g. dev and prod):") +
        "\n  " +
        dim(`kfl env create dev --project ${data.name}`) +
        "\n  " +
        dim(`kfl env create prod --project ${data.name}`),
    );
  } else {
    success(`Project "${data.name}" created with environments: dev, prod`);
  }
}

export async function runProjectsDelete(
  name: string,
  opts: { force?: boolean },
) {
  if (!opts.force) {
    const { confirm } = await import("@inquirer/prompts");
    const confirmed = await confirm({
      message: `Delete project "${name}" and ALL its secrets?`,
      default: false,
    });
    if (!confirmed) {
      error("Aborted.");
      process.exit(1);
    }
  }

  const data = await api.delete<DeleteProjectResponse>(`/projects/${name}`);
  success(
    `Project "${data.deleted}" deleted (${data.environments_removed} environments, ${data.secrets_removed} secrets removed)`,
  );
}
