# tune-panel

The studio's dev-time tuning panel. README.md has the API; the `tune-live` skill has the workflow.

- One ES module, no build, no dependencies. Keep it that way: pages import it straight from jsDelivr by tag.
- Releases are git tags (`0.1.0`). Pages pin a tag, so a change only reaches them when they move the tag in their URL.
- Brand themes live in `themes/<slug>.js`, mapped by hand from `brands/<slug>/identity/tokens.json`.
- Check a change on `demo/index.html` (launch config `tune-panel`, port 5252) in every theme, light and dark.
- `npm test` for the maths.
