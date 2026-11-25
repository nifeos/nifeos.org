// Checks the links from the built site to other sites, outside the merge gate.
//
// script/site checks every link inside the site and fetches nothing remote, because a remote outage
// must not fail a merge. This script is the other half: it reads the built site, collects each
// distinct address on another site (an `href` or `src` starting with http:// or https://, without
// its fragment), and requests each one once, with a timeout and a few retries. The weekly workflow
// (.github/workflows/external-links.yml) runs it and reports through one labelled issue.
//
// It needs nothing but Node's built-in `fetch`. Each address gets one GET that follows redirects;
// a network error, a timeout, a 429 or a 5xx is retried, twice, after a pause of 15 s and then
// 60 s, or what Retry-After asks. A final status of 400 or above, or an error, is a failure. A site's own `source:`
// link to the file it was built from is skipped: the build already knows that file exists at that
// commit. So is each address in NOT_REQUESTED below: a page a person loaded in a browser that refuses
// this script from a hosted runner, listed with the reason. The report names them, so they are not
// forgotten. Requests to one host run at most two at a time, so that no site sees a burst.
//
//     node script/external-links.mjs                       # target/build/site, as script/site left it
//     node script/external-links.mjs <site directory>
//
// It writes target/build/external-links.md and external-links.json, prints the summary, and, in
// GitHub Actions, writes `failed=<count>` to the step's output. It exits 0 when the check ran,
// whatever it found, and 1 only when it could not run.
//
// BUGS
//
// - A page that needs a login (an organization's settings page, say) answers 404 to a request
//   without one, and is reported as a failure.
// - Some sites refuse requests that do not come from a browser, with 403 or 429; those are
//   reported too, with their status, and a person judges them. One that loads in a browser goes
//   into NOT_REQUESTED.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(process.argv[2] || path.join(here, "..", "target", "build", "site"));
const out = path.dirname(site);
const TIMEOUT_MILLISECONDS = 20_000;
const ATTEMPTS = 3;
const PER_HOST = 2;
const OVERALL = 12;
const PAGES_SHOWN = 3;
const USER_AGENT = "nifeos.org-link-check (+https://github.com/nifeos/nifeos.org)";

// Addresses not requested, each with the reason. An entry is one exact address, not a host, so a
// new link to the same site is still checked once and a person judges it. Remove an entry when its
// page stops loading in a browser or the record stops linking it.
const NOT_REQUESTED = new Map([
  ["https://forums.raspberrypi.com/viewtopic.php?t=371974", "Cloudflare challenge (403) to any script; loads in a browser"],
  ["https://uefi.org/specs/UEFI/2.10/03_Boot_Manager.html", "403 to a hosted runner; 200 elsewhere, and loads in a browser"],
  ["https://wiki.osdev.org", "Cloudflare challenge (403) to any script; loads in a browser"],
  [
    "https://www.cnx-software.com/2026/05/11/rva23-pico-itx-sbc-spacemit-k3-octa-core-risc-v-ai-soc-up-to-32gb-ram-256gb-ufs/",
    "403 to a hosted runner; 200 elsewhere, and loads in a browser",
  ],
]);

function htmlFiles(root) {
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
    const full = path.join(entry.parentPath, entry.name);
    const top = path.relative(root, full).split(path.sep)[0];
    if (top !== "pagefind" && top !== "files") found.push(full);
  }
  return found.sort();
}

// Each distinct external address, with the site pages that link to it.
function collect(root) {
  const addresses = new Map();
  for (const file of htmlFiles(root)) {
    const directory = path.relative(root, path.dirname(file)).split(path.sep).join("/");
    const page = directory ? `/${directory}/` : "/";
    const html = fs.readFileSync(file, "utf8").replace(/<nav>[\s\S]*?<\/nav>/g, "");
    for (const match of html.matchAll(/\b(?:href|src)="(https?:\/\/[^"]+)"/gi)) {
      const address = match[1].replace(/&amp;/g, "&").split("#")[0];
      if (!addresses.has(address)) addresses.set(address, new Set());
      addresses.get(address).add(page);
    }
  }
  return addresses;
}

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function retryAfter(response, attempt) {
  const header = Number(response?.headers.get("retry-after"));
  // GitHub answers a burst of file pages with 503 for a minute or so, so the pauses are long.
  const seconds = Number.isFinite(header) && header > 0 ? Math.min(header, 120) : 15 * 4 ** (attempt - 1);
  return seconds * 1000;
}

