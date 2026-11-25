// Builds the design record and the crate pages as a static site, indexes it for search, checks its
// links and its addresses, and writes a report. script/site fetches the record and the crates and
// runs this; the header there says what the site is and how to run it.
//
// The build exits non-zero when a step fails or when a check finds anything: a link inside the
// site to no page or no heading, a relative link in the record or in a crate README to no file, a
// citation of a record that does not exist, or a numbered record or a listed crate with no page at
// its address. Every count is also in the report, with examples.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { searchCheck } from "./lib/search-check.mjs";

const require = createRequire(import.meta.url);
const { checkLinks } = require("./lib/link-check.cjs");
const { checkAddresses } = require("./lib/address.cjs");

const here = path.dirname(fileURLToPath(import.meta.url));
const record = path.resolve(process.env.SITE_RECORD || path.join(here, "..", "record"));
const recordCommit = process.env.SITE_RECORD_COMMIT || "main";
const recordSource = process.env.SITE_RECORD_SOURCE || "local";
const basaltCommit = process.env.SITE_BASALT_COMMIT || "";
// The crates script/site fetched: one line each, `<name> <repository> <commit> <tree>`.
const cratesList = process.env.SITE_CRATES || "";
const work = path.resolve(process.env.SITE_WORK || path.join(here, "target", "build"));
const input = path.join(work, "input");
const output = path.join(work, "site");
// The record's directories and root documents the site renders. The record's script/ and helpers/
// are code; a link to them goes to the file in nifeos/record at the built commit.
const ROOTS = ["design", "notes", "AGENTS.md"];

function seconds(start) {
  return Number(process.hrtime.bigint() - start) / 1e9;
}

function directoryBytes(directory) {
  let bytes = 0;
  let files = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    bytes += fs.statSync(path.join(entry.parentPath, entry.name)).size;
    files++;
  }
  return { bytes, files };
}

function trackedFiles(...paths) {
  const listed = execFileSync("git", ["-C", record, "ls-files", "-z", "--", ...paths], { encoding: "utf8" });
  return listed.split("\0").filter((file) => file && fs.existsSync(path.join(record, file)));
}

// The crates script/site fetched, in crates.toml's order, each with the files tracked at its commit.
function readCrates() {
  if (!cratesList) return [];
  return fs
    .readFileSync(cratesList, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, repository, commit, tree] = line.split(" ");
      const listed = execFileSync("git", ["-C", tree, "ls-files", "-z"], { encoding: "utf8" });
      return { name, repository, commit, tree, files: listed.split("\0").filter(Boolean) };
    });
}

// Each crate's README.md, staged at crates/<crate>/README.md in the input. The record has no
// crates/ directory on the site, so the two never meet.
function stageCrates(crates) {
  let words = 0;
  for (const crate of crates) {
    const text = fs.readFileSync(path.join(crate.tree, "README.md"), "utf8");
    fs.mkdirSync(path.join(input, "crates", crate.name), { recursive: true });
    fs.writeFileSync(path.join(input, "crates", crate.name, "README.md"), text);
    words += text.split(/\s+/).filter(Boolean).length;
  }
  const list = path.join(work, "crates.json");
  const described = crates.map(({ name, repository, commit, files }) => ({ name, repository, commit, files }));
  fs.writeFileSync(list, JSON.stringify(described) + "\n");
  return { count: crates.length, words, list };
}

