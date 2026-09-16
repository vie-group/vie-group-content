# Issue Templates

Content submission issue templates live here because this repository is the source of truth for website content.

The public website's `upload-seminar/` page opens pre-filled seminar issues in this repository.
The public website's `edit-seminar/` page opens pre-filled edit issues in this repository.
The public website's `edit-publication/` page opens pre-filled publication edit issues in this repository.
The public website's `edit-team/` page opens pre-filled team edit issues in this repository.

Content-changing issue workflows only process issues opened by `vie-group` organization members. External users and external collaborators are closed without changing data.

For seminar edits, keep `Original Seminar ID` unchanged. The optional URL fields are the complete final values: keep a URL to retain it, clear it to remove it, or drag a replacement file into the matching attachment box to replace it with a repository-local asset.
For publication edits, keep `Original Publication ID` unchanged. The optional URL fields are also the complete final values; attachments are copied into `assets/publications/`.
For team edits, `Operation` controls add/update/delete, and `Target Group` is the final status (`faculty`, `current`, or `alumni`). Website-generated batch edits include a JSON `Batch Changes` field and can update multiple existing records in one issue. Portrait attachments are copied into `assets/team/` for single-person edits.
