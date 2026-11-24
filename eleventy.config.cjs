// Eleventy's configuration for the site. build.mjs stages the record's tracked Markdown into an
// input directory laid out as the record is, so a file's path under the input is its path in the
// record, and each crate's README at crates/<crate>/README.md beside it. It passes that directory,
// the lists of files and the crates through the environment. See script/site.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const anchor = require("markdown-it-anchor");
const { addressFor } = require("./lib/address.cjs");
const { createPlugin } = require("./lib/markdown.cjs");

// Heading identifiers as GitHub writes them, so a `#fragment` written against GitHub's rendering
// lands on the same heading here.
function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

module.exports = function configure(config) {
  const input = process.env.SITE_INPUT;
  const lines = (file) => fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  const onSite = lines(process.env.SITE_FILES);
  const inRecord = lines(process.env.SITE_RECORD_FILES);
  const commit = process.env.SITE_RECORD_COMMIT || "main";
  const nifeCommit = process.env.SITE_NIFE_COMMIT || "";
  const crates = process.env.SITE_CRATES_JSON ? JSON.parse(fs.readFileSync(process.env.SITE_CRATES_JSON, "utf8")) : [];
  const markdown = createPlugin({ input, onSite, inRecord, recordCommit: commit, nifeCommit, crates });
  const crateByName = new Map(crates.map((crate) => [crate.name, crate]));

  // The input sits under target/, which .gitignore names, so Eleventy must not read .gitignore.
  config.setUseGitIgnore(false);
  config.amendLibrary("md", (md) => md.use(anchor, { slugify }).use(markdown.plugin));

  const repositoryPath = (data) =>
    path.relative(input, path.resolve(data.page.inputPath)).split(path.sep).join("/");
  const isIndex = (data) => repositoryPath(data) === "index.njk";
  // The crate a staged crates/<crate>/README.md belongs to, or undefined for a record file.
  const crateOf = (data) => {
    const match = /^crates\/([^/]+)\/README\.md$/.exec(repositoryPath(data));
    return match ? crateByName.get(match[1]) : undefined;
  };
  const source = (data) => {
    const crate = crateOf(data);
    return crate
      ? { repository: crate.repository, commit: crate.commit, path: "README.md" }
      : { repository: "nifeos/record", commit, path: repositoryPath(data) };
  };

  config.addGlobalData("crates", crates.map(({ name, repository, commit: pin }) => ({ name, repository, commit: pin })));
  config.addGlobalData("eleventyComputed", {
    permalink: (data) => {
      if (isIndex(data)) return "/index.html";
      const crate = crateOf(data);
      return (crate ? `/crates/${crate.name}/` : addressFor(repositoryPath(data))) + "index.html";
    },
    sourcePath: (data) => source(data).path,
    sourceRepository: (data) => source(data).repository,
    sourceUrl: (data) => {
      const { repository, commit: pin, path: file } = source(data);
      return `https://github.com/${repository}/blob/${pin}/${file}`;
    },
    kind: (data) => {
      if (isIndex(data)) return "";
      return crateOf(data) ? "crates" : addressFor(repositoryPath(data)).split("/")[1];
    },
    title: (data) => {
      const heading = /^#\s+(.+)$/m.exec(data.page.rawInput || "");
      return heading ? heading[1].replace(/`/g, "") : data.page.fileSlug;
    },
    layout: (data) => (isIndex(data) ? false : "page.njk"),
  });

  config.addCollection("record", (api) => api.getFilteredByGlob("**/*.md"));
  config.addFilter("byKind", (pages, kind) =>
    pages
      .filter((page) => page.data.kind === kind)
      .sort((a, b) => a.url.localeCompare(b.url, undefined, { numeric: true })),
  );
  // The record's kinds, for the front page; the crates are listed apart, in crates.toml's order.
  config.addFilter("kinds", (pages) =>
    [...new Set(pages.map((page) => page.data.kind))].filter((kind) => kind !== "crates").sort(),
  );

  config.on("eleventy.after", () => {
    const { assets, ...counts } = markdown.stats;
    const report = { ...counts, assets: [...assets].sort() };
    fs.writeFileSync(process.env.SITE_MARKDOWN_STATS, JSON.stringify(report, null, 2));
  });

  return {
    dir: { input, includes: "_includes", output: process.env.SITE_OUTPUT },
    templateFormats: ["md", "njk"],
    markdownTemplateEngine: false,
    htmlTemplateEngine: "njk",
  };
};
