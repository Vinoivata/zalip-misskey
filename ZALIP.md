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
  without treating a first historical import as a release notification. A durable delivery marker
  prevents the same event from being sent twice after a successful notification pass.
- `zalip_library_entry.isReleaseSubscribed` is the signed-in user's per-title follow preference.
  `/updates` uses it to display a personal release feed. When a later catalogue sync discovers a
  new episode, the same preference also sends Misskey's native `zalipEpisodeReleased` notification:
  it appears in the Bell, can be disabled in notification settings, and produces a Web Push card
  for users who enabled browser notifications. Failed deliveries retain their marker and are retried
  during the next catalogue sync; migration marks pre-existing events as delivered so importing this
  feature never creates a historical notification flood.
- The title page writes a personal library entry through the signed-in Misskey user: status,
  favourite flag, 1–10 rating, watched-episode count and release subscription are all saved in the
  same entry. The library route shows those signals without a second profile or account.
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

Administrators can also correct the title, original title, description and release year through
the native Zalip editor. It is an explicit role-gated API operation; it does not change the TMDB
mapping, a provider mapping or publication state.

For a title without TMDB metadata, the same editor can create its seasons and episodes manually.
The first episode of a season establishes its baseline; a later episode added to an already
published title enters the same release-event outbox and subscriber-notification path as a TMDB
sync. Manual catalogue metadata still contains no player or provider URLs.

## TMDB attribution

Before any TMDB-derived title is publicly visible, retain the native `/zalip/credits` page and
the credit link from the cinema home. It contains the required notice:

> This product uses the TMDB API but is not endorsed or certified by TMDB.

## Deployment and source availability

This fork is licensed AGPL-3.0-only as inherited from Misskey. Before this modified build is
deployed for network users, publish the corresponding source at a stable public URL and set the
in-product Source link to the exact deployed revision. The public source repository is
[Vinoivata/zalip-misskey](https://github.com/Vinoivata/zalip-misskey). Do not deploy the code
merely because the local build passes.

The source repository contains application code and build instructions only. Deployment secrets,
database contents, user uploads, logs and server configuration remain outside Git. For each
deployment, record the deployed commit SHA in the release notes and set Misskey's
`repositoryUrl` instance setting to the repository URL above.
