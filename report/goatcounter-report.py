#!/usr/bin/env python3
"""
goatcounter-report.py

Fetch GoatCounter stats via the stats API for a date range, compute the numbers
that matter for Taisce, generate charts (PNG), and write a self-contained HTML
report with the images embedded.

Usage:
  python3 report/goatcounter-report.py --period "this month"
  python3 report/goatcounter-report.py --site taisce --period "last month"
  python3 report/goatcounter-report.py --start 2026-11-01 --end 2026-11-30

Notes:
  - Calls GoatCounter API v0 stats endpoints per https://www.goatcounter.com/api.html
  - API token is read from GOATCOUNTER_API_TOKEN. The script auto-loads .env.sh
    from the project root if present, but a value already set in the environment
    wins over .env.sh (a warning is printed when the two disagree — a common
    cause of confusing 401/404 responses).
  - Transient API failures (connection errors, 429, 5xx, and non-JSON replies
    such as GoatCounter's HTML error page) are retried with exponential backoff.
  - Produces a timestamped directory under reports/:
      reports/<timestamp>_<start>_<end>/
        index.html   (self-contained HTML report)
        data.json    (raw metrics & breakdown)
        charts/      (PNG chart images)

The Taisce event vocabulary read here is the one documented in AGENTS.md:

  pageviews   /                  a visit to the app
              /v<release>        the same visit, tagged with the release

  connect     connect-start      the Connect to Dropbox button was pressed
  files       new-open file-new folder-new file-open
              open-from-recent open-from-search
  search      search search-empty
  editor      template-insert task-toggle image-paste undo redo
  links       link-open link-change link-remove link-copy link-go link-paste
  share       share-open share-copy share-send
  settings    settings-open settings-save help-open recent-toggle installed
  sync        conflict-merged conflict-dropped
  failures    error-open error-save error-search error-share error-image
              share-scope         the grant predates the sharing permission

Anything not listed falls into an "other" bucket so a new event is never lost
before this file knows about it.

The demo (?mock=1) sends nothing at all, so its visits are not in these numbers.
"""

import argparse
import base64
import datetime as dt
import io
import json
import os
import sys
import time

import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

# Charts are optional: the script still writes the HTML + JSON without them, so
# a machine without pandas/matplotlib still produces a usable report. The
# imports are attempted once, here, and the flags gate the chart code.
try:
    import pandas as pd

    HAVE_PANDAS = True
except Exception:
    HAVE_PANDAS = False

try:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    HAVE_MPL = True
except Exception:
    HAVE_MPL = False


# ---------------------------------------------------------------------------
# .env.sh auto-loading
# ---------------------------------------------------------------------------

