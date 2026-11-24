// The markdown-it plugin that turns the record's own references into links on the site.
//
// - `milestone N` and `§N` in prose link to /roadmap/N/ and /decisions/N/, when that record
//   exists. A citation of a number with no record is counted, kept as an example and left as
//   text, and the build fails on it.
// - A bare `#N` links to that pull request or issue in partsfoundry/nife, which is what the record's
//   text written before it left nife means by it.
// - `partsfoundry/<repo>#N` links to that pull request or issue, and `partsfoundry/<repo>@<commit>` to that
//   commit, in prose or as a whole code span. `partsfoundry/<repo>:<path>` links to the file at the
//   commit it means: a record page the site renders at its address, any other record file at the
//   commit being built, and a partsfoundry/nife file at the commit basalt pins. A path in any other repository stays text, since the revision it means comes from
//   a lockfile this build does not read.
// - A relative link or image resolves against the source file's path in the record. A target on
//   the site becomes its stable address (lib/address.cjs). A record file the site does not render
//   (a script, a data file) links to that file in partsfoundry/record at the built commit. A target
//   that exists nowhere in the record is a break: counted, kept as an example, rendered as plain
//   text, and the build fails on it.
//
// The counts land in `stats`, which build.mjs writes to the build's report.

"use strict";

const path = require("node:path");
const { addressFor, numbersIn } = require("./address.cjs");

const EXAMPLE_LIMIT = 40;
const GITHUB = "https://github.com/partsfoundry";

