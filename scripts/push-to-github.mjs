import { Octokit } from "@octokit/rest";
import { readFileSync, statSync } from "fs";
import { execSync } from "child_process";
import path from "path";

async function getGithubToken() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? "depl " + process.env.WEB_REPL_RENEWAL
    : null;
  if (!xReplitToken) throw new Error("No REPL_IDENTITY or WEB_REPL_RENEWAL");
  const res = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=github`,
    { headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken } }
  );
  const data = await res.json();
  const conn = data.items?.[0];
  const token =
    conn?.settings?.access_token ||
    conn?.settings?.oauth?.credentials?.access_token;
  if (!token) {
    console.error("conn dump:", JSON.stringify(conn, null, 2).slice(0, 1500));
    throw new Error("No access_token");
  }
  return token;
}

const REPO_NAME = process.env.REPO_NAME || "autotestai";
const PRIVATE = process.env.REPO_PRIVATE !== "false";

const token = await getGithubToken();
const octokit = new Octokit({ auth: token });

const { data: user } = await octokit.users.getAuthenticated();
const owner = user.login;
console.log(`Authenticated as: ${owner}`);

// Check if repo exists
let repoExists = false;
try {
  await octokit.repos.get({ owner, repo: REPO_NAME });
  repoExists = true;
  console.log(`Repo ${owner}/${REPO_NAME} already exists.`);
} catch (e) {
  if (e.status !== 404) throw e;
}

if (!repoExists) {
  await octokit.repos.createForAuthenticatedUser({
    name: REPO_NAME,
    private: PRIVATE,
    description: "AutoTestAI — AI-powered software testing platform that replaces a QA team. Self-healing tests, autonomous monitoring (KAIROS), project memory.",
    auto_init: false,
  });
  console.log(`Created repo ${owner}/${REPO_NAME} (${PRIVATE ? "private" : "public"})`);
}

// Collect files via git ls-files (respects .gitignore)
const lsFiles = execSync("git ls-files -co --exclude-standard", { encoding: "utf8" });
let files = lsFiles.split("\n").filter(Boolean);

// Safety: skip anything that looks like secrets
files = files.filter((f) => {
  if (f.startsWith(".env") && f !== ".env.example") return false;
  if (f.includes("node_modules/")) return false;
  if (f.startsWith(".git/")) return false;
  if (f.endsWith(".log")) return false;
  return true;
});

// Skip files larger than 50MB (GitHub blob limit is 100MB)
const MAX = 50 * 1024 * 1024;
files = files.filter((f) => {
  try {
    return statSync(f).size <= MAX;
  } catch {
    return false;
  }
});

console.log(`Pushing ${files.length} files...`);

// Get default branch / base ref (or bootstrap if empty repo)
let baseSha = null;
let defaultBranch = "main";
const { data: repoMeta } = await octokit.repos.get({ owner, repo: REPO_NAME });
defaultBranch = repoMeta.default_branch || "main";
try {
  const { data: refData } = await octokit.git.getRef({
    owner,
    repo: REPO_NAME,
    ref: `heads/${defaultBranch}`,
  });
  baseSha = refData.object.sha;
  console.log(`Base ref ${defaultBranch} @ ${baseSha.slice(0, 7)}`);
} catch (e) {
  console.log(`Empty repo — bootstrapping with initial commit...`);
  // Bootstrap by creating a placeholder file via Contents API (creates first commit)
  const bootstrap = await octokit.repos.createOrUpdateFileContents({
    owner,
    repo: REPO_NAME,
    path: ".gitkeep",
    message: "init",
    content: Buffer.from("").toString("base64"),
    branch: defaultBranch,
  });
  baseSha = bootstrap.data.commit.sha;
  console.log(`Bootstrapped @ ${baseSha.slice(0, 7)}`);
}

// Create blobs for all files (in batches of 10)
const blobs = [];
const BATCH = 10;
for (let i = 0; i < files.length; i += BATCH) {
  const batch = files.slice(i, i + BATCH);
  const results = await Promise.all(
    batch.map(async (f) => {
      const content = readFileSync(f).toString("base64");
      const { data: blob } = await octokit.git.createBlob({
        owner,
        repo: REPO_NAME,
        content,
        encoding: "base64",
      });
      return { path: f, mode: "100644", type: "blob", sha: blob.sha };
    })
  );
  blobs.push(...results);
  process.stdout.write(`  uploaded ${Math.min(i + BATCH, files.length)}/${files.length}\r`);
}
console.log(`\n${blobs.length} blobs created.`);

// Create tree
const { data: tree } = await octokit.git.createTree({
  owner,
  repo: REPO_NAME,
  tree: blobs,
  ...(baseSha ? { base_tree: baseSha } : {}),
});
console.log(`Tree created @ ${tree.sha.slice(0, 7)}`);

// Create commit
const { data: commit } = await octokit.git.createCommit({
  owner,
  repo: REPO_NAME,
  message: "AutoTestAI — Full Platform\n\nAI-powered software testing platform: AI test generation, self-healing tests (powered by passmark), KAIROS autonomous monitoring, project memory, Stripe billing.",
  tree: tree.sha,
  parents: baseSha ? [baseSha] : [],
});
console.log(`Commit created @ ${commit.sha.slice(0, 7)}`);

// Update / create ref
try {
  if (baseSha) {
    await octokit.git.updateRef({
      owner,
      repo: REPO_NAME,
      ref: `heads/${defaultBranch}`,
      sha: commit.sha,
    });
  } else {
    await octokit.git.createRef({
      owner,
      repo: REPO_NAME,
      ref: `refs/heads/main`,
      sha: commit.sha,
    });
  }
  console.log(`✓ Pushed to https://github.com/${owner}/${REPO_NAME}`);
} catch (e) {
  console.error("Ref update failed:", e.message);
  throw e;
}
