#!/bin/bash
# เฝ้ายอดดึงไฟล์จาก Supabase หลังเปิดสายถอดเสียงคืน (22 ส.ค. 2026)
# พิมพ์บรรทัดออกมา "เฉพาะตอนมีอะไรเปลี่ยน" หรือ "ตอนใกล้ชนเพดาน" เท่านั้น
export CLOUDFLARE_ACCOUNT_ID=a7e47fdb4e9cd8b925ffa4617ed5d370
KEY="_meta/sb-audio-egress-$(date -u +%Y-%m).json"
CAP_MB=400
LAST=""
while true; do
  RAW=$(npx wrangler r2 object get "freshket-echo-audio/$KEY" --pipe --remote 2>/dev/null)
  BYTES=$(printf '%s' "$RAW" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')
  [ -z "$BYTES" ] && BYTES=0
  MB=$(awk -v b="$BYTES" 'BEGIN{printf "%.1f", b/1048576}')
  PULLS=$(printf '%s' "$RAW" | sed -n 's/.*"pulls":\([0-9]*\).*/\1/p'); [ -z "$PULLS" ] && PULLS=0
  if [ "$BYTES" != "$LAST" ]; then
    echo "ดึงจาก Supabase สะสม ${MB}MB / ${CAP_MB}MB (${PULLS} ครั้ง)"
    LAST="$BYTES"
  fi
  # เตือนเมื่อเกินครึ่งเพดาน แม้ตัวเลขไม่ขยับ
  awk -v b="$BYTES" -v c="$CAP_MB" 'BEGIN{exit !(b > c*1048576*0.5)}' \
    && echo "⚠️ เกินครึ่งเพดานแล้ว ${MB}MB / ${CAP_MB}MB — ควรเข้าไปดู"
  sleep 300
done
