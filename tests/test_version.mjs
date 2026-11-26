// Node test: the version in src/version.js matches package.json, the README and the latest CHANGELOG entry,
// so a release cannot leave one of them behind: node tests/test_version.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VERSION } from "../src/version.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

assert.equal(JSON.parse(read("package.json")).version, VERSION, "package.json");
assert.ok(read("README.md").includes(`Version ${VERSION} (`), "README.md version line");
assert.equal(read("CHANGELOG.md").match(/^## (\S+)/m)?.[1], VERSION, "CHANGELOG.md: the first entry is the current version");

console.log(`OK: version ${VERSION} is the same everywhere.`);