// A citation names partsfoundry, or nifeos, its former name, which a record at an older pin may
// still say. Both link to the organization under its present name.
const CITATION = /\b([Mm]ilestones?) (\d+)|§(\d+)|(^|[\s(])#(\d{1,5})\b|\b(?:partsfoundry|nifeos)\/([A-Za-z0-9_.-]*[A-Za-z0-9_-])(?:#(\d+)\b|@([0-9a-f]{7,40})\b|:([A-Za-z0-9_./-]*[A-Za-z0-9_/-]))/g;
const QUALIFIED = /^(?:partsfoundry|nifeos)\/([A-Za-z0-9_.-]*[A-Za-z0-9_-])(?:#(\d+)|@([0-9a-f]{7,40})|:([A-Za-z0-9_./-]*[A-Za-z0-9_/-]))$/;

function createPlugin({ input, onSite, inRecord, recordCommit, nifeCommit }) {
  const known = {
    milestone: numbersIn(onSite, "design/roadmap/"),
    decision: numbersIn(onSite, "design/decisions/"),
  };
  const onSiteSet = new Set(onSite);
  const inRecordSet = new Set(inRecord);
  const inRecordDirectories = new Set();
  for (const file of inRecord) {
    for (let directory = path.posix.dirname(file); directory !== "."; directory = path.posix.dirname(directory)) {
      inRecordDirectories.add(directory);
    }
  }
  const commits = { record: recordCommit, nife: nifeCommit };
  const stats = {
    citations: 0,
    unresolvedCitations: 0,
    unresolvedExamples: [],
    pullRequestReferences: 0,
    qualifiedReferences: 0,
    relativeLinks: 0,
    inRecordBreaks: 0,
    inRecordBreakExamples: [],
    repositoryLinks: 0,
    assets: new Set(),
  };

  function note(list, entry) {
    if (list.length < EXAMPLE_LIMIT) list.push(entry);
  }

  function repositoryPathOf(env) {
    return path.relative(input, path.resolve(env.page.inputPath)).split(path.sep).join("/");
  }

  // The URL a `partsfoundry/<repo>` reference names, or null when this build cannot say which revision
  // a path means.
  function qualifiedHref(repository, number, commit, file) {
    if (number) return `${GITHUB}/${repository}/issues/${number}`;
    if (commit) return `${GITHUB}/${repository}/commit/${commit}`;
    if (repository === "record" && onSiteSet.has(file) && addressFor(file)) return addressFor(file);
    if (!commits[repository]) return null;
    return `${GITHUB}/${repository}/blob/${commits[repository]}/${file}`;
  }

  // Resolves a relative href from the file at `from`, both record paths. Returns the new href, or
  // null for a target that exists nowhere in the record (counted here).
  function resolve(href, from) {
    stats.relativeLinks++;
    const [file, fragment] = href.split("#");
    const suffix = fragment ? "#" + fragment : "";
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), decodeURI(file)));
    const clean = target.replace(/\/$/, "");
    if (onSiteSet.has(clean)) {
      const address = addressFor(clean);
      if (address) return address + suffix;
      stats.assets.add(clean);
      return "/files/" + clean;
    }
    if (onSiteSet.has(clean + "/README.md")) return addressFor(clean + "/README.md") + suffix;
    if (!clean.startsWith("../") && (inRecordSet.has(clean) || inRecordDirectories.has(clean))) {
      stats.repositoryLinks++;
      const kind = inRecordSet.has(clean) ? "blob" : "tree";
      return `${GITHUB}/record/${kind}/${recordCommit}/${clean}${suffix}`;
    }
    stats.inRecordBreaks++;
    note(stats.inRecordBreakExamples, `${from} -> ${href}`);
    return null;
  }

  function isRelative(href) {
    return href && !/^[a-z][a-z0-9+.-]*:|^#|^\//i.test(href);
  }

  function citationsRule(state) {
    const Token = state.Token;
    const text = (content) => {
      const token = new Token("text", "", 0);
      token.content = content;
      return token;
    };
    const link = (href, children) => {
      const open = new Token("link_open", "a", 1);
      open.attrs = [["href", href], ["class", "cite"]];
      return [open, ...children, new Token("link_close", "a", -1)];
    };
    for (const block of state.tokens) {
      if (block.type !== "inline" || !block.children) continue;
      let depth = 0;
      const out = [];
      for (const token of block.children) {
        if (token.type === "link_open") depth++;
        if (token.type === "link_close") depth--;
        if (token.type === "code_inline" && depth === 0) {
          const match = QUALIFIED.exec(token.content);
          const href = match && qualifiedHref(match[1], match[2], match[3], match[4]);
          if (href) {
            stats.qualifiedReferences++;
            out.push(...link(href, [token]));
          } else out.push(token);
          continue;
        }
        if (token.type !== "text" || depth > 0) {
          out.push(token);
          continue;
        }
        let last = 0;
        CITATION.lastIndex = 0;
        let match;
        while ((match = CITATION.exec(token.content))) {
          let href;
          let start = match.index;
          let label = match[0];
          if (match[6]) {
            href = qualifiedHref(match[6], match[7], match[8], match[9]);
            if (!href) continue;
            stats.qualifiedReferences++;
          } else if (match[5]) {
            stats.pullRequestReferences++;
            start += match[4].length;
            label = "#" + match[5];
            href = `${GITHUB}/nife/issues/${match[5]}`;
          } else {
            stats.citations++;
            const isMilestone = Boolean(match[1]);
            const number = String(Number(match[2] || match[3]));
            if (!known[isMilestone ? "milestone" : "decision"].has(number)) {
              stats.unresolvedCitations++;
              note(stats.unresolvedExamples, `${repositoryPathOf(state.env)}: ${match[0]}`);
              continue;
            }
            href = `/${isMilestone ? "roadmap" : "decisions"}/${number}/`;
          }
          if (start > last) out.push(text(token.content.slice(last, start)));
          out.push(...link(href, [text(label)]));
          last = start + label.length;
        }
        if (last === 0) out.push(token);
        else if (last < token.content.length) out.push(text(token.content.slice(last)));
      }
      block.children = out;
    }
  }

  function plugin(md) {
    md.core.ruler.push("record_citations", citationsRule);
    const renderToken = (tokens, index, options, env, self) => self.renderToken(tokens, index, options);
    const linkOpen = md.renderer.rules.link_open || renderToken;
    md.renderer.rules.link_open = (tokens, index, options, env, self) => {
      const token = tokens[index];
      const href = token.attrGet("href");
      if (isRelative(href)) {
        const resolved = resolve(href, repositoryPathOf(env));
        if (resolved) token.attrSet("href", resolved);
        else {
          token.attrs = token.attrs.filter(([name]) => name !== "href");
          token.attrSet("class", "broken");
          token.attrSet("title", href);
        }
      }
      return linkOpen(tokens, index, options, env, self);
    };
    const image = md.renderer.rules.image;
    md.renderer.rules.image = (tokens, index, options, env, self) => {
      const token = tokens[index];
      const source = token.attrGet("src");
      if (isRelative(source)) {
        const resolved = resolve(source, repositoryPathOf(env));
        token.attrSet("src", resolved || "");
      }
      return image(tokens, index, options, env, self);
    };
  }

  return { plugin, stats };
}

module.exports = { createPlugin };
