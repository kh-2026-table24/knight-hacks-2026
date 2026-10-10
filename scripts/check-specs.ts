// Checks the GameSpec contract: every game in fixtures/games must validate cleanly, and every case in
// spec-cases.ts (the haunted fixture with one deliberate mistake) must fail with the expected message.
//
//   npm run check
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { collectArt } from "../src/shared/art";
import { errorsIn, formatIssues, type Issue } from "../src/shared/issues";
import { validateGame } from "../src/shared/validate";
import { CASES } from "./spec-cases";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "games");
const validate = (value: unknown): Issue[] => validateGame(value).issues;
// Images the haunted fixture needs. Update this when the fixture's art changes on purpose: a surprise
// change means art ids moved, and every generated image would be paid for again.
const HAUNTED_ART_JOBS = 24;
// The server writes assets under these ids.
const SAFE_ID = /^(?!\.)[\w.-]+$/;

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

const haunted = base ? validateGame(base).spec : undefined;
if (haunted) {
  const jobs = collectArt(haunted);
  const again = collectArt(validateGame(structuredClone(base)).spec ?? haunted);
  const checks: [boolean, string][] = [
    [[...jobs.keys()].join() === [...again.keys()].join(), "art ids are the same every time they're derived"],
    [jobs.size === HAUNTED_ART_JOBS, `the haunted fixture needs ${HAUNTED_ART_JOBS} images (got ${jobs.size})`],
    [[...jobs.values()].filter((j) => j.prompt === "dark worn oak wood grain").length === 1, "a material used by many props is one image"],
    [[...jobs.values()].every((j) => !j.referenceId || jobs.has(j.referenceId)), "every animation frame's reference exists"],
    [[...jobs.keys()].every((id) => SAFE_ID.test(id)), "art ids are safe file names"],
  ];
  for (const [ok, what] of checks) {
    if (ok) console.log(`✓ art: ${what}`);
    else fail(`art: ${what}`);
  }
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
