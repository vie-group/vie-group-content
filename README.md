# VIE Group Content Repository

This repository owns structured website content and uploaded assets for the VIE Group website.

The website implementation stays in `vie-group/vie-group.github.io`. This repository is intended to reduce coupling between site code, editable content, and large uploaded materials.

## Directory Layout

```text
data/
  site.json
  news.json
  team.json
  publications.json
  seminars.json
  activities.json
  activity-details.json

assets/
  seminars/<year>/<seminar-id>/
    image.*
    paper.*
    slides.*
  publications/<year>/<publication-id>/
  activities/<year>/<activity-id>/

archive/
  manifests/
  legacy-media/

schemas/
scripts/
.github/
  ISSUE_TEMPLATE/
  workflows/
docs/
```

## Ownership

- `data/` contains reviewable JSON records.
- `assets/seminars/` contains files uploaded through seminar issue workflows.
- `assets/publications/` contains files uploaded through publication edit workflows.
- `assets/activities/` is reserved for recovered or newly added activity photos.
- `archive/manifests/` stores recovery and migration manifests.
- `archive/legacy-media/` is reserved for later migration of old `media/` assets from the website repository.
- `schemas/` and `scripts/` will hold content validation and migration tools.
- `.github/ISSUE_TEMPLATE/` and `.github/workflows/` own seminar submission/deletion and manual content update flows.

## Path Policy

Content records should prefer repository-relative paths:

```json
"slides": "assets/seminars/2026/example-seminar/slides.pptx"
```

The website repository should resolve these paths through a configurable content base URL. Existing legacy `media/...` references may remain in `vie-group.github.io` until the legacy media migration is completed.

## Current Scope

This repository currently contains:

- current `data/*.json`
- current workflow-localized seminar assets under `assets/seminars/`
- seminar submission, edit, and deletion issue templates
- publication edit issue template
- content update workflows for News, Publications, and Seminars
- validation scripts and CI

`vie-group.github.io` is the presentation layer. It consumes this repository at runtime through `content-source.json`.

Historical seminar rows from the recovered legacy `presentation/index.html` were imported into `data/seminars.json`. The import can be rerun from a local checkout:

```bash
npm run import:legacy-presentation
```

Historical publication rows from the recovered legacy `publication/index.html` were imported into `data/publications.json`. The import can be rerun from a local checkout:

```bash
npm run import:legacy-publication
```

## Published URLs

GitHub Pages publishes this repository at:

```text
https://vie-group.github.io/vie-group-content/
```

Important public endpoints:

```text
https://vie-group.github.io/vie-group-content/data/seminars.json
https://vie-group.github.io/vie-group-content/data/publications.json
https://vie-group.github.io/vie-group-content/assets/seminars/
https://vie-group.github.io/vie-group-content/rss.xml
```

The website repository does not need a sync commit after content changes.

## Editing One Seminar

Preferred path:

1. Open `https://vie-group.github.io/presentation/?manage=1`.
2. Click `EDIT` on the seminar row to edit, or open `https://vie-group.github.io/edit-seminar/?manage=1` and choose a record.
3. Check the pre-filled metadata and links.
4. Keep an existing URL/path if it should remain unchanged.
5. Clear a URL/path if the field should be removed.
6. On the GitHub issue page, drag a replacement file into the matching attachment section when replacing image, paper, or slides.
7. Submit the issue.

The `seminar-edit` workflow treats the issue as the complete desired final record for that seminar. `Original Seminar ID` remains stable even if date or title changes. Attachments override matching URL fields and are copied into `assets/seminars/<year>/<seminar-id>/`.

Unlike seminar deletion, editing is not limited to the original submitter. Any repository `OWNER`, `MEMBER`, or `COLLABORATOR` can edit any selected seminar record; outside users are rejected by the workflow.

## Editing One Publication

Preferred path:

1. Open `https://vie-group.github.io/publication/?manage=1`.
2. Click `(edit publication...)`, or open `https://vie-group.github.io/edit-publication/?manage=1` and choose a record.
3. Check the pre-filled metadata and links.
4. Keep an existing URL/path if it should remain unchanged.
5. Clear a URL/path if the field should be removed.
6. On the GitHub issue page, drag a replacement file into the matching attachment section when replacing PDF, slide, poster, or code.
7. Submit the issue.

The `publication-edit` workflow treats the issue as the complete desired final record for that publication. `Original Publication ID` remains stable even if year, authors, or title changes. Attachments override matching URL fields and are copied into `assets/publications/<year>/<publication-id>/`.
