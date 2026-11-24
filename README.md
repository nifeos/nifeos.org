# partsfoundry.org

This repository builds the website at partsfoundry.org. Today the site is the design record of the
nifeos projects: every roadmap milestone, decision, journey, fatal risk, tenet and note in
[nifeos/record](https://github.com/nifeos/record), with search. A page for each crate and the
tutorial join it later.

None of what the site shows lives here. At build time the builder fetches the record from its own
repository, and this repository holds only the builder: an [Eleventy](https://www.11ty.dev/)
configuration, a markdown-it plugin, a link check and a [Pagefind](https://pagefind.app/) index
step.

## Addresses

Each numbered record has one address made of its kind and its number, and no title, because titles
are drafts:

| record | address |
|---|---|
| `design/roadmap/0533-*.md` | `/roadmap/533/` |
| `design/decisions/0201-*.md` | `/decisions/201/` |
| `design/journeys/01-*.md` | `/journeys/1/` |
| `design/fatal-risks/3-*.md` | `/fatal-risks/3/` |
| a file in a milestone's appendix directory, `design/roadmap/1018-*/measurements.md` | `/roadmap/1018/measurements/` |
| any other file, `design/naming.md`, `notes/citations.md` | `/naming/`, `/notes/citations/` |

There is no hand-written index. The front page lists the records by kind, read from each file's H1
and frontmatter. In prose, `milestone N` and `§N` link to those addresses, a bare `#N` links to that
pull request in nifeos/nife, and `nifeos/<repo>#N`, `nifeos/<repo>@<commit>` and
`nifeos/<repo>:<path>` link to GitHub, except that a `nifeos/record:<path>` naming a page this site
renders links to that page.

## Which record it builds

The builder reads `pins.toml` on basalt's main and builds the record commit in its `[record]`
table. basalt is the distribution, and that table says which commit of the record goes with what
it ships, so the site shows the record at the commit every other reader of the record (nife's
tooling, the record's own lint) uses, and a `nifeos/nife:<path>` link lands on the nife commit
pinned in the same file. basalt's record-pin-bump workflow proposes the record's newest main after
each merge there, so the site trails the record's main by one pull request in basalt. A build of the
record's main directly is a run away: `script/site --record-commit main`, or the workflow's
`record` input when it is started by hand.

## Building

```sh
script/site                              # the record at basalt's pin
script/site --record-commit main         # the record at another commit or branch
script/site --record ../record           # a local checkout of the record, at its HEAD
python3 -m http.server -d target/build/site
```

Then browse to http://localhost:8000/. Search needs the site served over HTTP, since Pagefind
fetches its index. The header of `script/site` says more.

The build fails when a link inside the site reaches no page or no heading, when a relative link in
the record names no file, when `milestone N` or `§N` names a record that does not exist, or when a
numbered record has no page at its address. It writes the counts, with examples of each failure, to
`target/build/summary.md` and `target/build/report.json`. Links to other sites are not checked in
the build, since a remote outage must not fail it; the weekly check below does that.

CI (`.github/workflows/site.yml`) runs the build on each pull request, in the merge queue and on
main, and uploads the built site as the run's artifact. Its job, `site build`, is the check the
ruleset on main requires.

## Links to other sites

`.github/workflows/external-links.yml` checks the site's links to other sites every Monday, and
whenever it is started by hand. It never runs on a pull request or in the merge queue, and no
ruleset requires it. It builds the site at basalt's pin and runs `script/external-links.mjs`,
which requests each distinct address once with Node's built-in `fetch`, with a timeout and two
retries, and at most two requests at a time to one host. It reports through one open issue labelled
`external-links`: a run with failures rewrites that issue's body, or opens it, and a run in which
every address answers closes it. The run's token has only `contents: read` and `issues: write`.

Against a local build:

```sh
script/site && node script/external-links.mjs
```

It writes `target/build/external-links.md` and `external-links.json`, and files nothing.

## Dependencies

Node is pinned in `.node-version`, with the tarball's digest in `.node-sha256`. The npm packages
are Eleventy, Pagefind and markdown-it-anchor, pinned at exact versions in `package-lock.json`.
They are CI-only dependencies under the ruling of 2026-11-04 (UTC): the lockfile is committed, they
install with `npm ci --ignore-scripts`, each version is at least two weeks old when pinned, and a
bump is an ordinary pull request. Any other npm package is a dependency decision for the
maintainers, not a convenience.

## Before the first deploy

The site deploys nowhere yet. GitHub Pages is not enabled for this repository, no custom domain is
set, and the workflow has no deploy job. Three things wait on a person who holds the domain's
registrar account and the organization's settings:

1. **The DNS records for partsfoundry.org.** At the registrar, the apex `partsfoundry.org` gets the
   four GitHub Pages addresses as `A` records, `185.199.108.153`, `185.199.109.153`,
   `185.199.110.153` and `185.199.111.153`, and as `AAAA` records, `2606:50c0:8000::153`,
   `2606:50c0:8001::153`, `2606:50c0:8002::153` and `2606:50c0:8003::153`. `www.partsfoundry.org`
   gets a `CNAME` to the organization's Pages host, `<organization>.github.io`. The organization is
   to be renamed from `nifeos` to `partsfoundry`, and that host name changes with it, so the
   `CNAME` is best set after the rename, or changed then.
2. **The organization's verified domain.** In the organization's settings, under Pages, add
   `partsfoundry.org` as a verified domain. GitHub then shows a `TXT` record, named
   `_github-pages-challenge-<organization>.partsfoundry.org`, to add at the registrar. Verifying
   stops any other GitHub account from serving a page on the domain. The record's name carries the
   organization's login, so a verification made before the rename may need redoing after it.
3. **Renewal.** Auto-renew, or a longer term, on the registration, since a lapse breaks every
   quoted link.

After those, enabling Pages (source: GitHub Actions), setting the custom domain to
`partsfoundry.org` with HTTPS enforced, and adding the deploy job are each a pull request or a
setting that waits for the architect's approval.

## Not here yet

- A page for each crate, from that crate's own repository at a pinned revision.
- The tutorial, from its own repository.
- The deploy, above.
