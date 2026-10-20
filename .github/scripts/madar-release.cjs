const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

async function validateRelease({ github, context, version, commit }) {
  if (!stableVersion.test(version ?? "")) {
    throw new Error("Use a stable version without v, e.g. 0.1.0.");
  }
  if (context.ref !== "refs/heads/main" || !/^[a-f0-9]{40}$/i.test(commit ?? "")) {
    throw new Error("Run Release on main and select a full commit SHA.");
  }
  const repo = context.repo;
  const comparison = await github.rest.repos.compareCommitsWithBasehead({
    ...repo,
    basehead: `${commit}...main`,
  });
  if (!["ahead", "identical"].includes(comparison.data.status)) {
    throw new Error("The release commit must be merged into main.");
  }
  const runs = await github.rest.actions.listWorkflowRuns({
    ...repo,
    workflow_id: "ci.yml",
    head_sha: commit,
    event: "push",
    branch: "main",
    per_page: 100,
  });
  // A rerun in progress or failing must not fall back to an older green attempt.
  const latest = runs.data.workflow_runs[0];
  if (latest?.status !== "completed" || latest.conclusion !== "success") {
    throw new Error("Wait for CI to pass on this exact main commit before releasing.");
  }
  const tag = `v${version}`;
  try {
    await github.rest.git.getRef({ ...repo, ref: `tags/${tag}` });
    throw new Error(`${tag} already exists; choose a new version.`);
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  // Draft releases need checking separately because GitHub may not create their tag yet.
  try {
    await github.rest.repos.getReleaseByTag({ ...repo, tag });
    throw new Error(`${tag} already has a release; delete its draft before retrying.`);
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  return { ref: commit, version, tag };
}

module.exports = { validateRelease };
