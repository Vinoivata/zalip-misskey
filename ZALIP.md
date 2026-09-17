# Zalip changes to Misskey

This repository is a fork of Misskey. Zalip extends the same application with a cinema
catalogue; it does not add another account system, session mechanism or social database.

## Implemented foundation

- `zalip_work` is the canonical cinema-title table in the existing Misskey PostgreSQL database.
- `zalip_library_entry` is keyed directly by Misskey `user.id`.
- `zalip_note_context` connects a title to an ordinary local Misskey root note, so replies,
  emoji reactions, moderation and notifications are native Misskey features.
- The client has native cinema home, title, library and administrator editor routes.

## TMDB import secret

The administrator-only `zalip/admin/works/import-tmdb` endpoint reads this deployment-only
environment variable:

```text
ZALIP_TMDB_API_KEY=...
```

Put it in the server secret environment used by the Misskey container. Do not commit it, add it
to a browser bundle, return it through an API response, or place it in a client-side URL. Without
the variable, the import endpoint returns a controlled configuration error and makes no external
request.

The current importer accepts a TMDB `movie` or `tv` ID, requests Russian details plus videos, and
creates only an unpublished draft. It does not create seasons/episodes or make the title visible.

## TMDB attribution

Before any TMDB-derived title is publicly visible, retain the native `/zalip/credits` page and
the credit link from the cinema home. It contains the required notice:

> This product uses the TMDB API but is not endorsed or certified by TMDB.

## Deployment and source availability

This fork is licensed AGPL-3.0-only as inherited from Misskey. Before this modified build is
deployed for network users, publish the corresponding source at a stable public URL and set the
in-product Source link to the exact deployed revision. Do not deploy the code merely because the
local build passes.
