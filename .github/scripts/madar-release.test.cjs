const assert = require("node:assert/strict");
const { test } = require("node:test");
const { validateRelease } = require("./madar-release.cjs");

function fixture(overrides = {}) {
  const missing = async () => {
    throw Object.assign(new Error("not found"), { status: 404 });
  };
  return {
    context: { ref: "refs/heads/main", repo: { owner: "ZeroneOmni", repo: "madar" } },
    version: "0.1.0",
    commit: "a".repeat(40),
    github: {
      rest: {
        repos: {
          compareCommitsWithBasehead: async () => ({
            data: { status: overrides.ancestry ?? "ahead" },
          }),
          getReleaseByTag: overrides.release ?? missing,
        },
        actions: {
          listWorkflowRuns: async () => ({
            data: {
              workflow_runs: overrides.runs ?? [{ status: "completed", conclusion: "success" }],
            },
          }),
        },
        git: { getRef: overrides.tag ?? missing },
      },
    },
  };
}

test("releases the exact merged commit with passing main CI", async () => {
  assert.deepEqual(await validateRelease(fixture()), {
    ref: "a".repeat(40),
    version: "0.1.0",
    tag: "v0.1.0",
  });
});
test("rejects malformed or prerelease versions", async () => {
  for (const version of ["v1.0.0", "01.0.0", "1.0.0-beta.1", "1.0.0; echo bad", ""]) {
    await assert.rejects(validateRelease({ ...fixture(), version }), /stable version/);
  }
});
test("rejects branch dispatches and abbreviated or injected commit names", async () => {
  await assert.rejects(
    validateRelease({ ...fixture(), context: { ref: "refs/heads/setup-madar" } }),
    /on main/,
  );
  for (const commit of ["main", "abc123", "a".repeat(40) + "; echo bad"]) {
    await assert.rejects(validateRelease({ ...fixture(), commit }), /full commit/);
  }
});
test("rejects unmerged commits", async () => {
  for (const ancestry of ["behind", "diverged"]) {
    await assert.rejects(validateRelease(fixture({ ancestry })), /merged into main/);
  }
});
test("requires the latest main CI attempt to pass", async () => {
  for (const runs of [
    [],
    [{ status: "completed", conclusion: "failure" }],
    [
      { status: "in_progress", conclusion: null },
      { status: "completed", conclusion: "success" },
    ],
  ]) {
    await assert.rejects(validateRelease(fixture({ runs })), /Wait for CI/);
  }
});
test("rejects existing tags, drafts, and API permission errors", async () => {
  await assert.rejects(validateRelease(fixture({ tag: async () => ({}) })), /already exists/);
  await assert.rejects(
    validateRelease(fixture({ release: async () => ({}) })),
    /already has a release/,
  );
  await assert.rejects(
    validateRelease(
      fixture({
        tag: async () => {
          throw Object.assign(new Error("forbidden"), { status: 403 });
        },
      }),
    ),
    /forbidden/,
  );
});