function stage() {
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(path.join(input, "_includes"), { recursive: true });
  const tracked = trackedFiles(...ROOTS);
  let markdown = 0;
  let words = 0;
  for (const file of tracked) {
    if (!file.endsWith(".md")) continue;
    const text = fs.readFileSync(path.join(record, file), "utf8");
    fs.mkdirSync(path.join(input, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(input, file), text);
    markdown++;
    words += text.split(/\s+/).filter(Boolean).length;
  }
  fs.copyFileSync(path.join(here, "layouts", "page.njk"), path.join(input, "_includes", "page.njk"));
  fs.copyFileSync(path.join(here, "layouts", "index.njk"), path.join(input, "index.njk"));
  const filesList = path.join(work, "files-on-site.txt");
  fs.writeFileSync(filesList, tracked.join("\n") + "\n");
  const repositoryList = path.join(work, "files-in-record.txt");
  fs.writeFileSync(repositoryList, trackedFiles().join("\n") + "\n");
  const crates = stageCrates(readCrates());
  return { tracked, markdown, words, filesList, repositoryList, crates };
}

// Each crate in crates.toml has its page at /crates/<crate>/.
function checkCratePages(crates) {
  const names = JSON.parse(fs.readFileSync(crates.list, "utf8")).map((crate) => crate.name);
  const missing = names.filter((name) => !fs.existsSync(path.join(output, "crates", name, "index.html")));
  return { checked: names.length, missing: missing.map((name) => `${name} -> /crates/${name}/ (no page)`) };
}

async function build(staged) {
  const markdownStats = path.join(work, "markdown-stats.json");
  Object.assign(process.env, {
    SITE_INPUT: input,
    SITE_OUTPUT: output,
    SITE_FILES: staged.filesList,
    SITE_RECORD_FILES: staged.repositoryList,
    SITE_RECORD_COMMIT: recordCommit,
    SITE_CRATES_JSON: staged.crates.list,
    SITE_MARKDOWN_STATS: markdownStats,
  });
  const { Eleventy } = await import("@11ty/eleventy");
  const eleventy = new Eleventy(undefined, undefined, {
    configPath: path.join(here, "eleventy.config.cjs"),
    quietMode: true,
  });
  const start = process.hrtime.bigint();
  await eleventy.write();
  const elapsed = seconds(start);
  const stats = JSON.parse(fs.readFileSync(markdownStats, "utf8"));
  for (const asset of stats.assets) {
    const target = path.join(output, "files", asset);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(record, asset), target);
  }
  fs.copyFileSync(path.join(here, "layouts", "style.css"), path.join(output, "style.css"));
  return { elapsed, stats };
}

async function index() {
  const pagefind = await import("pagefind");
  const start = process.hrtime.bigint();
  const { index: created, errors } = await pagefind.createIndex({});
  if (errors.length) throw new Error("pagefind: " + errors.join("; "));
  const added = await created.addDirectory({ path: output });
  if (added.errors.length) throw new Error("pagefind: " + added.errors.join("; "));
  const written = await created.writeFiles({ outputPath: path.join(output, "pagefind") });
  if (written.errors.length) throw new Error("pagefind: " + written.errors.join("; "));
  await pagefind.close();
  return { elapsed: seconds(start), pages: added.page_count };
}

function lockedPackages() {
  const lock = JSON.parse(fs.readFileSync(path.join(here, "package-lock.json"), "utf8"));
  const locked = Object.keys(lock.packages).filter(Boolean).length;
  const installedLock = path.join(here, "node_modules", ".package-lock.json");
  const installed = fs.existsSync(installedLock)
    ? Object.keys(JSON.parse(fs.readFileSync(installedLock, "utf8")).packages).filter(Boolean).length
    : null;
  return { locked, installed };
}

const megabytes = (bytes) => (bytes / 1048576).toFixed(1) + " MB";

function failures(report) {
  const { markdown, links, addresses, crates } = report;
  return {
    unresolvedCitations: markdown.unresolvedCitations,
    relativeLinksToNoFile: markdown.inRecordBreaks,
    crateLinksToNoFile: markdown.crateBreaks,
    linksToNoPage: links.missingPages,
    fragmentsToNoHeading: links.missingFragments,
    recordsWithoutAddress: addresses.missing.length,
    cratesWithoutPage: crates.missing.length,
  };
}

