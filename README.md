# Collaborative Notebook: Offline Sync Conflict

This is my submission for GDG on Campus SRM Recruitments 2026-27, Backend Task 2 ("Offline Sync Conflict, When Devices Disagree"). It's a NestJS and Supabase (PostgreSQL) API that syncs edits to a shared notebook from several devices. When two devices change the same thing on their own, the server doesn't overwrite anything. It merges what can safely live together and reports the rest as a conflict.

## Contents

1. [How synchronization works](#1-how-synchronization-works)
2. [How changes are tracked](#2-how-changes-are-tracked)
3. [How conflicts are detected](#3-how-conflicts-are-detected)
4. [Conflict-resolution strategy](#4-conflict-resolution-strategy)
5. [Conflicting and non-conflicting scenarios](#5-conflicting-and-non-conflicting-scenarios)
6. [Example API requests and responses](#6-example-api-requests-and-responses)
7. [Project structure](#7-project-structure)

---
Note- deployed on render https://collaborative-notebook.onrender.com/
## 1. How synchronization works

A notebook has a title and a list of subtitles (sections). Each subtitle has a `title` and `content`. Devices keep their own copy, maybe while offline, and sync it with the server later.

1. A device creates a notebook with `POST /documents`.
2. It keeps editing locally and remembers the values each edit started from.
3. When it reconnects, it sends `PUT /documents`. For every subtitle it touched, that request has the new values and the `base_*` values, plus the notebook `title` and `base_title`.
4. The server loads the current notebook and compares the incoming, base and current values field by field.
5. Changes that don't conflict get applied. Conflicting ones are left alone and reported, along with the values the client needs to resolve them.
6. If anything changed, the notebook and a history snapshot are saved together in one atomic database call.
7. The response lists what was `added`, `updated`, left `unchanged`, or put into `conflicts` / `documentConflicts`.

One request can have mixed results. Clean subtitles are saved while conflicting ones are reported in the same response, so valid work isn't thrown away.

Every write needs two headers:

| Header | Rule |
|---|---|
| `x-device-id` | Required, 1 to 64 characters. Says which device is sending the request. |
| `idempotency-key` | Required, a UUID the client generates. Makes retries safe. |

---

## 2. How changes are tracked

- **Per-subtitle `version`.** Starts at 1 and goes up by 1 each time that subtitle's title or content really changes.
- **Notebook `version`.** Goes up by 1 for every accepted save, however many subtitles changed in it.
- **Base values from the client.** `base_title`, `base_content` (and `base_version`) say what state each edit was made from. That's how the server tells a stale edit from a conflicting one.
- **Device attribution.** `last_modified_device_id` is stored on every subtitle, and conflict reports include `existingDeviceId` and `incomingDeviceId`.
- **Server-made versions and timestamps.** In the merge path the server generates them, so a device's clock can't affect ordering.
- **History.** Every accepted change writes a full snapshot to `document_versions` in the same transaction as the update. Version 1 is written when the notebook is created.

---

## 3. How conflicts are detected

For each field the server looks at three values:

```
incoming  = what this device wants to save
base      = what this device started from
current   = what the server holds right now
```

The check is a three-way comparison per field, applied to subtitle `title`, subtitle `content` and the notebook `title`:

```
clientChanged = incoming !== base      // did this device change the field?
serverChanged = current  !== base      // has anyone else changed it since?
```

| Client changed? | Server changed? | Result |
|---|---|---|
| No | any | Keep the server value. Nothing to apply. |
| Yes | No | **Accept** the client value. |
| Yes | Yes, same value | **Accept.** Both devices made the same edit. |
| Yes | Yes, different value | **Conflict.** The server value is kept and the conflict is reported. |

In practice that means:

- **Being out of date is not a conflict.** A device can be many versions behind. If nobody touched the fields it edited, its change merges. The decision is based on field values, not a version number.
- **Arrival order doesn't matter.** The comparison is against `base_*`, so changes arriving out of order give the same result.
- **Unknown subtitle ids are new subtitles** and get added with version 1.
- **Malformed edits are reported, not applied.** An existing subtitle sent without `base_title` / `base_content`, or with a `base_version` higher than the server's, shows up in `conflicts` with the reason `Missing base values for field-level merge` or `Invalid future base version`.

---

## 4. Conflict-resolution strategy

I went with a field-level three-way merge. Real conflicts are rejected and sent back to the client for a manual rebase, and the server never overwrites a newer accepted value.

Why I picked this:

- **It's predictable.** The same inputs give the same result whichever device syncs first.
- **No silent data loss.** The losing edit comes back in full (`baseValue`, `currentValue`, `incomingValue`) instead of being dropped.
- **Few false conflicts.** Judging each field on its own avoids flagging edits that don't overlap.

To resolve a conflict, the client:

1. Reads `currentValue` from the conflict entry. (`GET /documents/:id` returns the whole current notebook if it needs more.)
2. Decides which value to keep, or combines them.
3. Sends the change again with `base_*` set to the `currentValue` it received and `title` / `content` set to the chosen value.
4. Gets accepted, because the base now matches the server.

If the client just wants the server's value, it drops its local edit.

If one field of a subtitle merges and another conflicts, the merged field is saved and the conflicting field keeps the server value. That subtitle then shows up in both `updated` and `conflicts`. For the same reason, a sync that returns conflicts still comes back as `200`. Some of its changes may have been saved, so the body (`updated`, `conflicts`, `documentConflicts`) says what happened.

---

## 5. Conflicting and non-conflicting scenarios

Say a subtitle currently has `title = "Intro"` and `content = "v1"`, and both devices start from that state.

| # | Scenario | Outcome |
|---|---|---|
| A | Device 1 changes the **title**, then Device 2 (older state) changes the **content** | **Merged.** Both changes are kept. |
| B | Both devices change the **content** to different values | **Conflict** on `content`. The first accepted value stays and the second device gets the details. |
| C | Both devices change the **content** to the **same** value | **No conflict.** Shows up as `unchanged` for the second device. |
| D | A device sends a subtitle it didn't edit, with old base values | **Unchanged.** The newer server value is kept. |
| E | One request has a clean subtitle and a conflicting one | The clean one is **applied** and the conflicting one is **reported**. |
| F | A device sends a subtitle id the server doesn't know | **Added** with version 1. |
| G | The same request is sent twice with the same `idempotency-key` | The stored result is **replayed**. Nothing is applied twice. |
| H | Device 1 renames the notebook; Device 2 (old title) only edits a subtitle | **Merged.** Device 2 never touched the title, so there's nothing to conflict. |
| I | Both devices rename the notebook differently | **Title conflict** in `documentConflicts`. The server title is kept. |
| J | An existing subtitle is sent without `base_*` values, or with a future `base_version` | **Reported in `conflicts`** and not applied. |

---

## 6. Example API requests and responses

These are screenshots from Swagger UI (`http://localhost:3000/api`). One notebook (`27876e54-2ff3-4bd7-9878-29a434e5993d`) and one subtitle (`952f9fe8-f304-4a5b-a452-1ae4883dfcb8`) are used throughout. Most requests come from `laptop-01`, and the last two examples bring in `phone-01`. Those two images (Steps 9 and 10) are Swagger-style previews generated from the exact requests and expected responses, not live captures.

### Swagger overview

![Swagger UI overview](docs/screenshots/01-swagger.png)

![Swagger history endpoint](docs/screenshots/01-swagger-history.png)

![Swagger response documentation](docs/screenshots/01-swagger-responses-schemas.png)

![Swagger DTO schemas](docs/screenshots/01-swagger-schemas.png)

### Step 1: Create a notebook (`POST /documents` returns `201`)

The request, the curl command, and the response. The server generates the notebook id and the subtitle id and starts both versions at 1.

![Create request](docs/screenshots/02a-create-request.png)

![Create curl](docs/screenshots/02b-create-curl-and-201.png)

![Create response](docs/screenshots/02c-create-response.png)

### Step 2: Clean update (`PUT /documents` returns `200`)

The laptop renames the subtitle from `Intro` to `Overview`. The notebook goes to version 2.

![Rename headers](docs/screenshots/03a-rename-headers.png)

![Rename body](docs/screenshots/03b-rename-body.png)

![Rename curl](docs/screenshots/03c-rename-curl.png)

![Rename response](docs/screenshots/03d-rename-response.png)

### Step 3: Read the current notebook (`GET /documents/:documentId` returns `200`)

![Get request](docs/screenshots/04a-get-request.png)

![Get response](docs/screenshots/04b-get-response.png)

![Get headers and status codes](docs/screenshots/04c-get-headers.png)

### Step 4: Version history (`GET /documents/:documentId/versions` returns `200`)

Newest first. Version 2 has the renamed subtitle and version 1 still has the original `Intro`.

![History request](docs/screenshots/05a-history-request.png)

![History v2](docs/screenshots/05b-history-response-v2.png)

![History v1](docs/screenshots/05c-history-response-v1.png)

![History headers and status codes](docs/screenshots/05d-history-headers.png)

### Step 5: Change already applied (`PUT /documents` returns `200`, `No changes required`)

The Step 2 rename is sent again under a new `idempotency-key`. The subtitle is already `Overview`, so nothing is applied and the version stays at 2.

![No-change headers and body](docs/screenshots/06a-nochange-headers.png)

![No-change curl](docs/screenshots/06b-nochange-curl.png)

![No-change response](docs/screenshots/06c-nochange-response.png)

![No-change response end](docs/screenshots/06d-nochange-response-end.png)

### Step 6: Content edit with an outdated `base_version` (`PUT /documents` returns `200`)

The laptop sends `base_version: 1` while the subtitle is already at version 2, but its base values match the server, so the edit is accepted. The notebook goes to version 3.

![Update headers](docs/screenshots/07a-update-headers.png)

![Update body](docs/screenshots/07b-update-body.png)

![Update curl](docs/screenshots/07c-update-curl.png)

![Update response](docs/screenshots/07d-update-response.png)

![Update status codes](docs/screenshots/07e-update-status-codes.png)

### Step 7: Duplicate request replayed (`PUT /documents` returns `200`)

The Step 6 request is sent again with the same key and body. The server answers `Same request already processed` and nothing is applied twice.

![Replay headers](docs/screenshots/08a-replay-headers.png)

![Replay body and curl](docs/screenshots/08b-replay-body-curl.png)

![Replay response](docs/screenshots/08c-replay-response.png)

![Replay headers and status codes](docs/screenshots/08d-replay-headers-status.png)

### Step 8: Stale base returns a conflict (`PUT /documents` returns `200`)

The base value doesn't match what the server holds, so the server keeps its own value, reports a conflict and saves nothing. This run used one device, so both device ids in the conflict are `laptop-01`. The last screenshot is scrolled to the end of the response.

![Stale base headers](docs/screenshots/09a-stale-base-headers.png)

![Stale base body](docs/screenshots/09b-stale-base-body.png)

![Stale base curl](docs/screenshots/09c-stale-base-curl.png)

![Stale base response](docs/screenshots/09d-stale-base-response.png)

![Stale base headers and status codes](docs/screenshots/09e-stale-base-headers-status.png)

### Step 9: Two devices edit the same field (conflict with `phone-01`)

The phone starts from the original `Intro / v1` state while the laptop already has `Overview / v2 from laptop`. Both changed `content`, so the server returns a conflict instead of overwriting the laptop's value.

![Two-device conflict](docs/screenshots/10-two-device-conflict.png)

### Step 10: Two devices edit different fields (merge)

The phone changes the notebook title and leaves its subtitle values at their original base. The server applies the title change and keeps the laptop's subtitle edit.

![Two-device merge](docs/screenshots/11-two-device-merge.png)

---

## 7. Project structure

```
collaborative_notebook/
├── README.md
├── docs/
│   └── screenshots/              # Swagger screenshots used in section 6
├── src/
│   ├── main.ts                   # app bootstrap, validation pipe, Swagger setup
│   ├── app.module.ts
│   ├── database/                 # Supabase client
│   ├── document/
│   │   ├── document.controller.ts                  # POST/PUT/GET routes
│   │   ├── document.merge.service.ts               # three-way, field-level merge
│   │   ├── docomument.create.service.ts            # create a notebook
│   │   ├── document.currentVersion.service.ts      # get current notebook
│   │   ├── document.getDocumentVersions.service.ts # version history
│   │   └── document.module.ts
│   ├── dto/                      # request validation create and update
│   └── idempotency/              # idempotency-key handling and body hash
├── supabase/
│   └── migrations/               # tables and the atomic save function
├── Dockerfile
├── docker-compose.yml
├── package.json
└── .env.example
```
