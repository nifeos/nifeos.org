// Reads crates.toml, the list of crates the site renders a page for, and refuses a file it cannot
// read exactly.
//
// The file is one table per crate, named for the crate, with two keys: `repository`, the GitHub
// repository as `<owner>/<name>`, and `commit`, a full 40-hex commit of it. A branch name or a short
// hash is refused, so that every build of one revision of this repository renders the same text.
// The parser takes only that much of TOML: comments, blank lines, `[name]` table headers and
// `key = "string"` lines. Anything else is an error, not a guess.
//
// Run directly, it prints one line per crate, `<name> <repository> <commit>`, in the file's order,
// for script/site to fetch:
//
//     node lib/crates.cjs crates.toml

"use strict";

const fs = require("node:fs");

const NAME = /^[a-z][a-z0-9_]*$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT = /^[0-9a-f]{40}$/;
const KEYS = ["repository", "commit"];

function readCrates(file) {
  const crates = [];
  const seen = new Set();
  let current = null;
  const fail = (number, why) => {
    throw new Error(`${file}:${number}: ${why}`);
  };
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((raw, index) => {
    const number = index + 1;
    const line = raw.replace(/^\s+|\s+$/g, "");
    if (line === "" || line.startsWith("#")) return;
    const table = /^\[([^\]]*)\]$/.exec(line);
    if (table) {
      const name = table[1].trim();
      if (!NAME.test(name)) fail(number, `table [${name}] is not a crate name (lowercase letters, digits and underscores)`);
      if (seen.has(name)) fail(number, `crate ${name} is listed twice`);
      seen.add(name);
      current = { name, line: number };
      crates.push(current);
      return;
    }
    const pair = /^([a-z_]+)\s*=\s*"([^"\\]*)"\s*(#.*)?$/.exec(line);
    if (!pair) fail(number, "expected a [crate] table header or a key = \"string\" line");
    if (!current) fail(number, "a key before the first [crate] table");
    const [, key, value] = pair;
    if (!KEYS.includes(key)) fail(number, `unknown key ${key}; a crate table has only ${KEYS.join(" and ")}`);
    if (key in current) fail(number, `${key} is set twice for ${current.name}`);
    current[key] = value;
  });
  for (const crate of crates) {
    const where = `${file}:${crate.line}: [${crate.name}]`;
    for (const key of KEYS) if (!(key in crate)) throw new Error(`${where} has no ${key}`);
    if (!REPOSITORY.test(crate.repository)) throw new Error(`${where}: repository "${crate.repository}" is not <owner>/<name>`);
    if (!COMMIT.test(crate.commit)) {
      throw new Error(`${where}: commit "${crate.commit}" is not a full 40-hex commit; a branch name or a short hash is refused`);
    }
    delete crate.line;
  }
  return crates;
}

module.exports = { readCrates };

if (require.main === module) {
  try {
    for (const crate of readCrates(process.argv[2] || "crates.toml")) {
      process.stdout.write(`${crate.name} ${crate.repository} ${crate.commit}\n`);
    }
  } catch (error) {
    process.stderr.write(`script/site: ${error.message}\n`);
    process.exit(1);
  }
}
