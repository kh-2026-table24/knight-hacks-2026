// Checks the GameSpec contract: every game in fixtures/games must validate cleanly, and every case in
// spec-cases.ts (the haunted fixture with one deliberate mistake) must fail with the expected message.
//
//   npm run check
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { errorsIn, formatIssues, type Issue } from "../src/shared/issues";
import { parseGameSpec } from "../src/shared/parseSpec";
import { CASES } from "./spec-cases";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "games");
const validate = (value: unknown): Issue[] => parseGameSpec(value).issues;

let failures = 0;
const fail = (message: string) => {
  failures++;
  console.error(`✗ ${message}`);
};

const fixtures = new Map<string, unknown>();
for (const name of (await readdir(FIXTURES)).filter((n) => n.endsWith(".json")).sort()) {
  const game: unknown = JSON.parse(await readFile(join(FIXTURES, name), "utf8"));
  fixtures.set(name.replace(/\.json$/, ""), game);
  const issues = validate(game);
  const errors = errorsIn(issues);
  if (errors.length) fail(`fixtures/games/${name} has errors:\n${formatIssues(errors)}`);
  else console.log(`✓ fixtures/games/${name}${issues.length ? `, with warnings:\n${formatIssues(issues)}` : ""}`);
}

const base = fixtures.get("haunted");
if (!base) fail("fixtures/games/haunted.json is missing; every case is built from it");
else {
  for (const c of CASES) {
    const game = structuredClone(base);
    c.mutate(game);
    const errors = errorsIn(validate(game));
    const matching = errors.filter((e) => c.expect.some((text) => e.message.includes(text)));
    const missing = c.expect.filter((text) => !errors.some((e) => e.message.includes(text)));
    const untagged = c.room !== undefined && matching.some((e) => e.room !== c.room);
    if (missing.length || untagged) {
      const wanted = missing.length ? `errors containing ${missing.map((t) => JSON.stringify(t)).join(", ")}` : `errors tagged with room "${c.room}"`;
      fail(`case "${c.name}": expected ${wanted}; got:\n${formatIssues(errors) || "  (no errors)"}`);
    } else {
      console.log(`✓ case "${c.name}"`);
    }
  }
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
