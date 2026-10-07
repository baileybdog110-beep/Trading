"""Compile-check a Pine script with TradingView's public translate endpoint and print errors/warnings."""
import sys, json, urllib.request, urllib.parse
src = open(sys.argv[1], encoding="utf-8").read()
data = urllib.parse.urlencode({"source": src}).encode()
req = urllib.request.Request("https://pine-facade.tradingview.com/pine-facade/translate_light?user_name=Guest&v=3", data=data,
                             headers={"Origin": "https://www.tradingview.com", "Referer": "https://www.tradingview.com/", "User-Agent": "Mozilla/5.0",
                                      "Content-Type": "application/x-www-form-urlencoded"})
resp = json.loads(urllib.request.urlopen(req, timeout=60).read())
lines = src.splitlines()
res = resp.get("result") or {}
errs = res.get("errors") or []
warns = res.get("warnings") or []
print("success:", resp.get("success"), "| errors:", len(errs), "| warnings:", len(warns))
def show(kind, e):
    msg = e.get("message", "")
    for k, v in (e.get("ctx") or {}).items():
        msg = msg.replace("{" + k + "}", str(v))
    ln = e.get("start", {}).get("line", 0)
    col = e.get("start", {}).get("column", 0)
    print(f"{kind} L{ln}:{col} {e.get('code','')} {msg}")
    if 0 < ln <= len(lines):
        print("     >", lines[ln - 1].strip()[:200])
for e in errs: show("ERR ", e)
for w in warns: show("WARN", w)
if not errs and resp.get("success") is False:
    print(json.dumps(resp)[:1500])
