# Frontend skills

Frontend-scoped on purpose. Claude Code loads them the moment an agent touches
a file under `frontend/`, so they cost no context during backend work. A skill
whose name also exists globally is offered as `frontend:<name>` and wins for
files under `frontend/`.

Exception: `ui-skills`, `better-ui`, `ui-design-pass` and `ui-before-after`
are also linked from the root `.agents/skills/` and `.claude/skills/`, so a session started at the
repository root offers them too (Claude Code: `/ui-skills`; Codex: `$ui-skills`).
The real files stay here.

**`.claude/rules/frontend-ui-kit.md` outranks every skill in here.** Its "UI
skills" section names the three places where the vendored `better-*` advice is
wrong for this repo. Check it before acting on a skill's colour, surface, or
copy recommendation, and do not restate its rules here. One authority is the
whole point.

## Design pass and screenshot pairs

- **`ui-design-pass`**: type `/ui-design-pass new` at the end of a task that
  creates UI, or `/ui-design-pass rework <screen>: <what bothers you>` for an
  existing screen. It runs only when asked by name; in Codex, name it in the
  prompt.
- **`ui-before-after`**: before/after pairs for a PR, with the changed regions
  outlined and numbered. `ui-design-pass` calls it for a rework.

## Layout

Real files live in `frontend/.claude/skills/`; `frontend/.agents/skills/`
symlinks to them for Codex and other agents that follow the `.agents`
convention. Root skills instead live in `.agents/skills/` with directory
symlinks from `.claude/skills/`. Preserve one real copy per skill and use
canonical paths; copying and rewriting paths for each agent causes drift.

`react-doctor` points the other way (real files in `frontend/.agents/skills/`,
symlink from here). Left as it was.

## Vendored: `better-*`

Seven interface skills from [jakubkrehel/skills](https://github.com/jakubkrehel/skills):
`better-interface` plus `better-accessibility`, `better-layout`,
`better-writing`, `better-typography`, `better-colors`, `better-ui`.
MIT-licensed; the upstream licence text is in `LICENSE-better-skills` and has
to stay with the files.

`better-interface` coordinates the other six. Invoke it for a full pass
instead of running several overlapping reviews:

```
/better-interface                    # full review of the current scope
/better-interface quick              # HIGH and MEDIUM only, capped at 5 findings
/better-interface full checkout flow
```

The other six trigger from context on their own.

### Updating

```bash
cd frontend && npx skills add jakubkrehel/skills --skill '*'
```

The CLI writes real directories into `.agents/skills/` and replaces the
symlinks. Move them back and restore the links:

```bash
cd frontend
for s in .agents/skills/better-*; do
  n=$(basename "$s")
  rm -rf ".claude/skills/$n" && mv "$s" ".claude/skills/$n"
  ln -s "../../.claude/skills/$n" ".agents/skills/$n"
done
```

Then re-check the conflict table in `.claude/rules/frontend-ui-kit.md` against
the new content.
