import { eq } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { projectsTable, type Project } from '../../db/schema.js';

export interface ResolvedProject {
  project: Project;
  secret: string | undefined;
}

/**
 * Looks up a project by its payload slug and resolves its webhook secret via
 * the webhookSecretRef indirection (a key naming an env var), never a stored
 * secret value. Returns undefined secret if the referenced env var is unset,
 * which the caller treats identically to "signature invalid" (never leak
 * which projects exist or whether their secret is configured).
 */
export async function resolveProject(db: Db, slug: string): Promise<ResolvedProject | undefined> {
  const project = await db.query.projectsTable.findFirst({
    where: eq(projectsTable.slug, slug),
  });

  if (!project) {
    return undefined;
  }

  const secret = process.env[project.webhookSecretRef];
  return { project, secret };
}