def load_dotenv_sh():
    """Load environment variables from .env.sh in the project root (if present).
    Only sets vars that aren't already in the environment.

    Returns the names of variables defined in .env.sh but skipped because the
    environment already had a different value (the environment wins).
    """
    shadowed = []
    env_file = os.path.join(PROJECT_ROOT, ".env.sh")
    if not os.path.exists(env_file):
        return shadowed
    with open(env_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[7:]
            if "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if not key:
                continue
            if key not in os.environ:
                os.environ[key] = val
            elif os.environ[key] != val:
                shadowed.append(key)
    return shadowed


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

def get_api_base(site):
    """Build the API base URL from a site identifier."""
    if site.startswith("http://") or site.startswith("https://"):
        return site.rstrip("/") + "/api/v0"
    return f"https://{site}.goatcounter.com/api/v0"


API_ATTEMPTS = 3   # total attempts per request (1 = no retries)
API_BACKOFF = 1.5  # seconds before the first retry; doubles each attempt
API_GAP = 0.4      # seconds between successive calls, to stay under the limit


def _is_json_response(resp):
    """True if the response looks like JSON (per Content-Type or body)."""
    ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    if ctype in ("application/json", "text/json") or ctype.endswith("+json"):
        return True
    body = (resp.text or "").lstrip()
    return body.startswith("{") or body.startswith("[")


def _body_snippet(resp, limit=200):
    """Collapsed first `limit` characters of the response body."""
    body = " ".join((resp.text or "").split())
    return body[:limit] + ("…" if len(body) > limit else "")


def _is_retryable(status):
    """Transient HTTP statuses worth retrying."""
    return status in (404, 408, 425, 429) or status >= 500


def _describe_failure(url, resp):
    """Explanatory message for a failed API call.

    GoatCounter serves its 404 page (HTML) and its rate-limit notice as plain
    text, so a non-JSON reply usually means the API was not reached — a rate
    limit being the common cause, since its own 429 body says "rate limited
    exceeded". The message says so rather than blaming the URL.
    """
    ctype = resp.headers.get("Content-Type") or "unknown content type"
    if not _is_json_response(resp):
        reason = "rate limited" if resp.status_code == 429 else "did not reach the API"
        return (
            f"API error ({resp.status_code}) for {url}: GoatCounter returned {ctype} "
            f"instead of JSON ({reason}): {_body_snippet(resp)}"
        )
    try:
        detail = json.dumps(resp.json())
    except Exception:
        detail = _body_snippet(resp)
    return f"API error ({resp.status_code}) for {url}: {detail}"


def api_get(api_base, path, params=None, timeout=60, attempts=API_ATTEMPTS):
    """Authenticated GET against the GoatCounter API. Returns parsed JSON.

    Auth failures (401/403) raise immediately. Transient failures — connection
    errors, 404/408/425/429, 5xx, and non-JSON replies — are retried with
    exponential backoff before giving up with a readable message.
    """
    token = os.getenv("GOATCOUNTER_API_TOKEN")
    if not token:
        raise RuntimeError(
            "GOATCOUNTER_API_TOKEN not set. Source .env.sh or set the env var before running."
        )
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    url = f"{api_base}/{path.lstrip('/')}"

    for attempt in range(1, attempts + 1):
        error = None
        retryable = True
        resp = None
        try:
            resp = requests.get(url, headers=headers, params=params, timeout=timeout)
        except requests.RequestException as e:
            error = f"{type(e).__name__} for {url}: {e}"
        else:
            if resp.status_code == 200 and _is_json_response(resp):
                try:
                    return resp.json()
                except ValueError as e:
                    error = f"invalid JSON from {url}: {e}"
            elif resp.status_code in (401, 403):
                raise RuntimeError(_describe_failure(url, resp))
            else:
                retryable = _is_retryable(resp.status_code)
                error = _describe_failure(url, resp)

        if attempt >= attempts or not retryable:
            raise RuntimeError(error)
        delay = API_BACKOFF * (2 ** (attempt - 1))
        print(f"  retrying in {delay:g}s — {error}", file=sys.stderr)
        time.sleep(delay)

    raise RuntimeError(error or f"API error for {url}")


def fetch_stats_data(site, start, end):
    """Fetch the stats this report reads. Returns a dict of API responses."""
    api_base = get_api_base(site)

    def _to_datetime(d, default_time):
        return f"{d}T{default_time}Z" if "T" not in d else d

    params = {"start": _to_datetime(start, "00:00:00"), "end": _to_datetime(end, "23:59:59")}
    hits_params = {**params, "limit": 200}

    total = api_get(api_base, "stats/total", params)
    time.sleep(API_GAP)
    hits = api_get(api_base, "stats/hits", hits_params)

    # Optional breakdowns (best-effort — a missing one is not a failure). The
    # gap between calls keeps six quick requests from tripping the rate limit.
    optional = {}
    for name, endpoint in (
        ("browsers", "stats/browsers"),
        ("systems", "stats/systems"),
        ("locations", "stats/locations"),
        ("refs", "stats/toprefs"),
    ):
        try:
            time.sleep(API_GAP)
            optional[name] = api_get(api_base, endpoint, params)
        except Exception:
            optional[name] = None

    return {"total": total, "hits": hits, **optional}


# ---------------------------------------------------------------------------
# Period parsing
# ---------------------------------------------------------------------------

def parse_period(period):
    """Return (start, end) ISO date strings for a friendly period phrase.

    Accepts: today, yesterday, this week, last week, this month, last month,
    this year, last year; a single date YYYY-MM-DD; or a range
    YYYY-MM-DD:YYYY-MM-DD.
    """
    if not period:
        return None
    s = period.strip().lower()
    if ":" in s:
        parts = s.split(":")
        if len(parts) == 2:
            try:
                start = dt.datetime.strptime(parts[0].strip(), "%Y-%m-%d").date()
                end = dt.datetime.strptime(parts[1].strip(), "%Y-%m-%d").date()
                return (start.isoformat(), end.isoformat())
            except Exception:
                raise ValueError("Invalid explicit range. Use YYYY-MM-DD:YYYY-MM-DD")
    today = dt.date.today()
    if s == "today":
        return (today.isoformat(), today.isoformat())
    if s == "yesterday":
        d = today - dt.timedelta(days=1)
        return (d.isoformat(), d.isoformat())
    if s in ("this week", "current week", "week"):
        start = today - dt.timedelta(days=today.weekday())
        return (start.isoformat(), today.isoformat())
    if s in ("last week", "previous week"):
        start = today - dt.timedelta(days=today.weekday() + 7)
        end = start + dt.timedelta(days=6)
        return (start.isoformat(), end.isoformat())
    if s in ("this month", "month"):
        start = today.replace(day=1)
        return (start.isoformat(), today.isoformat())
    if s in ("last month", "previous month"):
        first_of_this = today.replace(day=1)
        last_month_end = first_of_this - dt.timedelta(days=1)
        start = last_month_end.replace(day=1)
        return (start.isoformat(), last_month_end.isoformat())
    if s in ("this year", "year"):
        start = today.replace(month=1, day=1)
        return (start.isoformat(), today.isoformat())
    if s in ("last year", "previous year"):
        start = today.replace(year=today.year - 1, month=1, day=1)
        end = today.replace(year=today.year - 1, month=12, day=31)
        return (start.isoformat(), end.isoformat())
    try:
        single = dt.datetime.strptime(s, "%Y-%m-%d").date()
        return (single.isoformat(), single.isoformat())
    except Exception:
        raise ValueError(f"Unrecognized period: '{period}'")


# ---------------------------------------------------------------------------
# Report building
# ---------------------------------------------------------------------------

# Events are grouped into the questions a reader of this report actually asks:
# did anyone arrive, did they open a note, did the editor's affordances get
# used, did sharing work, did something fail. Anything not listed falls into
# its own "other" bucket.

CONNECT_EVENTS = ("connect-start",)
FILE_EVENTS = (
    "new-open", "file-new", "folder-new", "file-open",
    "open-from-recent", "open-from-search",
)
SEARCH_EVENTS = ("search", "search-empty")
EDITOR_EVENTS = ("template-insert", "task-toggle", "image-paste", "undo", "redo")
LINK_EVENTS = (
    "link-open", "link-change", "link-remove", "link-copy", "link-go", "link-paste",
)
SHARE_EVENTS = ("share-open", "share-copy", "share-send", "share-scope")
SETTINGS_EVENTS = (
    "settings-open", "settings-save", "help-open", "recent-toggle", "installed",
)
SYNC_EVENTS = ("conflict-merged", "conflict-dropped")
FAILURE_EVENTS = (
    "error-open", "error-save", "error-search", "error-share", "error-image",
)

KNOWN_EVENTS = (
    CONNECT_EVENTS + FILE_EVENTS + SEARCH_EVENTS + EDITOR_EVENTS
    + LINK_EVENTS + SHARE_EVENTS + SETTINGS_EVENTS + SYNC_EVENTS + FAILURE_EVENTS
)

# Every visit is counted twice: `/` for the app, and `/v<release>` for the same
# visit tagged with the build that served it. The plain pageview is what
# "visitors" means; the tagged ones are read per release, never summed into it.
APP_PAGE = "/"
RELEASE_PREFIX = "/v"


def _release_of(path):
    """The release slug in `/v0-16`, or None for an ordinary pageview."""
    if not path.startswith(RELEASE_PREFIX) or path == RELEASE_PREFIX:
        return None
    slug = path[len(RELEASE_PREFIX):]
    # A release slug is digits and dashes only ("0-16"); anything else is a page
    # someone else made, such as /version or /verify.
    return slug if slug and all(c.isdigit() or c == "-" for c in slug) else None


def _count_map(events, keys):
    """{key: count} for the given keys, in the given order."""
    by_path = {h.get("path", ""): h.get("count", 0) for h in events}
    return {k: by_path.get(k, 0) for k in keys}


def build_report(site, start, end, data):
    """Turn the raw stats responses into the structured report dict."""
    total = data["total"]
    hits_list = data["hits"].get("hits", [])

    pages = [h for h in hits_list if not h.get("event")]
    events = [h for h in hits_list if h.get("event")]

    daily = [{"day": s["day"], "visitors": s.get("daily", 0)} for s in total.get("stats", [])]

    top_events = sorted(
        ({"event_type": e.get("path", ""), "cnt": e.get("count", 0)} for e in events),
        key=lambda x: x["cnt"],
        reverse=True,
    )
    top_pages = sorted(
        ({"path": p.get("path", ""), "cnt": p.get("count", 0)} for p in pages),
        key=lambda x: x["cnt"],
        reverse=True,
    )

    connect = _count_map(events, CONNECT_EVENTS)
    files = _count_map(events, FILE_EVENTS)
    search = _count_map(events, SEARCH_EVENTS)
    editor = _count_map(events, EDITOR_EVENTS)
    links = _count_map(events, LINK_EVENTS)
    share = _count_map(events, SHARE_EVENTS)
    settings = _count_map(events, SETTINGS_EVENTS)
    sync = _count_map(events, SYNC_EVENTS)
    failures = _count_map(events, FAILURE_EVENTS)

    # A new event this file has not been taught about would otherwise vanish
    # from every table. The warning is the prompt to add it to the vocabulary —
    # and to the report, which AGENTS.md requires in the same change.
    known = set(KNOWN_EVENTS)
    unknown = {e.get("path", ""): e.get("count", 0) for e in events
               if e.get("path", "") not in known}
    unknown = dict(sorted(unknown.items(), key=lambda kv: kv[1], reverse=True))

    # Visits per release: every visit fires `/` and `/v<release>`.
    by_release = {}
    for page in pages:
        release = _release_of(page.get("path", ""))
        if release:
            by_release[release] = by_release.get(release, 0) + page.get("count", 0)
    by_release = dict(sorted(by_release.items(), key=lambda kv: kv[1], reverse=True))

    app_visits = next(
        (p.get("count", 0) for p in pages if p.get("path") == APP_PAGE), 0
    )

    notes_opened = files["file-open"]
    shares_made = share["share-open"]
    # A share "completed" if the link was copied or handed to the system sheet.
    shares_completed = share["share-copy"] + share["share-send"]

    metrics = {
        "visitors": total.get("total", 0),
        "events": total.get("total_events", 0),
        "pageviews": total.get("total", 0) - total.get("total_events", 0),
        "app_visits": app_visits,
        "connects": connect["connect-start"],
        "notes_opened": notes_opened,
        "files_created": files["file-new"],
        "folders_created": files["folder-new"],
        "searches": search["search"],
        "searches_empty": search["search-empty"],
        "templates": editor["template-insert"],
        "tasks_ticked": editor["task-toggle"],
        "images_pasted": editor["image-paste"],
        "links_edited": links["link-change"] + links["link-remove"] + links["link-paste"],
        "shares": shares_made,
        "shares_completed": shares_completed,
        "installs": settings["installed"],
        "conflicts": sum(sync.values()),
        "errors_total": sum(failures.values()),
        "scope_failures": share["share-scope"],
    }

    report = {
        "site": site,
        "period": {"start": start, "end": end},
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "generated_by": "report/goatcounter-report.py",
        "metrics": metrics,
        "daily": daily,
        "connect": connect,
        "files": files,
        "search": search,
        "editor": editor,
        "links": links,
        "share": share,
        "settings": settings,
        "sync": sync,
        "failures": failures,
        "unknown_events": unknown,
        "releases": {
            "visits": by_release,
            "current": next(iter(by_release), ""),
        },
        "top_events": top_events,
        "top_pages": top_pages,
    }

    for key in ("browsers", "systems", "locations"):
        if data.get(key):
            report[key] = data[key].get("stats", [])
    if data.get("refs"):
        report["referrers"] = data["refs"].get("stats", [])

    return report


def percent(part, whole):
    return round(100.0 * part / whole, 1) if whole else 0.0


def short_summary(report):
    m = report["metrics"]
    opened_per_visit = percent(m["notes_opened"], m["visitors"])
    return (
        f"Period {report['period']['start']} → {report['period']['end']}: "
        f"visitors={m['visitors']}, notes opened={m['notes_opened']} "
        f"({opened_per_visit}% of visitors), created={m['files_created']} files "
        f"+ {m['folders_created']} folders, shares={m['shares_completed']}, "
        f"installs={m['installs']}, errors={m['errors_total']}"
    )


# ---------------------------------------------------------------------------
# Chart helpers
# ---------------------------------------------------------------------------

def fig_to_base64(fig, charts_dir, name):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", dpi=150)
    plt.close(fig)
    buf.seek(0)
    png = buf.read()
    with open(os.path.join(charts_dir, name), "wb") as f:
        f.write(png)
    return base64.b64encode(png).decode("ascii")


def _chart_daily(report, charts_dir):
    if not (HAVE_PANDAS and HAVE_MPL) or not report["daily"]:
        return None
    df = pd.DataFrame(report["daily"])
    df["day"] = pd.to_datetime(df["day"])
    fig, ax = plt.subplots(figsize=(10, 4))
    ax.bar(df["day"], df["visitors"], color="#23297a", width=0.7)
    ax.set_title(f"Visitors per day ({report['period']['start']} → {report['period']['end']})")
    ax.set_xlabel("Day")
    ax.set_ylabel("Visitors")
    ax.margins(x=0.02)
    fig.tight_layout()
    return fig_to_base64(fig, charts_dir, "daily-visitors.png")


def _chart_releases(report, charts_dir):
    """How many visits came from each released build."""
    releases = report.get("releases", {}).get("visits", {})
    if not HAVE_MPL or not releases:
        return None
    names = list(releases.keys())
    values = [releases[r] for r in names]
    fig, ax = plt.subplots(figsize=(8, 0.45 * len(names) + 1.6))
    bars = ax.barh(names, values, color="#5c6470")
    ax.invert_yaxis()
    ax.set_title("Visits by release")
    ax.set_xlabel("Visits")
    for b, v in zip(bars, values):
        ax.text(b.get_width(), b.get_y() + b.get_height() / 2, f"  {v:,}",
                va="center", fontsize=9)
    fig.tight_layout()
    return fig_to_base64(fig, charts_dir, "releases.png")


def _chart_engagement(report, charts_dir):
    """The gestures that mean the reader got somewhere."""
    if not HAVE_MPL:
        return None
    e = report["editor"]
    rows = [
        ("Notes opened", report["metrics"]["notes_opened"]),
        ("Files created", report["metrics"]["files_created"]),
        ("Folders created", report["metrics"]["folders_created"]),
        ("Searches", report["metrics"]["searches"]),
        ("Shared", report["metrics"]["shares_completed"]),
        ("Installed", report["metrics"]["installs"]),
        ("Templates inserted", e["template-insert"]),
        ("Tasks ticked", e["task-toggle"]),
        ("Images pasted", e["image-paste"]),
        ("Undo", e["undo"]),
        ("Redo", e["redo"]),
    ]
    rows = [(label, value) for label, value in rows if value]
    if not rows:
        return None
    labels = [r[0] for r in rows]
    sizes = [r[1] for r in rows]
    fig, ax = plt.subplots(figsize=(8, 0.45 * len(rows) + 1.5))
    bars = ax.barh(labels, sizes, color="#0b6bcb")
    ax.invert_yaxis()
    ax.set_title("What people did")
    ax.set_xlabel("Count")
    for b, v in zip(bars, sizes):
        ax.text(b.get_width(), b.get_y() + b.get_height() / 2, f"  {v:,}",
                va="center", fontsize=9)
    fig.tight_layout()
    return fig_to_base64(fig, charts_dir, "engagement.png")


def _chart_links(report, charts_dir):
    """The link editor, step by step: opened, changed, followed, copied, removed."""
    links = report["links"]
    if not HAVE_MPL or sum(links.values()) == 0:
        return None
    order = ["link-open", "link-change", "link-remove", "link-copy", "link-go", "link-paste"]
    rows = [(k, links.get(k, 0)) for k in order if links.get(k, 0)]
    fig, ax = plt.subplots(figsize=(8, 0.45 * len(rows) + 1.5))
    bars = ax.barh([r[0] for r in rows], [r[1] for r in rows], color="#166534")
    ax.invert_yaxis()
    ax.set_title("The link editor")
    ax.set_xlabel("Count")
    for b, v in zip(bars, [r[1] for r in rows]):
        ax.text(b.get_width(), b.get_y() + b.get_height() / 2, f"  {v:,}",
                va="center", fontsize=9)
    fig.tight_layout()
    return fig_to_base64(fig, charts_dir, "links.png")


def _chart_failures(report, charts_dir):
    f = report["failures"]
    extra = {"share-scope": report["share"].get("share-scope", 0)}
    rows = {**f, **extra}
    rows = {k: v for k, v in rows.items() if v}
    if not HAVE_MPL or not rows:
        return None
    labels = list(rows.keys())
    sizes = list(rows.values())
    fig, ax = plt.subplots(figsize=(8, 0.45 * len(rows) + 1.5))
    bars = ax.barh(labels, sizes, color="#b91c1c")
    ax.invert_yaxis()
    ax.set_title("Failures")
    ax.set_xlabel("Count")
    for b, v in zip(bars, sizes):
        ax.text(b.get_width(), b.get_y() + b.get_height() / 2, f"  {v:,}",
                va="center", fontsize=9)
    fig.tight_layout()
    return fig_to_base64(fig, charts_dir, "failures.png")


# ---------------------------------------------------------------------------
# HTML
# ---------------------------------------------------------------------------

def _esc(s):
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _metric_card(value, label, hint="", tone=""):
    tip = f'<div class="hint">{_esc(hint)}</div>' if hint else ""
    cls = f"metric-card {tone}".strip()
    return (
        f'<div class="{cls}"><div class="value">{value}</div>'
        f'<div class="label">{_esc(label)}</div>{tip}</div>'
    )


def _img_section(title, b64, note=""):
    if not b64:
        return ""
    note_html = f'<p class="note">{_esc(note)}</p>' if note else ""
    return (
        f'<section class="card"><h2>{_esc(title)}</h2>{note_html}'
        f'<img src="data:image/png;base64,{b64}" alt="{_esc(title)}"></section>'
    )


def _table_section(title, rows, col_a, col_b, limit=None, note=""):
    """rows: a dict {label: count}, or a list of (label, count) pairs."""
    if isinstance(rows, dict):
        rows = list(rows.items())
    rows = [(str(a), b) for a, b in rows if b]
    if not rows:
        return ""
    if limit:
        rows = rows[:limit]
    note_html = f'<p class="note">{_esc(note)}</p>' if note else ""
    body = "".join(
        f"<tr><td>{_esc(a)}</td><td>{b:,}</td></tr>" for a, b in rows
    )
    return (
        f'<section class="card"><h2>{_esc(title)}</h2>{note_html}<table>'
        f"<tr><th>{_esc(col_a)}</th><th>{_esc(col_b)}</th></tr>"
        f"{body}</table></section>"
    )


STYLE = """
:root {
  --bg: #f5f6fb; --card: #ffffff; --fg: #191c38; --muted: #565d85;
  --border: #dde1ef; --accent: #23297a; --ok: #1a7f56; --warn: #94570a;
  --bad: #ad2020; --radius: 14px;
}
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.container { max-width: 60rem; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
header {
  border-bottom: 1px solid var(--border); padding-bottom: 1rem; margin-bottom: 1.5rem;
}
header h1 { margin: 0 0 0.25rem; font-size: 1.6rem; }
header .sub { color: var(--muted); font-size: 0.9rem; }
header .quote {
  font-family: Georgia, 'Times New Roman', serif; font-style: italic;
  color: var(--accent); margin-top: 0.6rem; font-size: 0.95rem;
}
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.75rem; margin-bottom: 1.5rem; }
.metric-card { background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 1rem 1.1rem; }
.metric-card .value { font-size: 1.9rem; font-weight: 700; line-height: 1.1;
  color: var(--accent); font-variant-numeric: tabular-nums; }
.metric-card .label { font-size: 0.78rem; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--muted); margin-top: 0.35rem; }
.metric-card .hint { font-size: 0.75rem; color: var(--muted); margin-top: 0.3rem; }
.metric-card.good .value { color: var(--ok); }
.metric-card.warn .value { color: var(--warn); }
.metric-card.bad .value { color: var(--bad); }
.card { background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 1.25rem; margin-bottom: 1.25rem; }
.card h2 { margin: 0 0 0.75rem; font-size: 1.1rem; }
.card .note { color: var(--muted); font-size: 0.85rem; margin: -0.4rem 0 0.8rem; }
.card img { max-width: 100%; height: auto; border-radius: 6px; display: block; }
table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
th, td { text-align: left; padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--border); }
th { color: var(--muted); font-size: 0.75rem; text-transform: uppercase;
  letter-spacing: 0.04em; font-weight: 600; }
td:last-child, th:last-child { text-align: right; font-variant-numeric: tabular-nums; }
tr:last-child td { border-bottom: 0; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; }
@media (max-width: 40rem) { .grid2 { grid-template-columns: 1fr; } }
.warn-card { border-color: var(--warn); }
footer { color: var(--muted); font-size: 0.8rem; text-align: center; margin-top: 2rem; }
footer a { color: var(--accent); }
@media (prefers-color-scheme: dark) {
  :root { --bg: #0d1026; --card: #151a3a; --fg: #e6e8f7; --muted: #98a0cc;
    --border: #262d59; --accent: #8f9bf0; --ok: #3ddc97; --warn: #ffb020;
    --bad: #ff7a7a; }
}
"""


def generate_html(report, charts, out_dir):
    m = report["metrics"]
    period = report["period"]

    header = (
        "<header>"
        "<h1>Taisce — GoatCounter report</h1>"
        f'<div class="sub">Site <strong>{_esc(report["site"])}</strong> · '
        f'period {_esc(period["start"])} → {_esc(period["end"])} · '
        f'generated {_esc(report["generated_at"])}</div>'
        '<div class="quote">&ldquo;taisce — Irish: a hoard, a store, '
        'a treasure.&rdquo;</div>'
        "</header>"
    )

    opened_per_visit = percent(m["notes_opened"], m["visitors"])
    share_rate = percent(m["shares_completed"], m["shares"])

    cards = "".join([
        _metric_card(f"{m['visitors']:,}", "Visitors"),
        _metric_card(f"{m['events']:,}", "Events"),
        _metric_card(
            f"{m['notes_opened']:,}", "Notes opened",
            hint=f"{opened_per_visit}% of visitors", tone="good",
        ),
        _metric_card(
            f"{m['files_created']:,}", "Files created",
            hint=f"{m['folders_created']:,} folders too",
        ),
        _metric_card(f"{m['searches']:,}", "Searches",
                     hint=f"{m['searches_empty']:,} found nothing"),
        _metric_card(
            f"{m['shares_completed']:,}", "Links shared",
            hint=f"{share_rate}% of {m['shares']:,} share screens",
        ),
        _metric_card(f"{m['templates']:,}", "Templates inserted",
                     hint="the slash menu"),
        _metric_card(f"{m['links_edited']:,}", "Links edited",
                     hint="changed, removed or pasted over"),
        _metric_card(f"{m['installs']:,}", "Installed as an app"),
        _metric_card(
            f"{m['conflicts']:,}", "Save conflicts",
            hint="two devices racing", tone="warn" if m["conflicts"] else "",
        ),
        _metric_card(
            f"{m['errors_total']:,}", "Failures",
            tone="bad" if m["errors_total"] else "",
        ),
        _metric_card(
            f"{m['scope_failures']:,}", "Sharing refused",
            hint="grant predates sharing.read",
            tone="warn" if m["scope_failures"] else "",
        ),
    ])

    chart_html = "".join([
        _img_section("Visitors per day", charts.get("daily")),
        _img_section("What people did", charts.get("engagement")),
        _img_section(
            "The link editor", charts.get("links"),
            "Opened, then changed, followed, copied or removed. A big gap "
            "between opened and everything else means the panel is in the way.",
        ),
        _img_section(
            "Visits by release", charts.get("releases"),
            "Every visit fires / and /v<release>. A release still taking a "
            "share of visits is still being loaded by someone — the service "
            "worker serves the cached shell, so an old build can persist.",
        ),
        _img_section(
            "Failures", charts.get("failures"),
            "Counted where they happened. share-scope is the one that needs a "
            "code change: a grant made before sharing.read existed.",
        ),
    ])

    def _kv(mapping):
        return list(mapping.items())

    tables = "".join([
        _table_section("Arriving", _kv(report["connect"]), "Event", "Count",
                       note="The Connect to Dropbox button. Authorisation is "
                            "counted here, not the visit."),
        _table_section("Files and folders", _kv(report["files"]), "Event", "Count",
                       note="file-open counts every note opened, including "
                            "those opened straight after creating one."),
        _table_section("Search", _kv(report["search"]), "Event", "Count",
                       note="Whether a search found anything is the only thing "
                            "measured — never what was typed."),
        _table_section("Editor", _kv(report["editor"]), "Event", "Count"),
        _table_section("Links", _kv(report["links"]), "Event", "Count",
                       note="link-paste is the select-then-paste shortcut; "
                            "link-go is a link followed from its editor."),
        _table_section("Sharing", _kv(report["share"]), "Event", "Count",
                       note="share-open → share-copy / share-send is the "
                            "funnel; share-scope means the stored grant has "
                            "no sharing permission."),
        _table_section("Settings and about", _kv(report["settings"]), "Event", "Count"),
        _table_section("Sync", _kv(report["sync"]), "Event", "Count",
                       note="conflict-merged kept the local edit; "
                            "conflict-dropped lost it because the file grew a "
                            "different number of blocks elsewhere."),
        _table_section("Failures", _kv(report["failures"]), "Event", "Count"),
        _table_section(
            "Visits by release", report.get("releases", {}).get("visits", {}),
            "Release", "Visits",
            note="From the /v<release> pageview. The plain / visits should "
                 "equal their sum; a gap means a visit loaded a build without "
                 "a version meta tag.",
        ),
    ])

    unknown = report.get("unknown_events", {})
    if unknown:
        tables += (
            '<section class="card warn-card"><h2>Unrecognised events</h2>'
            '<p class="note">These were counted by the app but are not in this '
            "script's vocabulary, so they appear in no other table. Add them to "
            "the groups in <code>report/goatcounter-report.py</code> — AGENTS.md "
            "requires the metric and the report to change together.</p>"
            + "<table><tr><th>Event</th><th>Count</th></tr>"
            + "".join(f"<tr><td>{_esc(k)}</td><td>{v:,}</td></tr>"
                      for k, v in unknown.items())
            + "</table></section>"
        )

    audience = ""
    if report.get("browsers") or report.get("systems") or report.get("locations"):
        parts = []
        for key, title in (("browsers", "Browsers"), ("systems", "Systems"),
                           ("locations", "Countries")):
            rows = [(r.get("name", r.get("id", "?")), r.get("count", 0))
                    for r in report.get(key, [])]
            parts.append(_table_section(
                title, rows, title[:-1] if title.endswith("s") else title, "Count"))
        audience = f'<div class="grid2">{"".join(parts)}</div>'

    top = ""
    if report.get("top_events"):
        top += _table_section(
            "Top events", [(e["event_type"], e["cnt"]) for e in report["top_events"]],
            "Event", "Count", limit=30,
        )
    if report.get("top_pages"):
        top += _table_section(
            "Top pages", [(p["path"] or "/", p["cnt"]) for p in report["top_pages"]],
            "Path", "Visitors", limit=15,
        )

    html = (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width, initial-scale=1'>"
        "<title>Taisce — GoatCounter report</title>"
        f"<style>{STYLE}</style></head><body><div class='container'>"
        f"{header}"
        f"<div class='metrics'>{cards}</div>"
        f"{chart_html}"
        f"{tables}"
        f"{audience}"
        f"{top}"
        "<footer>Generated by <code>report/goatcounter-report.py</code>. "
        "GoatCounter: no cookies, no personal data. The demo is not counted.</footer>"
        "</div></body></html>"
    )

    out_html = os.path.join(out_dir, "index.html")
    with open(out_html, "w", encoding="utf-8") as f:
        f.write(html)
    return out_html


def generate_report(report, out_dir):
    charts_dir = os.path.join(out_dir, "charts")
    os.makedirs(charts_dir, exist_ok=True)

    charts = {
        "daily": _chart_daily(report, charts_dir),
        "engagement": _chart_engagement(report, charts_dir),
        "links": _chart_links(report, charts_dir),
        "releases": _chart_releases(report, charts_dir),
        "failures": _chart_failures(report, charts_dir),
    }
    html_path = generate_html(report, charts, out_dir)
    return html_path, charts


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    shadowed = load_dotenv_sh()
    if shadowed:
        print("⚠ Values already set in the environment override .env.sh; ignoring:")
        for key in shadowed:
            print(f"    {key} — unset it or run with `env -u {key} ...` to use .env.sh")
        print()

    parser = argparse.ArgumentParser(
        description="Generate a Taisce GoatCounter report with charts.",
    )
    parser.add_argument(
        "--site",
        default=os.getenv("GOAT_SITE", "https://taisce.goatcounter.com/"),
        help="GoatCounter site code (e.g. taisce) or full URL",
    )
    parser.add_argument("--start", help="Start date YYYY-MM-DD (default: today)")
    parser.add_argument("--end", help="End date YYYY-MM-DD (default: today)")
    parser.add_argument(
        "--period",
        help=(
            "Friendly period: today, yesterday, this week, last week, this month, "
            "last month, this year, last year. Overrides --start/--end."
        ),
    )
    parser.add_argument(
        "--out", help="Output directory (default: reports/<timestamp>_<start>_<end>)"
    )
    args = parser.parse_args()

    if args.period:
        try:
            se = parse_period(args.period)
        except Exception as e:
            print(f"Error parsing --period: {e}", file=sys.stderr)
            sys.exit(2)
        args.start, args.end = se

    def _validate(label, val):
        if not val:
            return None
        try:
            return dt.datetime.strptime(val, "%Y-%m-%d").date()
        except ValueError:
            print(f"Invalid --{label} date '{val}'. Expected YYYY-MM-DD.", file=sys.stderr)
            sys.exit(2)

    start_date = _validate("start", args.start) or _validate("start", os.getenv("GOAT_START"))
    end_date = _validate("end", args.end) or _validate("end", os.getenv("GOAT_END"))
    today = dt.date.today()
    start_date = start_date or today
    end_date = end_date or today
    args.start, args.end = start_date.isoformat(), end_date.isoformat()

    print(f"Fetching stats for {args.site}: {args.start} → {args.end} ...")
    data = fetch_stats_data(args.site, args.start, args.end)
    report = build_report(args.site, args.start, args.end, data)

    if args.out:
        out_dir = os.path.abspath(args.out)
    else:
        timestamp = dt.datetime.now().strftime("%Y-%m-%dT%H%M%S")
        out_dir = os.path.join(PROJECT_ROOT, "reports", f"{timestamp}_{args.start}_{args.end}")
    os.makedirs(out_dir, exist_ok=True)

    with open(os.path.join(out_dir, "data.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    print(short_summary(report))
    if not (HAVE_PANDAS and HAVE_MPL):
        print("  note: pandas/matplotlib not available — writing HTML without charts")
    if report["unknown_events"]:
        print("  ⚠ events this script does not know (add them to its vocabulary): "
              + ", ".join(report["unknown_events"]))

    html_path, charts = generate_report(report, out_dir)
    made = [k for k, v in charts.items() if v]
    print(f"Report saved to: {out_dir}/")
    print("  index.html  (self-contained)")
    print("  data.json   (raw data)")
    print(f"  charts/     ({', '.join(made) if made else 'none'})")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)
