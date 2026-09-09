# Content Architecture

## Target Split

```text
vie-group.github.io
  Website code, static HTML/CSS/JS, deployment logic.

vie-group-content
  JSON data, user-submitted seminar files, future publication/activity assets,
  issue templates, and content validation workflows.
```

## Update Flow

```text
Student or maintainer opens a content issue
  -> content repo workflow validates identity and input
  -> attachments are downloaded into assets/
  -> data/*.json is updated in the content repo
  -> website repo is notified to sync or deploy
```

## Near-Term Migration Plan

1. Keep `vie-group.github.io` serving the current site.
2. Keep seminar upload/delete/update workflows in `vie-group-content`.
3. Let the website repo fetch or sync `vie-group-content/data/*.json`.
4. Store newly uploaded seminar assets in `vie-group-content/assets/seminars/`.
5. Configure `VIE_SITE_SYNC_TOKEN` for automatic cross-repo sync.
6. Migrate legacy `media/` only after the content workflow is stable.

## Review Rules

- Text metadata changes should be visible in JSON diffs.
- Binary files should live under `assets/`, not beside website source code.
- Generated or recovery logs should live under `archive/manifests/`.
- Workflow-generated PRs should be small: one content record plus its related assets.
