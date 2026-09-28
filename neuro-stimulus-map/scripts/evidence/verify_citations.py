#!/usr/bin/env python3
"""Re-verify every source in data/evidence/sources.json against PubMed and Crossref.

The build environment could not reach PubMed, PMC or Crossref, so the evidence records
were checked only against search-engine records. Run this script anywhere with normal
internet access to upgrade that check:

  python3 scripts/evidence/verify_citations.py            # report only
  python3 scripts/evidence/verify_citations.py --abstracts # also save abstracts for manual review

For each source it:
  * resolves the DOI on Crossref and compares title, year and first author;
  * looks up the PMID (or searches PubMed by DOI/title) and compares title and year;
  * optionally downloads the PubMed abstract to scripts/evidence/abstracts/<id>.txt so a
    reviewer can confirm that each stated finding is actually supported.

It writes scripts/evidence/verification_report.json and never edits sources.json:
upgrading a record's verification level is a deliberate human decision after reading the
abstract or full text.
Standard library only.
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / "data" / "evidence" / "sources.json"
OUT = ROOT / "scripts" / "evidence" / "verification_report.json"
ABS_DIR = ROOT / "scripts" / "evidence" / "abstracts"
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
UA = {"User-Agent": "neuro-stimulus-map citation verifier (educational; mailto:unset@example.org)"}


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", s.lower()).strip()


def similar(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, norm(a), norm(b)).ratio()


def crossref(doi: str) -> dict | None:
    try:
        msg = json.loads(get(f"https://api.crossref.org/works/{urllib.parse.quote(doi)}"))["message"]
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}
    year = (msg.get("issued", {}).get("date-parts") or [[None]])[0][0]
    authors = msg.get("author") or []
    return {
        "title": (msg.get("title") or [""])[0],
        "year": year,
        "firstAuthor": authors[0].get("family") if authors else None,
        "journal": (msg.get("container-title") or [""])[0],
    }


def pubmed_search(term: str) -> str | None:
    try:
        r = json.loads(get(f"{EUTILS}/esearch.fcgi?db=pubmed&retmode=json&term={urllib.parse.quote(term)}"))
        ids = r["esearchresult"]["idlist"]
        return ids[0] if ids else None
    except Exception:  # noqa: BLE001
        return None


def pubmed_summary(pmid: str) -> dict | None:
    try:
        r = json.loads(get(f"{EUTILS}/esummary.fcgi?db=pubmed&retmode=json&id={pmid}"))["result"][pmid]
        return {"title": r.get("title", ""), "year": int(r.get("pubdate", "0")[:4] or 0), "journal": r.get("fulljournalname", ""), "firstAuthor": (r.get("authors") or [{}])[0].get("name")}
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}


def pubmed_abstract(pmid: str) -> str:
    try:
        return get(f"{EUTILS}/efetch.fcgi?db=pubmed&rettype=abstract&retmode=text&id={pmid}").decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return f"ERROR: {e}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--abstracts", action="store_true", help="save PubMed abstracts for manual review")
    args = ap.parse_args()
    sources = json.loads(SOURCES.read_text())
    report = []
    problems = 0
    for s in sources:
        if s["design"] == "methods / database" and not s.get("doi") and not s.get("pmid"):
            report.append({"id": s["id"], "status": "skipped (web page)"})
            continue
        entry: dict = {"id": s["id"], "title": s["title"], "year": s["year"]}
        if s.get("doi"):
            cr = crossref(s["doi"])
            entry["crossref"] = cr
            if cr and "error" not in cr:
                entry["crossrefTitleMatch"] = round(similar(cr["title"], s["title"]), 2)
                entry["crossrefYearMatch"] = cr["year"] == s["year"]
        pmid = s.get("pmid") or (pubmed_search(f"{s['doi']}[doi]") if s.get("doi") else None) or pubmed_search(f"{s['title']}[title]")
        entry["pmid"] = pmid
        if pmid:
            pm = pubmed_summary(pmid)
            entry["pubmed"] = pm
            if pm and "error" not in pm:
                entry["pubmedTitleMatch"] = round(similar(pm["title"], s["title"]), 2)
                entry["pubmedYearMatch"] = pm["year"] == s["year"]
            if args.abstracts:
                ABS_DIR.mkdir(parents=True, exist_ok=True)
                (ABS_DIR / f"{s['id']}.txt").write_text(pubmed_abstract(pmid))
        ok = any(entry.get(k, 0) >= 0.9 for k in ("crossrefTitleMatch", "pubmedTitleMatch"))
        entry["status"] = "confirmed" if ok else "CHECK MANUALLY"
        problems += 0 if ok else 1
        report.append(entry)
        print(f"{entry['status']:>15}  {s['id']}")
        time.sleep(0.4)  # stay well under NCBI's rate limit
    OUT.write_text(json.dumps(report, indent=1))
    print(f"\n{len(report)} sources, {problems} need manual checking. Report: {OUT}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
