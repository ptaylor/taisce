# GoatCounter report

Python script that fetches [GoatCounter][gc] stats via the [stats API][api] and
generates a self-contained HTML report with embedded charts.

[gc]: https://taisce.goatcounter.com/
[api]: https://www.goatcounter.com/api.html

It is a sibling of `gealach/report/goatcounter-report.py` and
`foighne/report/goatcounter-report.py`, and follows the same shape: the API
helpers, the period parsing and the report layout are the same; the event
vocabulary and the numbers are Taisce's.

## Quickstart

```bash
# One-time setup
python3 -m venv report/.venv
report/.venv/bin/pip install -r report/requirements.txt

# Run a report
report/.venv/bin/python report/goatcounter-report.py --period "this month"
```

The script produces a timestamped directory under `reports/`:

```
reports/<timestamp>_<start>_<end>/
  index.html   (self-contained HTML report with embedded charts)
  data.json    (raw metrics, daily breakdown, top events/pages)
  charts/      (PNG chart images, also embedded inline in index.html)
```

Charts are optional: without `pandas`/`matplotlib` the HTML and JSON are still
written, just without them.

## Usage

```bash
report/.venv/bin/python report/goatcounter-report.py --period "today"
report/.venv/bin/python report/goatcounter-report.py --period "last week"
report/.venv/bin/python report/goatcounter-report.py --period "this month"
report/.venv/bin/python report/goatcounter-report.py --period "last month"
report/.venv/bin/python report/goatcounter-report.py --period "this year"

# Explicit dates
report/.venv/bin/python report/goatcounter-report.py --start 2026-11-01 --end 2026-11-30

# Elsewhere
report/.venv/bin/python report/goatcounter-report.py --period "this month" --out /tmp/x
```

`--period` accepts `today`, `yesterday`, `this week`, `last week`, `this month`,
`last month`, `this year`, `last year`, a single `YYYY-MM-DD`, or a range
`YYYY-MM-DD:YYYY-MM-DD`. `GOAT_SITE`, `GOAT_START` and `GOAT_END` work as
environment defaults.

## The API token

The GoatCounter API needs a token with read access. Create one at
<https://taisce.goatcounter.com/settings/api> and put it in `.env.sh` at the
repository root, which is git-ignored:

```sh
export GOATCOUNTER_API_TOKEN=...
```

A value already set in the environment wins over `.env.sh`; the script warns
when the two disagree, because that is the usual cause of a confusing 401.

## The event vocabulary

The app's events are documented in `AGENTS.md` under **GoatCounter**. Two things
in the report are worth knowing before editing it:

- **A visit is two pageviews.** `/` counts the visit and `/v<release>` counts the
  same visit tagged with the build that served it. The per-release table is read
  from the second, never summed into the first. `/version`, `/verify` and other
  ordinary pages are not mistaken for releases — the slug must be digits and
  dashes only.
- **An event this script does not know is surfaced, not dropped.** It appears in
  an "Unrecognised events" card with a warning on the console. Adding an event in
  the app without teaching this script about it therefore fails visibly. That is
  deliberate: AGENTS.md requires the metric and the report to change together.

## Nothing about the reader

Counts only: event names, the release, and GoatCounter's own aggregates. No file
name, folder, search term, note content or shared link is ever sent, and the demo
(`?mock=1`) sends nothing at all. Keep it that way when adding an event.
