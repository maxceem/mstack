# mstack

The agent skills I use every day. They follow the open
[Agent Skills](https://agentskills.io) format, so the same files work in
Claude Code, Codex, OpenCode, Cursor, Gemini CLI, and other agents that read
`SKILL.md`.

## Skills

| Skill | Say | What it does |
|---|---|---|
| `council` | "council" | Gets review from three models from different providers, and loops until they agree. |
| `sol-loop` | "sol loop" | Reviews a change with GPT Sol in a loop until both agents agree. |
| `file-pr` | "file a PR" | Files a short PR that leads with the problem, not an inventory of changes. |
| `deploy-region-optimized-d1-worker` | "deploy a D1 worker in WEUR" | Deploys a Cloudflare D1 database and Worker with benchmark-guided placement for a region. |

## Install

Install every skill globally for all supported agents:

```bash
npx skills add maxceem/mstack --global --agent '*' --skill '*' --yes
```

Install one skill for specific agents:

```bash
npx skills add maxceem/mstack \
  --skill council \
  --global \
  --agent claude-code \
  --agent codex \
  --agent opencode \
  --yes
```

List the skills in this repository:

```bash
npx skills add maxceem/mstack --list
```

Update installed skills:

```bash
npx skills update --global
```

The repository is private for now, so installing needs Git credentials for
GitHub (for example `gh auth login` with `gh` set as the Git credential
helper).

## Requirements

- `council` and `sol-loop` need subagents that run other providers' models.
  Without a harness that can start them, the skills report the blocker instead
  of substituting a model.
- `deploy-region-optimized-d1-worker` needs Node.js, Wrangler, and a
  Cloudflare account.

## Make them yours

Put personal settings, like which models sit on the council, in your
`CLAUDE.md` or `AGENTS.md`, so the skills can be updated without losing them.

## Credits

`council`, `sol-loop`, and `file-pr` are copied from
[t3dotgg/tstack](https://github.com/t3dotgg/tstack) by Theo Browne, under the
MIT License. See [THIRD_PARTY_LICENSE-tstack](THIRD_PARTY_LICENSE-tstack).

## License

[MIT](LICENSE)
