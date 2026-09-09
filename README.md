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
- `assets/publications/` is reserved for future publication PDFs, posters, and slides.
- `assets/activities/` is reserved for recovered or newly added activity photos.
- `archive/manifests/` stores recovery and migration manifests.
- `archive/legacy-media/` is reserved for later migration of old `media/` assets from the website repository.
- `schemas/` and `scripts/` will hold content validation and migration tools.

## Path Policy

Content records should prefer repository-relative paths:

```json
"slides": "assets/seminars/2026/example-seminar/slides.pptx"
```

The website repository should resolve these paths through a configurable content base URL. Existing legacy `media/...` references may remain in `vie-group.github.io` until the legacy media migration is completed.

## Initial Scope

This first version seeds the content repository with:

- current `data/*.json`
- current workflow-localized seminar assets under `assets/seminars/`
- directory placeholders for future publications, activities, schemas, scripts, and workflows

The upload/update/delete workflows should eventually move here, while `vie-group.github.io` should become a presentation layer that consumes this repository.
