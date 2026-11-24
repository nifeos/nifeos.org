// Eleventy's configuration for the site. build.mjs stages the record's tracked Markdown into an
// input directory laid out as the record is, so a file's path under the input is its path in the
// record, and passes that directory and the lists of files through the environment. See
// script/site.

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
  const markdown = createPlugin({ input, onSite, inRecord, recordCommit: commit, nifeCommit });

  // The input sits under target/, which .gitignore names, so Eleventy must not read .gitignore.
  config.setUseGitIgnore(false);
  config.amendLibrary("md", (md) => md.use(anchor, { slugify }).use(markdown.plugin));

  const repositoryPath = (data) =>
    path.relative(input, path.resolve(data.page.inputPath)).split(path.sep).join("/");
  const isIndex = (data) => repositoryPath(data) === "index.njk";

  config.addGlobalData("eleventyComputed", {
    permalink: (data) => (isIndex(data) ? "/index.html" : addressFor(repositoryPath(data)) + "index.html"),
    sourcePath: (data) => repositoryPath(data),
    sourceUrl: (data) => `https://github.com/partsfoundry/record/blob/${commit}/${repositoryPath(data)}`,
    kind: (data) => (isIndex(data) ? "" : addressFor(repositoryPath(data)).split("/")[1]),
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
  config.addFilter("kinds", (pages) => [...new Set(pages.map((page) => page.data.kind))].sort());

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
