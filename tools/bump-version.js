/**
 * The next version, from the commits since the last release (Conventional
 * Commits), written where the version lives: the root package.json, its
 * lockfile and packages/client/src/release.js. Run by the deploy workflow
 * before every deploy; it then commits and tags v<version>.
 *   "feat!: …", "fix(x)!: …" or a "BREAKING CHANGE:" footer  → major
 *   "feat: …" / "feat(scope): …"                              → minor
 *   anything else (fix, chore, refactor, …)                    → patch
 * The last release is the newest v* tag reachable from HEAD; with none, every
 * commit counts. Release commits themselves ("chore(release): …") never do.
 * Prints the new version, or nothing when there is no commit to release.
 * Usage: node tools/bump-version.js
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RELEASE_FILE, productVersion, releaseModule } from "./stamp-release.js";

const ROOT = new URL("../", import.meta.url);
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;
const RELEASE_COMMIT = /^chore\(release\):/;
const BREAKING_HEADER = /^\w+(?:\([^)]*\))?!:/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;
const FEATURE_HEADER = /^feat(?:\([^)]*\))?:/;
const RANK = Object.freeze({ patch: 0, minor: 1, major: 2 });

/**
 * @param {readonly string[]} messages full commit messages, newest first or not
 * @returns {"major" | "minor" | "patch" | null} null when nothing but release commits
 */
export function bumpOf(messages) {
  const counted = messages.map((message) => message.trim()).filter((message) => message !== "" && !RELEASE_COMMIT.test(message));
  if (counted.length === 0) {
    return null;
  }
  return counted.map(levelOf).reduce((highest, level) => (RANK[level] > RANK[highest] ? level : highest), "patch");
}

/**
 * @param {string} message
 * @returns {"major" | "minor" | "patch"}
 */
function levelOf(message) {
  if (BREAKING_HEADER.test(message) || BREAKING_FOOTER.test(message)) {
    return "major";
  }
  return FEATURE_HEADER.test(message) ? "minor" : "patch";
}

/**
 * @param {string} version e.g. "0.2.0" (a pre-release suffix is dropped)
 * @param {"major" | "minor" | "patch"} bump
 */
export function nextVersion(version, bump) {
  const match = VERSION_PATTERN.exec(version);
  if (match === null) {
    throw new Error(`"${version}" is not semver`);
  }
  const [major, minor, patch] = match.slice(1).map(Number);
  return { major: `${major + 1}.0.0`, minor: `${major}.${minor + 1}.0`, patch: `${major}.${minor}.${patch + 1}` }[bump];
}

/** @param {readonly string[]} args */
// eslint-disable-next-line sonarjs/no-os-command-from-path -- a release tool run in CI and by developers: git is whichever one their PATH has.
const git = (args) => execFileSync("git", args, { cwd: fileURLToPath(ROOT), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** @returns {string[]} the messages of the commits since the last v* tag (all of them without one) */
function unreleasedMessages() {
  let range = "HEAD";
  try {
    range = `${git(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"]).trim()}..HEAD`;
  } catch {
    // No release yet: every commit counts.
  }
  return git(["log", range, "--format=%B%x00"]).split("\0");
}

/** @param {string} version */
function writeVersion(version) {
  for (const file of ["package.json", "package-lock.json"]) {
    const url = new URL(file, ROOT);
    const json = JSON.parse(readFileSync(url, "utf8"));
    json.version = version;
    if (json.packages?.[""] !== undefined) {
      json.packages[""].version = version;
    }
    writeFileSync(url, `${JSON.stringify(json, null, 2)}\n`);
  }
  writeFileSync(RELEASE_FILE, releaseModule({ version, build: null }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bump = bumpOf(unreleasedMessages());
  if (bump !== null) {
    const version = nextVersion(productVersion(), bump);
    writeVersion(version);
    console.log(version);
  }
}
