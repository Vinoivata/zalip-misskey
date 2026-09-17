# Zalip changes to Misskey

This repository is a fork of Misskey. Zalip extends the same application with a cinema
catalogue; it does not add another account system, session mechanism or social database.

## Implemented foundation

- `zalip_work` is the canonical cinema-title table in the existing Misskey PostgreSQL database.
- `zalip_library_entry` is keyed directly by Misskey `user.id`.
- `zalip_note_context` connects a title to an ordinary local Misskey root note, so replies,
  emoji reactions, moderation and notifications are native Misskey features.
- `zalip_episode_note_context` does the same for an individual episode. An administrator opens a
  root thread once; thereafter users use standard Misskey replies and reactions in that thread.
- `zalip_season` and `zalip_episode` hold canonical season and episode metadata. They have no
  playback URL columns: availability is a separately authorised future integration.
- `zalip_release_event` records a newly discovered episode only after a published season has an
  existing episode-count baseline. The cinema home can therefore show genuine later arrivals
  without treating a first historical import as a release notification.
- `zalip_library_entry.isReleaseSubscribed` is the signed-in user's per-title follow preference.
  `/updates` uses it to display a personal release feed. It does not impersonate a system Bell
  notification; adding that delivery path requires an explicit full Misskey notification-type
  integration.
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
creates only an unpublished draft. For TV, it also stores the supplied season metadata. An
administrator can then run `zalip/admin/seasons/import-tmdb` for each chosen season; this upserts
validated episode metadata without deleting existing entries. The public title page requests an
opened season asynchronously, so switching seasons does not reload the page. Neither import makes
the title public automatically or creates a player.

## TMDB attribution

Before any TMDB-derived title is publicly visible, retain the native `/zalip/credits` page and
the credit link from the cinema home. It contains the required notice:

> This product uses the TMDB API but is not endorsed or certified by TMDB.

## Deployment and source availability

This fork is licensed AGPL-3.0-only as inherited from Misskey. Before this modified build is
deployed for network users, publish the corresponding source at a stable public URL and set the
in-product Source link to the exact deployed revision. Do not deploy the code merely because the
local build passes.
