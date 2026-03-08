# Keyflare TODOs

## Testing & validation

- [ ] **Actual testing on Cloudflare** — Does it all work? So far only tested locally.
- [ ] **`kfl download` and `kfl upload`** — Not yet tested.
- [ ] **Download in different formats** — Not yet tested.
- [ ] **Global installs** — Never tried; only use `pnpm run kfl`.

---

## CLI

- [ ] **`kfl update`** — Same behaviour as `kfl init`, but **never** creates; only updates. Logic already exists, just add a synonym command.
- [ ] **Custom worker/D1 flags** — Support `--workername` and `--d1id` for custom names and bindings (only `--masterkey` exists today). Use on `kfl init` and `kfl update`. *(Note: kfl remembers URL + userkey/systemkey; URL could be custom later, so we wouldn’t know the worker name.)_
- [ ] **`kfl dev` → `kfl init --local`** — `kfl dev` was meant for local testing only; it shouldn’t be a top-level command. Hide it behind `kfl init --local` to set up locally for testing.

---

## Documentation

- [ ] **Docs hosting** — How to host? GitHub Pages? Aim for a strong docs site (not “average” GitHub.io).
- [ ] Keep docs in `docs/` accurate and complete (see AGENTS.md).

---

## Legal & release

- [x] **License**
  - [x] Create LICENSE doc
  - [ ] Decide which license to use.
- [ ] **npm publish** — Can we publish now, or do we first move the repo to an org?
- [ ] **GitHub Actions** — Auto-release (e.g. non-prerelease versions) on tags.

---

## Note on D1 schema

The D1 schema is correct as-is. Many columns have both a hash and an encryption field; that’s intentional for seeding and searching, not a mistake.

## CLI

- [x] add DEBUG logs
- [ ] make sure it's idempotent
- [ ] clone the repo locally in tmp to run the wrangler commands (or can we not use at all the server path?)
- [ ] do not auth on every run. Please check first how the user is logged in with `npx wrangler whoami --json`
- [ ] do not store the keyflare config as toml. Use yaml.