async function check(address) {
  let last = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let response;
    try {
      response = await fetch(address, {
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MILLISECONDS),
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      });
      await response.body?.cancel();
      if (response.status < 400) return { ok: true, status: response.status, attempts: attempt };
      last = `HTTP ${response.status}`;
      if (response.status !== 429 && response.status < 500) return { ok: false, result: last, attempts: attempt };
    } catch (error) {
      last = error.name === "TimeoutError" ? `no answer in ${TIMEOUT_MILLISECONDS / 1000} s` : String(error.cause?.code || error.message);
    }
    if (attempt < ATTEMPTS) await pause(retryAfter(response, attempt));
  }
  return { ok: false, result: last, attempts: ATTEMPTS };
}

// Runs every check, at most PER_HOST at a time against one host and OVERALL at a time in all.
async function checkAll(addresses) {
  const byHost = new Map();
  for (const address of addresses) {
    const host = new URL(address).host;
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(address);
  }
  const results = new Map();
  const lanes = [];
  for (const [, queue] of byHost) for (let lane = 0; lane < Math.min(PER_HOST, queue.length); lane++) lanes.push(queue);
  let running = 0;
  const waiting = [];
  const slot = async () => {
    while (running >= OVERALL) await new Promise((resolve) => waiting.push(resolve));
    running++;
  };
  const release = () => {
    running--;
    waiting.shift()?.();
  };
  await Promise.all(
    lanes.map(async (queue) => {
      for (let address = queue.shift(); address; address = queue.shift()) {
        await slot();
        try {
          results.set(address, await check(address));
        } finally {
          release();
        }
      }
    }),
  );
  return results;
}

function report(addresses, results, skipped, seconds) {
  const failed = [...results].filter(([, result]) => !result.ok).sort(([a], [b]) => a.localeCompare(b));
  const pages = new Set([...addresses.values()].flatMap((set) => [...set]));
  const hosts = new Set([...addresses.keys()].map((address) => new URL(address).host));
  const lines = [
    "## Links to other sites",
    "",
    `${addresses.size} distinct addresses on ${hosts.size} hosts, linked from ${pages.size} pages, checked in ${Math.round(seconds)} s.`,
    "",
    `${skipped.length} not requested, each named in script/external-links.mjs with the reason: ${skipped.map((address) => `<${address}>`).join(", ") || "none"}.`,
    "",
    failed.length ? `**${failed.length} failed.**` : "Every address requested answered.",
  ];
  if (failed.length) {
    lines.push("", "| address | result | linked from |", "|---|---|---|");
    for (const [address, result] of failed) {
      const from = [...addresses.get(address)].sort();
      const shown = from.slice(0, PAGES_SHOWN).map((page) => `\`${page}\``).join(", ");
      const more = from.length > PAGES_SHOWN ? ` and ${from.length - PAGES_SHOWN} more` : "";
      lines.push(`| <${address}> | ${result.result} | ${shown}${more} |`);
    }
  }
  return { text: lines.join("\n") + "\n", failed };
}

try {
  if (!fs.existsSync(path.join(site, "index.html"))) throw new Error(`no built site at ${site}; run script/site first`);
  const start = Date.now();
  const addresses = collect(site);
  const skipped = [...addresses.keys()].filter((address) => NOT_REQUESTED.has(address)).sort();
  const results = await checkAll([...addresses.keys()].filter((address) => !NOT_REQUESTED.has(address)));
  const { text, failed } = report(addresses, results, skipped, (Date.now() - start) / 1000);
  const json = {
    addresses: addresses.size,
    notRequested: skipped.map((address) => ({ address, reason: NOT_REQUESTED.get(address) })),
    failed: failed.map(([address, result]) => ({ address, ...result, pages: [...addresses.get(address)].sort() })),
  };
  fs.writeFileSync(path.join(out, "external-links.md"), text);
  fs.writeFileSync(path.join(out, "external-links.json"), JSON.stringify(json, null, 2) + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `failed=${failed.length}\n`);
  process.stdout.write(text);
} catch (error) {
  process.stderr.write(`external-links: ${error.stack || error.message}\n`);
  process.exit(1);
}
