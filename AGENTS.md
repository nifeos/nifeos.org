# Working on nifeos.org

This repository builds the website from the design record (`nifeos/record`). README.md says what
the site is, which record commit it builds and how to run the build.

## The lane skills live in nife

A lane here works by the same rules as a lane in nife, and nife keeps them, once. Read each one at
the moment named, from nife's `main`:

- Before any work in a lane, read `nifeos/nife:notes/skills/developer-lane/SKILL.md`. It holds the
  claim, the handoff and where identified work goes.
- Before you choose between options, recommend one, or hold work for an architect, read
  `nifeos/nife:notes/skills/decisions/SKILL.md`.
- Before you mint or change a name, read `nifeos/nife:notes/skills/naming-authority/SKILL.md`.
- Before you commit or push, read `nifeos/nife:notes/skills/worktree-commits/SKILL.md`. Never use
  git stash, and never rewrite a pushed commit.

nife's `AGENTS.md` holds the rest of the house rules (American spelling, no em-dashes, a document
states the rule in force now).

## Claiming a lane

This repository has no `script/claim` yet. Claim by hand, as the claim does: cut a branch named
`lane/<name>`, make one empty commit (`git commit --allow-empty -m "claim: <what>"`), push it, and
open a draft pull request whose body opens with `**Lane:** <name>`.

## Where things go

The record's text changes in nifeos/record, and code in the repository that owns it. A change here
is to the builder: how the site renders, links, indexes and checks what it pulls. A change that
needs the record to change first names the record's pull request, and not the other way round.
