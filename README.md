# Collaborative Notebook: Offline Sync Conflict

A backend that synchronizes edits to a shared notebook coming from multiple devices. When two devices change the same data independently, the server **detects the conflict instead of silently overwriting anything**, merges whatever can safely coexist, and tells the client exactly what happened.

Built for **GDG on Campus SRM Recruitments 2026-27, Backend Task 2: "Offline Sync Conflict, When Devices Disagree"**.

**Stack:** NestJS 12 (TypeScript, ESM) · Supabase (PostgreSQL) · class-validator · Swagger/OpenAPI · Docker

---

## Table of contents

1. [Screenshots](#1-screenshots)
2. [The idea in 30 seconds](#2-the-idea-in-30-seconds)
3. [Task requirements and where they are implemented](#3-task-requirements-and-where-they-are-implemented)
4. [Data model](#4-data-model)
5. [How synchronization works](#5-how-synchronization-works)
6. [How changes are tracked](#6-how-changes-are-tracked)
7. [How conflicts are detected](#7-how-conflicts-are-detected)
8. [Conflict-resolution strategy](#8-conflict-resolution-strategy)
9. [Conflicting and non-conflicting scenarios](#9-conflicting-and-non-conflicting-scenarios)
10. [Consistency and edge cases](#10-consistency-and-edge-cases)
11. [API reference](#11-api-reference)
12. [Example requests and responses](#12-example-requests-and-responses)
13. [Setup and running](#13-setup-and-running)
14. [Design decisions](#14-design-decisions)

---

## 1. Screenshots

All images are in [`docs/screenshots/`](docs/screenshots/). The Swagger overview images below were supplied from the running Swagger UI (`http://localhost:3000/api`). The two-device conflict/merge images are generated Swagger-style documentation previews based on the exact requests and expected responses in [`docs/swagger-steps.md`](docs/swagger-steps.md).

| Value | Used in this run |
|---|---|
| Notebook id | `27876e54-2ff3-4bd7-9878-29a434e5993d` |
| Subtitle id | `952f9fe8-f304-4a5b-a452-1ae4883dfcb8` |
| Primary run device | `laptop-01` (the two-device examples additionally use `phone-01`) |

### Step 0: Swagger UI

The API is exposed through Swagger/OpenAPI at `http://localhost:3000/api`.

![Swagger UI overview](docs/screenshots/01-swagger.png)

The history endpoint is documented with its required `documentId` path parameter:

![Swagger history endpoint](docs/screenshots/01-swagger-history.png)

Swagger also exposes the response/status-code documentation:

![Swagger response documentation](docs/screenshots/01-swagger-responses-schemas.png)

The generated DTO schemas show the create and update request shapes used by the API:

![Swagger DTO schemas](docs/screenshots/01-swagger-schemas.png)

### Step 1: Create a notebook (`POST /documents` returns `201`)

Request with `idempotency-key` and `x-device-id: laptop-01`:

![Create request](docs/screenshots/02a-create-request.png)

Curl and the start of the `201` response:

![Create curl](docs/screenshots/02b-create-curl-and-201.png)

Full response. The server generated the notebook id and the subtitle id, set both versions to `1` and stored `laptop-01` as the device:

![Create response](docs/screenshots/02c-create-response.png)

### Step 2: Clean update (`PUT /documents` returns `200`)

The laptop renames the subtitle `Intro` to `Overview`. Headers (new `idempotency-key`, same device):

![Rename headers](docs/screenshots/03a-rename-headers.png)

Body. `base_title: Intro` and `base_content: v1` tell the server which state the edit started from:

![Rename body](docs/screenshots/03b-rename-body.png)

Curl sent:

![Rename curl](docs/screenshots/03c-rename-curl.png)

Response: `Merge completed successfully`, `documentVersion` is `2`, the subtitle id is in `updated`, and both conflict lists are empty. The subtitle title is now `Overview` with subtitle `version` 2:

![Rename response](docs/screenshots/03d-rename-response.png)

### Step 3: Read the current notebook (`GET /documents/:documentId` returns `200`)

![Get request](docs/screenshots/04a-get-request.png)

The stored state matches the merge result: title `Overview`, notebook `version` 2:

![Get response](docs/screenshots/04b-get-response.png)

![Get headers and status codes](docs/screenshots/04c-get-headers.png)

### Step 4: Version history (`GET /documents/:documentId/versions` returns `200`)

![History request](docs/screenshots/05a-history-request.png)

`totalVersions` is `2`, newest first. Version 2 holds the renamed subtitle:

![History v2](docs/screenshots/05b-history-response-v2.png)

Version 1 still holds the original `Intro`, so nothing was lost by the update:

![History v1](docs/screenshots/05c-history-response-v1.png)

![History headers and status codes](docs/screenshots/05d-history-headers.png)

> The GET and history screenshots were taken right after Step 2, so they show notebook version 2. Steps 5 to 7 and the resolve and add examples in [section 12](#12-example-requests-and-responses) take the notebook to version 5.

### Step 5: Change already applied (`PUT /documents` returns `200`, `No changes required`)

The laptop sends the Step 2 rename again under a **new** `idempotency-key`, as a client would after losing the first response. The server compares values, sees the subtitle is already `Overview`, and applies nothing: the id is listed under `unchanged` and `documentVersion` stays `2`.

![No-change headers and body](docs/screenshots/06a-nochange-headers.png)

![No-change curl](docs/screenshots/06b-nochange-curl.png)

![No-change response](docs/screenshots/06c-nochange-response.png)

![No-change response end](docs/screenshots/06d-nochange-response-end.png)

### Step 6: Content edit with an outdated `base_version` (`PUT /documents` returns `200`)

The laptop edits the subtitle content to `v2 from laptop`. It sends `base_version: 1` while the subtitle is already at version 2, but its `base_title` and `base_content` match what the server holds, so the edit is accepted. Being out of date is not a conflict; only differing values are. Result: `documentVersion` `3`, subtitle `version` `3`, content `v2 from laptop`.

![Update headers](docs/screenshots/07a-update-headers.png)

![Update body](docs/screenshots/07b-update-body.png)

![Update curl](docs/screenshots/07c-update-curl.png)

![Update response](docs/screenshots/07d-update-response.png)

![Update status codes](docs/screenshots/07e-update-status-codes.png)

### Step 7: Duplicate request replayed (`PUT /documents` returns `200`)

The Step 6 request is sent again with the **same** `idempotency-key` and the same body. The response is `Same request already processed`, the original response is returned inside `data`, and the notebook stays at version 3. Nothing is applied twice.

![Replay headers](docs/screenshots/08a-replay-headers.png)

![Replay body and curl](docs/screenshots/08b-replay-body-curl.png)

![Replay response](docs/screenshots/08c-replay-response.png)

![Replay headers and status codes](docs/screenshots/08d-replay-headers-status.png)

### Step 8: Stale base returns a conflict (`PUT /documents` returns `200`)

The laptop sends content `v2 from phone + v2 from laptop` with `base_content: v2 from phone`, but the server holds `v2 from laptop`. Incoming, base and current all differ, so the server keeps its own value, reports a conflict and saves nothing: the stored content is still `v2 from laptop`, `updated_at` is unchanged and the notebook is still at version 3. This run used a single device, so `existingDeviceId` and `incomingDeviceId` are both `laptop-01`. (`v2 from phone` is a base this notebook never held; the normal resolve flow in [section 12.5](#125-resolving-the-conflict) uses the server's `currentValue` as the base.)

![Stale base headers](docs/screenshots/09a-stale-base-headers.png)

![Stale base body](docs/screenshots/09b-stale-base-body.png)

![Stale base curl](docs/screenshots/09c-stale-base-curl.png)

The screenshot below is scrolled to the end of the response: the conflict entry's device ids, an empty `documentConflicts`, and the unchanged stored notebook.

![Stale base response](docs/screenshots/09d-stale-base-response.png)

![Stale base headers and status codes](docs/screenshots/09e-stale-base-headers-status.png)

> Steps 3 and 4 were captured right after Step 2, so they show notebook version 2. Steps 6 to 8 then move the notebook to version 3.

### Step 9: Two devices edit the same field (conflict with `phone-01`)

The phone starts from the original `Intro / v1` state while the laptop already holds `Overview / v2 from laptop`. Both devices changed the same `content` field, so the server returns the three-way conflict instead of overwriting the laptop value.

![Two-device conflict](docs/screenshots/10-two-device-conflict.png)



### Step 10: Two devices edit different fields (merge)

The phone changes the notebook title while its subtitle values remain at their original base. The server applies the title change while preserving the laptop's subtitle edit.

![Two-device merge](docs/screenshots/11-two-device-merge.png)



---

## 2. The idea in 30 seconds

A notebook has a title and a set of subtitles (sections). Each subtitle has a `title` and `content`.

Every time a device syncs, it sends two things for each subtitle it touched: **what it changed to**, and **what it started from** (`base_title`, `base_content`). The server compares three values for each field:

```
incoming  = what this device wants to save
base      = what this device started from
current   = what the server holds right now
```

- If nobody else changed the field since `base`, the change is **accepted**.
- If someone else changed it to the same value, there is nothing to resolve, so it is **accepted**.
- If someone else changed it to a different value, it is a **conflict**: the server keeps its value and returns all three values to the client.

Fields are judged one at a time, so two devices editing *different* fields of the same subtitle are merged without any conflict.

---

## 3. Task requirements and where they are implemented

| Task requirement | Implementation |
|---|---|
| **1. Data management:** create/modify from multiple devices, keep current state, tell devices apart | `POST /documents`, `PUT /documents`, `GET /documents/:id`. Every request carries `x-device-id`, stored as `last_modified_device_id` on each subtitle it changes. |
| **2. Change tracking:** request says which state it started from, server spots outdated devices | Each edited subtitle sends `base_version`, `base_title`, `base_content`. The notebook title is tracked with `base_title`. |
| **3. Conflict detection:** conflicts found, outdated change never overwrites a newer one, safe vs unsafe changes distinguished | Three-way, field-level comparison for subtitle title, subtitle content and the notebook title ([section 7](#7-how-conflicts-are-detected)). |
| **4. Conflict resolution:** clear, consistent strategy | Field-level merge. True conflicts are rejected and returned for the client to rebase ([section 8](#8-conflict-resolution-strategy)). |
| **5. Non-conflicting changes:** do not over-report, preserve valid changes | Different fields merge. Identical edits are not conflicts. A stale device still merges if nobody touched its fields. |
| **6. Synchronization results:** client can tell what happened | Response lists `added`, `updated`, `unchanged`, `conflicts`, `documentConflicts` plus a `message`. |
| **7. Consistency and edge cases** | Idempotency keys, atomic save with an expected-version check, value-based merging ([section 10](#10-consistency-and-edge-cases)). |
| **8. Validation and API behaviour** | Global validation pipe, header checks, `400`/`404`/`409`/`500` mapping, validation before any write. |
| **9. Documentation** | This README and Swagger UI at `/api`. |
| **Bonus** | Field-level merge ✔ · Version history ✔ · View previous versions ✔ (list) · Swagger/OpenAPI ✔ · Docker ✔ |

---

## 4. Data model

| Table | Purpose |
|---|---|
| `documents` | Current state of each notebook: `id`, `title`, `subtitles` (JSONB object keyed by subtitle id), `version`, `device_id`, `created_at`, `updated_at` |
| `document_versions` | One immutable snapshot for every accepted change, unique per (`document_id`, `version_number`) |
| `sync_requests` | Idempotency log: `request_id`, `request_hash`, `status`, stored `response`, `device_id`, `document_id` |

A stored subtitle looks like this:

```json
{
  "id": "952f9fe8-f304-4a5b-a452-1ae4883dfcb8",
  "title": "Intro",
  "content": "v1",
  "version": 1,
  "created_at": "2026-10-03T13:26:23.013Z",
  "updated_at": "2026-10-03T13:26:23.013Z",
  "last_modified_device_id": "laptop-01"
}
```

The schema is in `supabase/migrations/`, including the `update_document_with_history` function used for atomic saves.

---

## 5. How synchronization works

1. A device creates a notebook with `POST /documents`.
2. The device keeps editing locally, possibly offline, and remembers the values each edit started from.
3. On reconnect it sends `PUT /documents` with, for every subtitle it touched, the new values and the `base_*` values, plus the notebook `title` and `base_title`.
4. The server loads the current notebook and compares incoming, base and current values field by field.
5. Non-conflicting changes are applied. Conflicting changes are left alone and reported with the values needed to resolve them.
6. If anything changed, the notebook and a history snapshot are saved in **one atomic database call**.
7. The response says what was `added`, `updated`, left `unchanged`, or put in `conflicts` / `documentConflicts`.

A single request can have mixed outcomes. Clean subtitles are saved while conflicting ones are reported in the same response, so valid work is never thrown away.

Every write needs two headers:

| Header | Rule |
|---|---|
| `x-device-id` | Required, 1 to 64 characters. Identifies the device. |
| `idempotency-key` | Required, a UUID generated by the client. Makes retries safe. |

---

## 6. How changes are tracked

- **Per-subtitle `version`:** starts at 1 and goes up by 1 whenever that subtitle's title or content actually changes.
- **Notebook `version`:** goes up by 1 for every accepted save, no matter how many subtitles changed in it.
- **Base values from the client:** `base_title` and `base_content` (and `base_version`) say what state each edit was made from. This is what lets the server tell a *stale* edit from a *conflicting* one.
- **Device attribution:** `last_modified_device_id` is stored on every subtitle, and conflict reports include `existingDeviceId` and `incomingDeviceId`.
- **Server-controlled versions and timestamps:** in the merge path they are generated by the server, so a device's clock can never affect ordering.
- **History:** every accepted change writes a full snapshot to `document_versions`, in the same transaction as the update. Version 1 is written when the notebook is created.

---

## 7. How conflicts are detected

Detection is a **three-way comparison per field**, applied to subtitle `title`, subtitle `content` and the notebook `title`:

```
clientChanged = incoming !== base      // did this device change the field?
serverChanged = current  !== base      // has anyone else changed it since?
```

| Client changed? | Server changed? | Result |
|---|---|---|
| No | any | Keep the server value. Nothing to apply. |
| Yes | No | **Accept** the client value. |
| Yes | Yes, and the values are identical | **Accept.** Both devices made the same edit. |
| Yes | Yes, and the values differ | **Conflict.** Server value is kept and the conflict is reported. |

What this means in practice:

- **Being out of date is not a conflict.** A device may be many versions behind. If nobody touched the fields it edited, its change merges. The decision depends on the field values, not on a version number.
- **Order of arrival does not matter.** Because the decision compares values against `base_*`, changes arriving out of order give the same result.
- **Unknown subtitle ids are new subtitles** and are added with version 1.
- **Malformed edits are reported, not applied.** An existing subtitle sent without `base_title`/`base_content`, or with a `base_version` higher than the server's, is listed in `conflicts` with the reason `Missing base values for field-level merge` or `Invalid future base version`.

---

## 8. Conflict-resolution strategy

**Field-level three-way merge. True conflicts are rejected and returned to the client for a manual rebase. The server never overwrites a newer accepted value.**

Why this strategy:

- **Predictable:** the same inputs give the same result no matter which device syncs first.
- **No silent data loss:** the losing edit is returned in full (`baseValue`, `currentValue`, `incomingValue`), never dropped.
- **Few false conflicts:** judging each field separately avoids flagging edits that do not overlap.

**Resolving a conflict:**

1. The client reads `currentValue` from the conflict entry. (`GET /documents/:id` returns the whole current notebook if it needs more.)
2. It decides which value to keep, or combines them.
3. It re-sends the change with `base_*` set to the `currentValue` it received and `title` / `content` set to the chosen value.
4. The base now matches the server, so the second request is accepted.

To simply accept the server's value, the client discards its local edit.

**Partial application:** when one field of a subtitle merges and another conflicts, the merged field is saved and the conflicting field keeps the server value. That subtitle then appears in both `updated` and `conflicts`.

---

## 9. Conflicting and non-conflicting scenarios

Assume a subtitle currently has `title = "Intro"`, `content = "v1"`, and both devices start from that state.

| # | Scenario | Outcome |
|---|---|---|
| A | Device 1 changes the **title**, then Device 2 (older state) changes the **content** | **Merged.** Both changes kept. |
| B | Both devices change the **content** to different values | **Conflict** on `content`. First accepted value stays; second device gets the details. |
| C | Both devices change the **content** to the **same** value | **No conflict.** Reported as `unchanged` for the second device. |
| D | A device sends a subtitle it did not edit, with old base values | **Unchanged.** The newer server value is preserved. |
| E | One request has a clean subtitle and a conflicting one | The clean one is **applied**, the conflicting one is **reported**. |
| F | A device sends a subtitle id the server does not know | **Added** with version 1. |
| G | The same request is sent twice with the same `idempotency-key` | Stored result is **replayed**. Nothing is applied twice. |
| H | Device 1 renames the notebook; Device 2 (old title) only edits a subtitle | **Merged.** Device 2 did not touch the title, so there is nothing to conflict. |
| I | Both devices rename the notebook differently | **Title conflict** in `documentConflicts`; server title is kept. |
| J | An existing subtitle is sent without `base_*` values, or with a future `base_version` | **Reported in `conflicts`**, not applied. |

---

## 10. Consistency and edge cases

| Situation | How it is handled |
|---|---|
| **Requests arriving close together** | The save checks the notebook version it was based on, inside the database function. If another request saved first, the database refuses with error `40001` and the API returns **409** asking the client to fetch the latest state and retry. Two simultaneous saves never both win. |
| **Changes arriving out of order** | Decisions compare values against `base_*`, not arrival time, so order does not change the outcome. |
| **Same request sent more than once** | The `idempotency-key` and a SHA-256 hash of the body are stored. Same key and same body replays the saved response with no second write. Same key with a different body returns **409**. |
| **Duplicate request still running** | A unique constraint on `request_id` stops two copies running together. The second gets **409**. |
| **Device updating outdated data** | Fields nobody else touched merge. Overlapping fields are reported as conflicts. |
| **Two devices modifying the same data** | Different fields merge. The same field with different values is a conflict. |
| **Newer change accidentally overwritten** | Never for subtitle title, subtitle content or the notebook title: a value is only written when the incoming change is non-conflicting. |
| **Invalid input** | Rejected by validation before any write. Unknown fields are rejected too. |
| **Atomicity** | The notebook update and its history snapshot happen in one database call, so both succeed or neither does. |

---

## 11. API reference

Interactive docs (Swagger UI): `http://localhost:3000/api`

| Method | Path | Required headers | Purpose |
|---|---|---|---|
| `POST` | `/documents` | `idempotency-key`, `x-device-id` | Create a notebook with its initial subtitles |
| `PUT` | `/documents` | `idempotency-key`, `x-device-id` | Sync a device's edits into an existing notebook |
| `GET` | `/documents/:documentId` | none | Get the current notebook |
| `GET` | `/documents/:documentId/versions` | none | List all history snapshots, newest first |

**Status codes**

| Code | Meaning |
|---|---|
| `200` | `PUT`/`GET` processed. For `PUT`, always read `conflicts` and `documentConflicts`: a `200` does not mean every change was applied. |
| `201` | Notebook created |
| `400` | Invalid body, invalid UUID, invalid `idempotency-key`, or missing/invalid `x-device-id` |
| `404` | Notebook not found |
| `409` | Idempotency key reused with a different body, request still in progress, or notebook modified concurrently |
| `500` | Database or unexpected error |

**`POST /documents` body**

| Field | Type | Notes |
|---|---|---|
| `title` | string | Required, non-empty |
| `subtitles[]` | array | Required (may be empty) |
| `subtitles[].title` | string | Required, non-empty |
| `subtitles[].content` | string | Required |

The server generates the notebook id and the subtitle ids. Read them from the response.

**`PUT /documents` body**

| Field | Type | Notes |
|---|---|---|
| `uuid` | UUID | Notebook being updated |
| `title` | string | Notebook title after the edit (required, non-empty) |
| `base_title` | string | Notebook title this edit started from (required, non-empty) |
| `version` | integer ≥ 1 | Notebook version the client last saw. Required and validated; conflicts are decided by field values and the atomic save, not by this number. |
| `subtitles[]` | array | One entry per subtitle the device touched |
| `subtitles[].id` | UUID | Subtitle id. An unknown id creates a new subtitle. |
| `subtitles[].title`, `.content` | string | Values after the edit (`title` non-empty) |
| `subtitles[].base_version` | integer ≥ 1 | Subtitle version the edit started from |
| `subtitles[].base_title`, `.base_content` | string | Values the edit started from. **Required for an existing subtitle.** |

**`PUT /documents` response**

| Field | Meaning |
|---|---|
| `message` | `Merge completed successfully`, `Merge completed with unresolved conflicts`, or `No changes required` |
| `documentId`, `documentVersion`, `deviceId` | Identity and the notebook version after the request (the unchanged version when nothing was saved) |
| `added` | Ids of subtitles created by this request |
| `updated` | Ids of subtitles changed, fully or partly |
| `unchanged` | Ids with nothing to apply |
| `conflicts` | Subtitle conflicts: `subtitleId`, `reason`, `currentVersion`, `baseVersion`, `fields[]` (`field`, `baseValue`, `currentValue`, `incomingValue`), `existingDeviceId`, `incomingDeviceId` |
| `documentConflicts` | Notebook-title conflict, if any: `field`, `baseValue`, `currentValue`, `incomingValue` |
| `data` | The stored notebook after the request |

**How a client reads the result**

| Outcome | What the response looks like |
|---|---|
| Change accepted | `updated` / `added` filled, both conflict lists empty |
| Changes merged | `updated` filled and the stored notebook contains edits from both devices |
| Conflict requiring resolution | `conflicts` or `documentConflicts` not empty, message says `unresolved conflicts` |
| Nothing to do | `No changes required` |
| Change rejected | `400` (invalid), `404` (unknown notebook), `409` (replay mismatch or concurrent change) |

---

## 12. Example requests and responses

Examples 12.1 to 12.5 and 12.7 follow one notebook. The ids and timestamps are from a real run (see [section 1](#1-screenshots)); 12.1, 12.2, 12.9 and 12.11 are captured responses. Replace `localhost:3000` and the ids with your own. The `data` field is shortened for readability.

Set these once:

```bash
BASE=http://localhost:3000
J='Content-Type: application/json'
```

### 12.1 Create a notebook

```bash
curl -i -X POST $BASE/documents \
  -H "$J" \
  -H "idempotency-key: 11111111-1111-4111-8111-111111111111" \
  -H "x-device-id: laptop-01" \
  -d '{
    "title": "Project Notes",
    "subtitles": [ { "title": "Intro", "content": "v1" } ]
  }'
```

Response `201`:

```json
{
  "id": "27876e54-2ff3-4bd7-9878-29a434e5993d",
  "title": "Project Notes",
  "subtitles": {
    "952f9fe8-f304-4a5b-a452-1ae4883dfcb8": {
      "id": "952f9fe8-f304-4a5b-a452-1ae4883dfcb8",
      "title": "Intro",
      "content": "v1",
      "version": 1,
      "created_at": "2026-10-03T13:26:23.013Z",
      "updated_at": "2026-10-03T13:26:23.013Z",
      "last_modified_device_id": "laptop-01"
    }
  },
  "created_at": "2026-10-03T13:26:23.013+00:00",
  "updated_at": "2026-10-03T13:26:23.013+00:00",
  "version": 1,
  "user_id": null,
  "device_id": "laptop-01"
}
```

Keep the notebook `id` and the subtitle id for the next requests:

```bash
DOC=27876e54-2ff3-4bd7-9878-29a434e5993d
SUB=952f9fe8-f304-4a5b-a452-1ae4883dfcb8
```

### 12.2 Clean update (accepted)

The laptop renames the subtitle:

```bash
curl -i -X PUT $BASE/documents \
  -H "$J" \
  -H "idempotency-key: 22222222-2222-4222-8222-222222222222" \
  -H "x-device-id: laptop-01" \
  -d '{
    "uuid": "'$DOC'",
    "title": "Project Notes",
    "base_title": "Project Notes",
    "version": 1,
    "subtitles": [{
      "id": "'$SUB'",
      "title": "Overview", "content": "v1",
      "base_title": "Intro", "base_content": "v1", "base_version": 1
    }]
  }'
```

Response `200`:

```json
{
  "message": "Merge completed successfully",
  "documentId": "27876e54-2ff3-4bd7-9878-29a434e5993d",
  "documentVersion": 2,
  "deviceId": "laptop-01",
  "added": [],
  "updated": ["952f9fe8-f304-4a5b-a452-1ae4883dfcb8"],
  "unchanged": [],
  "conflicts": [],
  "documentConflicts": [],
  "data": {
    "id": "27876e54-2ff3-4bd7-9878-29a434e5993d",
    "title": "Project Notes",
    "user_id": null,
    "version": 2,
    "device_id": "laptop-01",
    "subtitles": {
      "952f9fe8-f304-4a5b-a452-1ae4883dfcb8": {
        "id": "952f9fe8-f304-4a5b-a452-1ae4883dfcb8",
        "title": "Overview",
        "content": "v1",
        "version": 2,
        "created_at": "2026-10-03T13:26:23.013Z",
        "updated_at": "2026-10-03T13:34:12.982Z",
        "last_modified_device_id": "laptop-01"
      }
    }
  }
}
```

Screenshots: [request](docs/screenshots/03b-rename-body.png), [response](docs/screenshots/03d-rename-response.png).

### 12.3 Non-conflicting merge (scenario A)

The phone is still on the original state (`base_title: "Intro"`, `base_version: 1`) and edits only the **content**:

```bash
curl -i -X PUT $BASE/documents \
  -H "$J" \
  -H "idempotency-key: 33333333-3333-4333-8333-333333333333" \
  -H "x-device-id: phone-01" \
  -d '{
    "uuid": "'$DOC'",
    "title": "Project Notes",
    "base_title": "Project Notes",
    "version": 1,
    "subtitles": [{
      "id": "'$SUB'",
      "title": "Intro", "content": "v2 from phone",
      "base_title": "Intro", "base_content": "v1", "base_version": 1
    }]
  }'
```

Response `200`. The laptop's rename is **kept** and the phone's content is **added**:

```json
{
  "message": "Merge completed successfully",
  "documentId": "27876e54-2ff3-4bd7-9878-29a434e5993d",
  "documentVersion": 3,
  "deviceId": "phone-01",
  "added": [],
  "updated": ["952f9fe8-f304-4a5b-a452-1ae4883dfcb8"],
  "unchanged": [],
  "conflicts": [],
  "documentConflicts": [],
  "data": {
    "id": "27876e54-2ff3-4bd7-9878-29a434e5993d",
    "title": "Project Notes",
    "version": 3,
    "subtitles": {
      "952f9fe8-f304-4a5b-a452-1ae4883dfcb8": {
        "id": "952f9fe8-f304-4a5b-a452-1ae4883dfcb8",
        "title": "Overview",
        "content": "v2 from phone",
        "version": 3,
        "last_modified_device_id": "phone-01"
      }
    }
  }
}
```

### 12.4 Conflict (scenario B)

The laptop, still on the original state, edits the same **content** field differently:

```bash
curl -i -X PUT $BASE/documents \
  -H "$J" \
  -H "idempotency-key: 44444444-4444-4444-8444-444444444444" \
  -H "x-device-id: laptop-01" \
  -d '{
    "uuid": "'$DOC'",
    "title": "Project Notes",
    "base_title": "Project Notes",
    "version": 1,
    "subtitles": [{
      "id": "'$SUB'",
      "title": "Intro", "content": "v2 from laptop",
      "base_title": "Intro", "base_content": "v1", "base_version": 1
    }]
  }'
```

Response `200`. Nothing is overwritten; the conflict carries all three values:

```json
{
  "message": "Merge completed with unresolved conflicts",
  "documentId": "27876e54-2ff3-4bd7-9878-29a434e5993d",
  "documentVersion": 3,
  "deviceId": "laptop-01",
  "added": [],
  "updated": [],
  "unchanged": [],
  "conflicts": [
    {
      "subtitleId": "952f9fe8-f304-4a5b-a452-1ae4883dfcb8",
      "reason": "Concurrent edits to the same field",
      "currentVersion": 3,
      "baseVersion": 1,
      "fields": [
        {
          "field": "content",
          "baseValue": "v1",
          "currentValue": "v2 from phone",
          "incomingValue": "v2 from laptop"
        }
      ],
      "existingDeviceId": "phone-01",
      "incomingDeviceId": "laptop-01"
    }
  ],
  "documentConflicts": [],
  "data": { "...": "the unchanged stored notebook" }
}
```

### 12.5 Resolving the conflict

The laptop combines both versions and re-sends with the base set to the server's `currentValue` and `currentVersion`:

```bash
curl -i -X PUT $BASE/documents \
  -H "$J" \
  -H "idempotency-key: 55555555-5555-4555-8555-555555555555" \
  -H "x-device-id: laptop-01" \
  -d '{
    "uuid": "'$DOC'",
    "title": "Project Notes",
    "base_title": "Project Notes",
    "version": 3,
    "subtitles": [{
      "id": "'$SUB'",
      "title": "Overview", "content": "v2 from phone + v2 from laptop",
      "base_title": "Overview", "base_content": "v2 from phone", "base_version": 3
    }]
  }'
```

This is accepted (`updated` contains the subtitle, `documentVersion` becomes 4), because the base now matches the server.

### 12.6 Notebook title conflict (scenario I)

Independent example: the server's notebook title is now `Team Notes`, set earlier by another device. A phone that last saw `Project Notes` renames it to `Sprint Notes`:

```json
{
  "message": "Merge completed with unresolved conflicts",
  "conflicts": [],
  "documentConflicts": [
    {
      "field": "title",
      "baseValue": "Project Notes",
      "currentValue": "Team Notes",
      "incomingValue": "Sprint Notes"
    }
  ]
}
```

(`documentId`, `documentVersion`, `added`, `updated`, `unchanged` and `data` are included as in the other responses.) The stored title stays `Team Notes`. Subtitle edits in the same request are still applied.

### 12.7 Adding a new subtitle (scenario F)

Use a fresh UUID for the new subtitle. Because the server does not know it, it is added with version 1:

```bash
curl -i -X PUT $BASE/documents \
  -H "$J" \
  -H "idempotency-key: 66666666-6666-4666-8666-666666666666" \
  -H "x-device-id: phone-01" \
  -d '{
    "uuid": "'$DOC'",
    "title": "Project Notes",
    "base_title": "Project Notes",
    "version": 4,
    "subtitles": [{
      "id": "9b2f6a40-3c1d-4e8a-9f27-0a1b2c3d4e5f",
      "title": "Todo", "content": "ship it", "base_version": 1
    }]
  }'
```

The response lists the new id under `"added"`.

### 12.8 Duplicate request (scenario G)

Send any earlier request again with the **same** `idempotency-key` and **same** body. Nothing is applied twice and the stored response is returned:

```json
{
  "message": "Same request already processed",
  "data": {
    "message": "Merge completed successfully",
    "documentVersion": 2,
    "...": "the original response, unchanged"
  }
}
```

The **same key with a different body** is refused with `409`:

```json
{
  "message": "Idempotency key reused with a different request body",
  "error": "Conflict",
  "statusCode": 409
}
```

### 12.9 Current notebook and version history

```bash
curl $BASE/documents/$DOC
curl $BASE/documents/$DOC/versions
```

Real output after 12.1 and 12.2 (the notebook is at version 2). `GET /documents/:documentId` returns `200`:

```json
{
  "message": "Current document version retrieved successfully",
  "document": {
    "id": "27876e54-2ff3-4bd7-9878-29a434e5993d",
    "title": "Project Notes",
    "subtitles": {
      "952f9fe8-f304-4a5b-a452-1ae4883dfcb8": {
        "id": "952f9fe8-f304-4a5b-a452-1ae4883dfcb8",
        "title": "Overview",
        "content": "v1",
        "version": 2,
        "created_at": "2026-10-03T13:26:23.013Z",
        "updated_at": "2026-10-03T13:34:12.982Z",
        "last_modified_device_id": "laptop-01"
      }
    },
    "created_at": "2026-10-03T13:26:23.013+00:00",
    "updated_at": "2026-10-03T13:34:12.982+00:00",
    "version": 2,
    "user_id": null,
    "device_id": "laptop-01"
  }
}
```

`GET /documents/:documentId/versions` returns `200`, newest first. Version 1 keeps the original `Intro`:

```json
{
  "message": "Document versions retrieved successfully",
  "documentId": "27876e54-2ff3-4bd7-9878-29a434e5993d",
  "totalVersions": 2,
  "versions": [
    {
      "id": "a263ded3-edac-4954-91e6-7ce7ef574d71",
      "document_id": "27876e54-2ff3-4bd7-9878-29a434e5993d",
      "version_number": 2,
      "title": "Project Notes",
      "subtitles": {
        "952f9fe8-f304-4a5b-a452-1ae4883dfcb8": { "title": "Overview", "content": "v1", "version": 2, "last_modified_device_id": "laptop-01", "...": "..." }
      },
      "created_at": "2026-10-03T13:34:12.529778+00:00",
      "device_id": null
    },
    {
      "id": "f96bb4b4-683f-428e-8b26-721747995273",
      "document_id": "27876e54-2ff3-4bd7-9878-29a434e5993d",
      "version_number": 1,
      "title": "Project Notes",
      "subtitles": {
        "952f9fe8-f304-4a5b-a452-1ae4883dfcb8": { "title": "Intro", "content": "v1", "version": 1, "last_modified_device_id": "laptop-01", "...": "..." }
      },
      "created_at": "2026-10-03T13:26:22.962757+00:00",
      "device_id": "laptop-01"
    }
  ]
}
```

Two things to notice: the snapshot written by the update has `"device_id": null` (listed in [section 15](#15-known-limitations); the subtitle inside it still records `laptop-01`), and after the whole walkthrough 12.1 to 12.7 `totalVersions` is 5. Screenshots: [get](docs/screenshots/04b-get-response.png), [history](docs/screenshots/05b-history-response-v2.png).

### 12.10 Error responses

| Request | Response |
|---|---|
| Missing or non-UUID `idempotency-key` | `400` `A valid UUID is required in the idempotency-key header` |
| Missing `x-device-id` | `400` `x-device-id header is required` |
| `x-device-id` longer than 64 characters | `400` `x-device-id must be between 1 and 64 characters` |
| Unknown field, missing field or wrong type in the body | `400` with a list of validation messages |
| `PUT` for a notebook that does not exist | `404` `Notebook <id> was not found` |
| `GET` for a notebook that does not exist | `404` `Document <id> not found` |
| Two saves race on the same notebook | `409` `Document was modified by another request. Fetch the latest version and retry.` |

All errors use the standard shape `{ "message": ..., "error": ..., "statusCode": ... }`.

### 12.11 Captured: change already applied

The Step 2 rename sent again under a new `idempotency-key` (real response, `200`). Nothing is written and the version does not move:

```json
{
  "message": "No changes required",
  "documentId": "27876e54-2ff3-4bd7-9878-29a434e5993d",
  "documentVersion": 2,
  "deviceId": "laptop-01",
  "added": [],
  "updated": [],
  "unchanged": ["952f9fe8-f304-4a5b-a452-1ae4883dfcb8"],
  "conflicts": [],
  "documentConflicts": [],
  "data": {
    "id": "27876e54-2ff3-4bd7-9878-29a434e5993d",
    "title": "Project Notes",
    "subtitles": {
      "952f9fe8-f304-4a5b-a452-1ae4883dfcb8": {
        "id": "952f9fe8-f304-4a5b-a452-1ae4883dfcb8",
        "title": "Overview",
        "content": "v1",
        "version": 2,
        "created_at": "2026-10-03T13:26:23.013Z",
        "updated_at": "2026-10-03T13:34:12.982Z",
        "last_modified_device_id": "laptop-01"
      }
    },
    "created_at": "2026-10-03T13:26:23.013+00:00",
    "updated_at": "2026-10-03T13:34:12.982+00:00",
    "version": 2,
    "user_id": null,
    "device_id": "laptop-01"
  }
}
```

Screenshots: [request](docs/screenshots/06a-nochange-headers.png), [response](docs/screenshots/06c-nochange-response.png). The replay of a content edit (12.8) is captured in [08c-replay-response.png](docs/screenshots/08c-replay-response.png).

---

## 13. Setup and running

**Prerequisites:** Node.js 22.22.3 or newer, and a Supabase project (or local Supabase through the CLI). Docker is optional.

```bash
# 1. Install dependencies
npm install

# 2. Configure the environment
cp ".env example" .env
#    then edit .env:
#      SUPABASE_URL=https://<your-project>.supabase.co
#      SUPABASE_SECRET_KEY=<your Supabase secret / service role key>
#      PORT=3000
#    ADMIN_SECRET is present in the example file but is not used yet.

# 3. Create the database objects (tables, constraints, update_document_with_history)
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
#    Alternatively run the files in supabase/migrations/ in order in the Supabase SQL editor.

# 4. Start the server
npm run start:dev
```

Then open Swagger UI at `http://localhost:3000/api`, or use the curl commands in [section 12](#12-example-requests-and-responses).

**With Docker**

```bash
docker compose up --build
```

The container reads `.env` and serves on port 3000.

**Useful scripts:** `npm run build`, `npm run start:prod`, `npm run lint`, `npm run format`.

> The server connects to Supabase with the secret key, so keep `.env` private and never commit it.

---

## 14. Design decisions

- **Three-way merge instead of "last write wins" or version-number-only checks.** A version number says that something changed, not what. Sending the starting values lets the server decide field by field and avoids flagging edits that do not overlap.
- **Reject and rebase instead of auto-picking a winner.** Auto-resolving (for example "newest timestamp wins") would silently discard someone's work and depends on device clocks. Returning the three values keeps every edit and lets the client choose.
- **Server decides, client only describes.** Versions and timestamps in the merge path are created by the server, never trusted from the device.
- **Atomic save in the database.** One function updates the notebook, checks the expected version and writes the history snapshot. This is what makes two simultaneous requests safe, and it keeps history and state in step.
- **Subtitles as one JSONB object per notebook.** A notebook and all its subtitles change in one row update, which keeps the atomic save simple. The trade-off is that individual subtitles cannot be queried or indexed on their own.
- **Idempotency by key plus body hash.** The key identifies the request; the hash detects a client reusing a key for different content, which would otherwise return a wrong replayed answer.
- **`200` for a sync that returns conflicts.** A sync can succeed for some changes and conflict on others, so the result is described in the body (`updated`, `conflicts`, `documentConflicts`) rather than by a single status code.
- **Value-based, not arrival-based.** Nothing depends on the order requests reach the server, which is what makes out-of-order delivery safe.

---
