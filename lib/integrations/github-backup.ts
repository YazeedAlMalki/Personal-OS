import "server-only";

// Phase 8 — off-site backup to a private GitHub repo via the Contents API.
// Fully env-gated: if the vars below aren't set, backup is a no-op (the app and
// its cron run fine without it). Intended for a nightly push of the full export
// JSON so there's a versioned, off-box copy of everything.
//
//   GITHUB_BACKUP_TOKEN   — a fine-grained PAT with Contents:read+write on the repo
//   GITHUB_BACKUP_REPO    — "owner/repo" (should be PRIVATE)
//   GITHUB_BACKUP_BRANCH  — default "main"
//   GITHUB_BACKUP_DIR     — default "backups"

export interface GitHubBackupConfig {
  token: string;
  repo: string; // owner/repo
  branch: string;
  dir: string;
}

export function githubBackupConfig(): GitHubBackupConfig | null {
  const token = process.env.GITHUB_BACKUP_TOKEN;
  const repo = process.env.GITHUB_BACKUP_REPO;
  if (!token || !repo) return null;
  return {
    token,
    repo,
    branch: process.env.GITHUB_BACKUP_BRANCH || "main",
    dir: process.env.GITHUB_BACKUP_DIR || "backups",
  };
}

const API = "https://api.github.com";

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "content-type": "application/json",
  };
}

// Look up the current blob sha for a path (needed to update an existing file).
async function currentSha(cfg: GitHubBackupConfig, path: string): Promise<string | null> {
  const url = `${API}/repos/${cfg.repo}/contents/${encodeURIComponent(path)}?ref=${cfg.branch}`;
  const res = await fetch(url, { headers: headers(cfg.token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`github sha lookup ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { sha?: string };
  return json.sha ?? null;
}

export interface BackupPushResult {
  path: string;
  commit: string;
  bytes: number;
}

// Commit `content` (a JSON string) to `${dir}/${filename}` on the configured repo.
// base64-encodes per the Contents API. Updates in place if the file already exists.
export async function pushBackup(
  cfg: GitHubBackupConfig,
  filename: string,
  content: string,
): Promise<BackupPushResult> {
  const path = `${cfg.dir}/${filename}`.replace(/^\/+/, "");
  const sha = await currentSha(cfg, path);
  const body = {
    message: `backup: ${filename}`,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch: cfg.branch,
    ...(sha ? { sha } : {}),
  };
  const res = await fetch(`${API}/repos/${cfg.repo}/contents/${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: headers(cfg.token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`github push ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { commit?: { sha?: string } };
  return { path, commit: json.commit?.sha ?? "", bytes: Buffer.byteLength(content, "utf8") };
}
