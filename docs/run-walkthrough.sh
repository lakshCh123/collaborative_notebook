#!/usr/bin/env bash
# Creates a FRESH notebook and runs the full two-device walkthrough. Responses go to docs/responses/.
BASE=${BASE:-http://localhost:3000}
OUT="$(dirname "$0")/responses"; mkdir -p "$OUT"
uuid() { python3 -c 'import uuid;print(uuid.uuid4())'; }
call() { # name method device key body
  echo "== $1"
  curl -s -X "$2" "$BASE/documents" -H 'Content-Type: application/json' \
    -H "idempotency-key: $4" -H "x-device-id: $3" -d "$5" > "$OUT/$1.json"
  python3 -m json.tool < "$OUT/$1.json" | head -40; echo; }
call 01-create POST laptop-01 "$(uuid)" '{"title":"Project Notes","subtitles":[{"title":"Intro","content":"v1"}]}'
DOC=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["id"])' "$OUT/01-create.json")
SUB=$(python3 -c 'import json,sys;print(next(iter(json.load(open(sys.argv[1]))["subtitles"])))' "$OUT/01-create.json")
body() { echo "{\"uuid\":\"$DOC\",\"title\":\"Project Notes\",\"base_title\":\"Project Notes\",\"version\":$1,\"subtitles\":[{\"id\":\"$SUB\",$2}]}"; }
K3=$(uuid)
call 02-rename   PUT laptop-01 "$(uuid)" "$(body 1 '"title":"Overview","content":"v1","base_title":"Intro","base_content":"v1","base_version":1')"
call 03-merge    PUT phone-01  "$K3"     "$(body 1 '"title":"Intro","content":"v2 from phone","base_title":"Intro","base_content":"v1","base_version":1')"
call 04-conflict PUT laptop-01 "$(uuid)" "$(body 1 '"title":"Intro","content":"v2 from laptop","base_title":"Intro","base_content":"v1","base_version":1')"
call 05-replay   PUT phone-01  "$K3"     "$(body 1 '"title":"Intro","content":"v2 from phone","base_title":"Intro","base_content":"v1","base_version":1')"
call 06-resolve  PUT laptop-01 "$(uuid)" "$(body 3 '"title":"Overview","content":"v2 from phone + v2 from laptop","base_title":"Overview","base_content":"v2 from phone","base_version":3')"
call 07-add      PUT phone-01  "$(uuid)" "{\"uuid\":\"$DOC\",\"title\":\"Project Notes\",\"base_title\":\"Project Notes\",\"version\":4,\"subtitles\":[{\"id\":\"$(uuid)\",\"title\":\"Todo\",\"content\":\"ship it\",\"base_version\":1}]}"
echo "Notebook: $DOC"
