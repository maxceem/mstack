---
name: task-to-pr
description: Use when the user says "task to PR" (or "task-to-pr") about a task they selected or quoted. Hands the task, enriched with the conversation's context, to a new T3 Code thread in its own worktree, which implements it, files a PR, reviews it with sol-loop, and reports back when the PR is ready to merge.
---

# Task to PR

The user is in the middle of a discussion and wants one clear subtask done
elsewhere, so they can keep talking here. Hand it to a new thread that works
in its own worktree, files a PR, reviews it with `sol-loop`, and reports
back only when the PR is ready for the user's final review.

Your job here is the handoff, not the work. Do not implement the task in this
thread.

## 1. Find the task

The task is the text the user selected, quoted or pointed at ("item 1",
"the mint guard"). It is usually a fragment of a longer answer, written
for someone who already read the whole conversation.

If the selection could mean two different pieces of work, ask one short
question. Otherwise proceed.

## 2. Build the brief

The new thread starts with no history. It sees only the brief, so
everything it needs must be in it. Expand the fragment into a self-contained
task from what this conversation already established:

- **Goal and why**: the problem in plain words, who it affects, and what
  "done" looks like.
- **What is already known**: facts verified here, and how they were verified
  (test, log, code reading). Say "verified" or "assumed". The thread should
  not redo research that is already done.
- **Where**: the repository, files, functions and line numbers involved. Name
  paths; do not paste large code.
- **Decisions already made** by the user, and decisions the thread may make
  on its own (to be justified in the PR).
- **In scope / out of scope**: list related items from the discussion that
  were not selected as out of scope. Keep the PR small.
- **Acceptance**: the behaviour to test, including edge and adversarial
  cases, docs to update, and the repository's check and test commands.
- **Rules**: tell it to read the repository's `AGENTS.md` / `CLAUDE.md`
  first.

Never put secrets, keys, tokens, or private production data (customer names,
user ids, request values) in the brief. Describe them generically.

If an important fact is missing and cheap to check (a file path, a function
name), check it before handing off. Do not start a new investigation.

## 3. Add the workflow

End the brief with these steps, adapted to the repository:

1. Implement on a descriptive branch. Run the repository's checks and
   tests until they pass.
2. Commit, and open the PR with the `file-pr` skill.
3. Run the `sol-loop` skill on the PR. Fix valid findings, re-run the
   checks, and push the fixes to the PR. Pushing to the PR is authorized.
4. Work autonomously. Make reasonable decisions instead of asking, and
   record them in the PR. Stop and ask only if truly blocked.
5. Do not merge.
6. Finish with a reply in the thread containing:
   - the PR URL;
   - a plain-language summary of the change;
   - the decisions made;
   - what the review found and how each finding was resolved;
   - anything left for the user to decide.

## 4. Launch

In T3 Code, call `t3_thread_launch` with:

- `workspaceStrategy: { type: "worktree", baseRef: "origin/<default branch>", startFromOrigin: true }`.
  If the task depends on unpublished local commits, use that local branch as
  the base with `startFromOrigin: false`.
- The same project as this thread, unless the task belongs to another
  repository. In that case, pass that project's id.
- A short `title` naming the task, and the brief as `message`.
- A stable `clientRequestId`, so a retry does not create a second thread.
- No model or mode overrides, unless the user named them.

If T3 tools are not listed, try `t3_thread_launch` once. If no route can
start a separate thread in its own worktree, report the blocker. Do not do
the work in this thread instead.

## 5. Report and return

Reply in a few lines:

- the new thread's `link`, verbatim;
- what was handed off;
- what you deliberately left out of scope.

Then go back to the main discussion. Do not wait for the thread or poll it.
The user hears from it when the PR is ready.
