import { getDatabase, makeId, nowIso } from "$lib/server/db/client";
import type {
  ProjectRecord,
  ProjectState,
  ProviderName,
} from "$lib/types/domain";

export function getProject(): ProjectRecord | null {
  const row = getDatabase().prepare("SELECT * FROM projects LIMIT 1").get() as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    return null;
  }

  return {
    id: String(row.id),
    name: String(row.name),
    rootPath: String(row.root_path),
    provider: row.provider as ProviderName,
    defaultModel: (row.default_model as string | null) ?? null,
    defaultFontSize: Number(row.default_font_size),
    syncStatus: row.sync_status as ProjectRecord["syncStatus"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createProject(input: {
  name: string;
  rootPath: string;
  provider: ProviderName;
  defaultModel?: string | null;
}) {
  const project = getProject();
  const timestamp = nowIso();

  if (project) {
    getDatabase()
      .prepare(
        `UPDATE projects
           SET name = ?, root_path = ?, provider = ?, default_model = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.name,
        input.rootPath,
        input.provider,
        input.defaultModel ?? null,
        timestamp,
        project.id,
      );
    return getProject()!;
  }

  const id = makeId();
  getDatabase()
    .prepare(
      `INSERT INTO projects (id, name, root_path, provider, default_model, default_font_size, sync_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 16, 'healthy', ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.rootPath,
      input.provider,
      input.defaultModel ?? null,
      timestamp,
      timestamp,
    );
  return getProject()!;
}

export function updateProjectSyncStatus(
  syncStatus: ProjectRecord["syncStatus"],
) {
  const project = getProject();
  if (!project) {
    return null;
  }

  getDatabase()
    .prepare("UPDATE projects SET sync_status = ?, updated_at = ? WHERE id = ?")
    .run(syncStatus, nowIso(), project.id);
  return getProject();
}

export function getProjectState(): ProjectState {
  const project = getProject();
  if (!project) {
    return {
      ready: false,
      projectId: null,
      projectName: null,
      syncStatus: "healthy",
      provider: null,
    };
  }

  return {
    ready: true,
    projectId: project.id,
    projectName: project.name,
    syncStatus: project.syncStatus,
    provider: project.provider,
  };
}
