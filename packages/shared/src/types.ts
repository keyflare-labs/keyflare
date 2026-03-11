// ─── API Response Types ───

export interface ApiSuccessResponse<T = unknown> {
  ok: true;
  data: T;
}

export interface ApiErrorResponse {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
  };
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR";

// ─── Key Types ───

export type KeyType = "user" | "system";
export type Permission = "read" | "readwrite";

export interface KeyScope {
  project: string;
  environment: string;
}

// ─── Bootstrap ───

export interface BootstrapResponse {
  key: string;
  prefix: string;
  type: "user";
  label: string;
}

// ─── Keys ───

export interface CreateKeyRequest {
  type: KeyType;
  label: string;
  scopes?: KeyScope[];
  permission?: Permission;
}

export interface CreateKeyResponse {
  key: string;
  prefix: string;
  type: KeyType;
  label: string;
  scopes: KeyScope[] | null;
  permission: string;
}

export interface KeyInfo {
  id: string;
  prefix: string;
  type: KeyType;
  label: string;
  scopes: KeyScope[] | null;
  permission: string;
  created_at: string;
  last_used_at: string | null;
  revoked: boolean;
}

export interface ListKeysResponse {
  keys: KeyInfo[];
}

export interface RevokeKeyResponse {
  revoked: string;
}

export interface UpdateKeyRequest {
  scopes: KeyScope[];
  permission: Permission;
}

export interface UpdateKeyResponse {
  prefix: string;
  type: KeyType;
  label: string;
  scopes: KeyScope[];
  permission: string;
}

// ─── Projects ───

export interface CreateProjectRequest {
  name: string;
  /** When true, do not create default Dev/Prod environments. Default: false. */
  environmentless?: boolean;
}

export interface ProjectInfo {
  id: string;
  name: string;
  environment_count: number;
  created_at: string;
}

export interface CreateProjectResponse {
  id: string;
  name: string;
  created_at: string;
}

export interface ListProjectsResponse {
  projects: ProjectInfo[];
}

export interface DeleteProjectResponse {
  deleted: string;
  environments_removed: number;
  secrets_removed: number;
}

// ─── Environments ───

export interface CreateEnvironmentRequest {
  name: string;
}

export interface EnvironmentInfo {
  id: string;
  name: string;
  secret_count: number;
  created_at: string;
}

export interface CreateEnvironmentResponse {
  id: string;
  name: string;
  project: string;
  created_at: string;
}

export interface ListEnvironmentsResponse {
  environments: EnvironmentInfo[];
}

// ─── Secrets ───

export interface GetSecretsResponse {
  secrets: Record<string, string>;
}

export interface SetSecretsRequest {
  secrets: Record<string, string>;
}

export interface SetSecretsResponse {
  count: number;
  project: string;
  environment: string;
}

export interface PatchSecretsRequest {
  set?: Record<string, string>;
  delete?: string[];
}

export interface PatchSecretsResponse {
  set: number;
  deleted: number;
  total: number;
}

// ─── Health ───

export interface HealthResponse {
  ok: true;
  version: string;
}