function summary(report) {
  const { markdown, links, search, addresses, crates } = report;
  const failed = failures(report);
  const total = Object.values(failed).reduce((sum, count) => sum + count, 0);
  const pin = {
    pin: `, the commit basalt's main (\`${report.basaltCommit.slice(0, 12)}\`) pins`,
    override: ", a commit named for this build in place of basalt's pin",
    local: ", a local checkout",
  }[report.recordSource];
  const lines = [
    "## nifeos.org build",
    "",
    `Built from nifeos/record at \`${report.recordCommit.slice(0, 12)}\`${pin}, and ${crates.checked} crates at the commits crates.toml pins. Nothing is deployed; the site is this run's artifact.`,
    "",
    total ? `**${total} check failures.** The build fails.` : "Every check passes.",
    "",
    "| measure | value |",
    "|---|---|",
    `| Eleventy build | ${report.build.toFixed(1)} s |`,
    `| Pagefind index | ${report.pagefind.toFixed(1)} s |`,
    `| pages | ${links.pages} (from ${report.source.markdown} Markdown files, ${report.source.words.toLocaleString("en-US")} words, and ${report.source.crates} crate READMEs, ${report.source.crateWords.toLocaleString("en-US")} words) |`,
    `| numbered records at their address | ${addresses.checked}, of which ${addresses.missing.length} have no page |`,
    `| crates in crates.toml at their address | ${crates.checked}, of which ${crates.missing.length} have no page |`,
    `| search index | ${megabytes(report.index.bytes)} in ${report.index.files} files; a first search fetches ${(search.firstSearchBytes / 1024).toFixed(0)} KB |`,
    `| whole site | ${megabytes(report.site.bytes)} in ${report.site.files} files |`,
    `| citations (\`milestone N\`, \`§N\`) | ${markdown.citations}, of which ${markdown.unresolvedCitations} name no record |`,
    `| repository references (\`#N\`, \`nifeos/<repo>#N\`, \`@<commit>\`, \`:<path>\`) | ${markdown.pullRequestReferences + markdown.qualifiedReferences} |`,
    `| internal links checked | ${links.internalLinks}: ${links.missingPages} to no page, ${links.missingFragments} to no heading |`,
    `| relative links in the record | ${markdown.relativeLinks}: ${markdown.inRecordBreaks} to no file, ${markdown.repositoryLinks} to record files the site does not render (linked on GitHub) |`,
    `| relative links in crate READMEs | ${markdown.crateRelativeLinks}: ${markdown.crateBreaks} to no file, ${markdown.crateRepositoryLinks} to crate files the site does not render (linked on GitHub at the pin) |`,
    `| lockfile | ${report.packages.locked} packages locked${report.packages.installed === null ? "" : `, ${report.packages.installed} installed on this platform`} |`,
    "",
    "Searches: " + search.results.map((result) => `\`${result.query}\` ${result.hits}`).join(", ") + ".",
  ];
  const examples = (title, list) => {
    if (!list.length) return;
    lines.push("", `<details><summary>${title} (first ${list.length})</summary>`, "", "```", ...list, "```", "", "</details>");
  };
  examples("Citations that name no record", markdown.unresolvedExamples);
  examples("Relative links to no file", markdown.inRecordBreakExamples);
  examples("Links to no page or heading", links.examples);
  examples("Numbered records with no page at their address", addresses.missing);
  examples("Crates with no page at their address", crates.missing);
  return { text: lines.join("\n") + "\n", total };
}

const staged = stage();
const built = await build(staged);
const indexed = await index();
const links = checkLinks(output);
const addresses = checkAddresses(output, staged.tracked);
const crates = checkCratePages(staged.crates);
const search = await searchCheck(output);
const report = {
  recordCommit,
  recordSource,
  basaltCommit,
  source: {
    markdown: staged.markdown,
    words: staged.words,
    tracked: staged.tracked.length,
    crates: staged.crates.count,
    crateWords: staged.crates.words,
  },
  build: built.elapsed,
  pagefind: indexed.elapsed,
  pagefindPages: indexed.pages,
  index: directoryBytes(path.join(output, "pagefind")),
  site: directoryBytes(output),
  markdown: built.stats,
  links,
  addresses,
  crates,
  search,
  packages: lockedPackages(),
};
const { text, total } = summary(report);
report.failures = failures(report);
fs.writeFileSync(path.join(work, "report.json"), JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync(path.join(work, "summary.md"), text);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
process.stdout.write(text);
process.stdout.write(`\nsite: ${output}\n`);
if (total) process.exit(1);
