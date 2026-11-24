// The address of each record file on the site, derived from its repository path alone.
//
// Each record number has one stable address with no slug in it, because titles are drafts. So a
// numbered record is its kind and its number: design/roadmap/1018-the-design-record-moves.md is
// /roadmap/1018/, and a file in that block's appendix directory sits under it, as
// /roadmap/1018/measurements/. Every other file keeps its path: design/ drops its prefix, so
// design/naming.md is /naming/, and notes/ keeps its prefix. A README is the leaf `readme`. The
// record's root AGENTS.md takes its lowercased stem, /agents/.

"use strict";

// The repository directories the site is built from, and the root documents it carries.
const ROOTS = ["design/", "notes/"];
const ROOT_DOCUMENTS = ["AGENTS.md"];

// Record directories whose files carry a number, and the first address segment each takes.
const NUMBERED = [
  ["design/roadmap/", "roadmap"],
  ["design/decisions/", "decisions"],
  ["design/journeys/", "journeys"],
  ["design/fatal-risks/", "fatal-risks"],
];

// The record number a file or directory name leads with, without its leading zeros.
function recordNumber(name) {
  const match = /^(\d+)-/.exec(name);
  return match ? String(Number(match[1])) : null;
}

function leaf(stem) {
  return stem === "README" ? "readme" : stem;
}

function join(segments) {
  return "/" + segments.join("/") + "/";
}

// The address of a Markdown file given as a repository-relative path, or null when the file is
// not on the site.
function addressFor(repositoryPath) {
  if (ROOT_DOCUMENTS.includes(repositoryPath)) return join([repositoryPath.slice(0, -".md".length).toLowerCase()]);
  if (!repositoryPath.endsWith(".md")) return null;
  if (!ROOTS.some((root) => repositoryPath.startsWith(root))) return null;
  const stem = repositoryPath.slice(0, -".md".length);
  for (const [directory, kind] of NUMBERED) {
    if (!stem.startsWith(directory)) continue;
    const rest = stem.slice(directory.length).split("/");
    const number = recordNumber(rest[0]);
    if (number === null) return join([kind, ...rest.map(leaf)]);
    return join([kind, number, ...rest.slice(1).map(leaf)]);
  }
  const segments = stem.split("/");
  return join((segments[0] === "design" ? segments.slice(1) : segments).map(leaf));
}

// The numbers of the top-level files in one numbered directory, from a list of repository paths.
function numbersIn(repositoryPaths, directory) {
  const numbers = new Set();
  for (const path of repositoryPaths) {
    if (!path.startsWith(directory) || !path.endsWith(".md")) continue;
    const rest = path.slice(directory.length);
    if (rest.includes("/")) continue;
    const number = recordNumber(rest);
    if (number !== null) numbers.add(number);
  }
  return numbers;
}

// Checks that every numbered record (a top-level file in a numbered directory) has a page at its
// address, /<kind>/<number>/, and that no two records share a number. Returns how many were
// checked and the ones that fail, as `path -> address (why)`.
function checkAddresses(outputRoot, repositoryPaths) {
  const fs = require("node:fs");
  const path = require("node:path");
  const missing = [];
  const seen = new Map();
  let checked = 0;
  for (const repositoryPath of repositoryPaths) {
    const kind = NUMBERED.find(([directory]) => repositoryPath.startsWith(directory));
    if (!kind || !repositoryPath.endsWith(".md")) continue;
    const rest = repositoryPath.slice(kind[0].length);
    if (rest.includes("/")) continue;
    const number = recordNumber(rest);
    if (number === null) continue;
    checked++;
    const address = `/${kind[1]}/${number}/`;
    if (seen.has(address)) missing.push(`${repositoryPath} -> ${address} (also ${seen.get(address)})`);
    seen.set(address, repositoryPath);
    if (addressFor(repositoryPath) !== address) missing.push(`${repositoryPath} -> ${addressFor(repositoryPath)} (wants ${address})`);
    else if (!fs.existsSync(path.join(outputRoot, kind[1], number, "index.html"))) missing.push(`${repositoryPath} -> ${address} (no page)`);
  }
  return { checked, missing };
}

module.exports = { ROOTS, ROOT_DOCUMENTS, NUMBERED, addressFor, checkAddresses, numbersIn, recordNumber };
