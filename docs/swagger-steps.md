# Swagger inputs for the two-device screenshots

Run these on the current notebook (version 3: subtitle title `Overview`, content `v2 from laptop`).
Notebook `27876e54-2ff3-4bd7-9878-29a434e5993d`, subtitle `952f9fe8-f304-4a5b-a452-1ae4883dfcb8`.
Run A first, then B. Use `PUT /documents`. For A, scroll to the TOP of the response so `message` and the whole `conflicts` array are visible.

## A. 10-two-device-conflict.png  (idempotency-key `33333333-3333-4333-8333-333333333333`, x-device-id `phone-01`)
The phone is still on the original state (Intro / v1) and edits content.
```json
{"uuid":"27876e54-2ff3-4bd7-9878-29a434e5993d","title":"Project Notes","base_title":"Project Notes","version":1,
 "subtitles":[{"id":"952f9fe8-f304-4a5b-a452-1ae4883dfcb8","title":"Intro","content":"v2 from phone",
 "base_title":"Intro","base_content":"v1","base_version":1}]}
```
Expect: `Merge completed with unresolved conflicts`, `documentVersion` 3, `conflicts[0].fields[0]` = content, base `v1`, current `v2 from laptop`, incoming `v2 from phone`, `existingDeviceId` `laptop-01`, `incomingDeviceId` `phone-01`.

## B. 11-two-device-merge.png  (idempotency-key `44444444-4444-4444-8444-444444444444`, x-device-id `phone-01`)
The phone renames the notebook only. Its subtitle values equal its own base, so it changes nothing there.
```json
{"uuid":"27876e54-2ff3-4bd7-9878-29a434e5993d","title":"Team Notes","base_title":"Project Notes","version":1,
 "subtitles":[{"id":"952f9fe8-f304-4a5b-a452-1ae4883dfcb8","title":"Intro","content":"v1",
 "base_title":"Intro","base_content":"v1","base_version":1}]}
```
Expect: notebook title becomes `Team Notes` while the subtitle keeps `Overview` / `v2 from laptop` (the stale phone values do not overwrite the laptop's work), `documentVersion` 4.

Also save a Swagger overview screenshot as `01-swagger.png` (open `http://localhost:3000/api`).
