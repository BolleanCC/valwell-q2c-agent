// Conventional Commits with the types and scopes listed in CLAUDE.md §7.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "refactor", "test", "docs", "chore", "ci", "build", "perf"],
    ],
    "scope-enum": [
      2,
      "always",
      [
        "repo",
        "domain",
        "generator",
        "mock-systems",
        "rules",
        "agent",
        "eval",
        "web",
        "ci",
        "deps",
      ],
    ],
    "header-max-length": [2, "always", 72],
    "subject-full-stop": [2, "never", "."],
  },
};
