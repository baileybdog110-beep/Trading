# Research tools

The Python behind the strategy log and the backtest. None of it is needed to use the TradingView indicator.

| Script | Does |
|---|---|
| `fetch_data.sh <workdir>` | Downloads NQ/ES 1-, 2-, 5- and 60-minute bars into `<workdir>/data/` |
| `backtest_fsp.py` | Python port of the indicator; `DEFAULTS` = the indicator defaults |
| `final_eval.py <workdir>` | Runs the defaults on the 1m / 2m / 5m data (results in `../BACKTEST.md`) |
| `compare_variants.py <workdir>` | One-change-at-a-time comparisons across data splits |
| `transcribe_vod.py` | Whisper transcript of a stream recording, stamped in New York time |
| `ct_ocr.py`, `sample_positions.py <label> <twitch vod id> <from> <to>` | Reads FSP's NinjaTrader position box (side, size, average price) from one 1080p frame every 10 s of a Twitch VOD → `positions/<label>.csv` |
| `analyze_trades.py <workdir>` | Turns the position samples into trades with market context → `trades_log.csv` |
| `trade_stats.py <workdir>`, `level_baseline.py <workdir>` | The statistics in `../FSP_STRATEGY_LOG.md` §7 |
| `tvcheck.py <file.pine>` | Compile-checks a Pine script with TradingView's public compiler endpoint |

Requirements: Python 3.11+, `numpy`, `pillow`, `pytesseract` + `tesseract-ocr`, `faster-whisper`, `yt-dlp`, `ffmpeg`.
