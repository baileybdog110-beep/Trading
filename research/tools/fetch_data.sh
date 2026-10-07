#!/bin/bash
# Download the NQ / ES bars used by the backtest into <workdir>/data (Yahoo Finance chart API; intraday history is limited:
# 1m ≈ last 7 days, 2m/5m ≈ last 60 days, 60m ≈ 730 days).
set -e
W="${1:-.}"; mkdir -p "$W/data"; cd "$W/data"
UA="Mozilla/5.0"
get() { curl -sS -A "$UA" -o "$1" "https://query1.finance.yahoo.com/v8/finance/chart/$2?interval=$3&range=$4&includePrePost=true"; echo "$1"; }
get nq_1m.json  NQ=F 1m 7d
get nq_2m.json  NQ=F 2m 60d
get nq_5m.json  NQ=F 5m 60d
get nq_60m.json NQ=F 60m 730d
get es_1m.json  ES=F 1m 7d
get es_2m.json  ES=F 2m 60d
