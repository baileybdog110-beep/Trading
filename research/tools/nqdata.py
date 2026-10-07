import json, datetime as dt
from zoneinfo import ZoneInfo
ET = ZoneInfo("America/New_York")
def load(path):
    d = json.load(open(path))
    r = d['chart']['result'][0]
    q = r['indicators']['quote'][0]
    rows = []
    for i, t in enumerate(r['timestamp']):
        o, h, l, c, v = q['open'][i], q['high'][i], q['low'][i], q['close'][i], q['volume'][i]
        if None in (o, h, l, c):
            continue
        rows.append((dt.datetime.fromtimestamp(t, ET), o, h, l, c, v or 0))
    return rows
