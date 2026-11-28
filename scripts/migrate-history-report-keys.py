#!/usr/bin/env python3
"""One-off migration: attribute existing daily_snapshots rows to their report.

History used to be keyed by account name alone, but account names are not
unique across reports — Report A and Mum Report both have a TFSA — so their
snapshots landed in one mixed series (the TFSA chart flipped between the two
portfolios: holdings appearing and vanishing, nonsense totals). The app now
keys history by (report, account); this script backfills the `report` column
on rows written before that change.

Attribution:
  - Accounts whose name belongs to exactly one report are mapped by name.
  - TFSA rows are attributed by their snapshot's ticker fingerprint:
    Report A's TFSA holds XDIV.TO + XEF.TO + XEU.TO; Mum's TFSA holds only
    VDY.TO (plus the synthetic Cash row). A TFSA row matching neither
    fingerprint is left unattributed (report '') and listed, never guessed —
    unattributed rows are simply not shown by the new code.

Run it ONCE on the mini, with the server stopped, after pulling the
report-key change:

    pm2 stop portfolio-tracker
    python3 scripts/migrate-history-report-keys.py
    pm2 start portfolio-tracker

It backs the database up first (data/portfolio.db.backup-<timestamp>) and is
safe to re-run: only rows still at report '' are touched.
"""

import json
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

DB_PATH = Path(sys.argv[1] if len(sys.argv) > 1 else "data/portfolio.db")

# Account names that belong to exactly one report.
ACCOUNT_REPORT = {
    "RSP": "report-a",
    "LIRA": "report-a",
    "Registered-1": "report-b",
    "Registered-2": "report-b",
    "Registered-3": "report-b",
    "Registered-4": "report-b",
    "Non-registered": "report-b",
    "CAD Margin": "mum-report",
    "RIF": "mum-report",
}


def tickers_of(snapshot_json: str) -> set:
    try:
        holdings = json.loads(snapshot_json)
    except (TypeError, json.JSONDecodeError):
        return set()
    return {str(h.get("displayTicker") or h.get("ticker")) for h in holdings}


def main() -> None:
    if not DB_PATH.exists():
        sys.exit(f"No database found at {DB_PATH}")

    stamp = datetime.now().strftime("%Y%m%dT%H%M%S")
    backup = DB_PATH.with_name(f"{DB_PATH.name}.backup-{stamp}")
    shutil.copy2(DB_PATH, backup)
    print(f"Backup written: {backup}")

    db = sqlite3.connect(DB_PATH)
    cols = [row[1] for row in db.execute("PRAGMA table_info(daily_snapshots)")]
    if "report" not in cols:
        db.execute(
            "ALTER TABLE daily_snapshots ADD COLUMN report TEXT NOT NULL DEFAULT ''"
        )
        print("Added the report column.")

    total = db.execute("SELECT COUNT(*) FROM daily_snapshots").fetchone()[0]
    pending = db.execute(
        "SELECT COUNT(*) FROM daily_snapshots WHERE report = ''"
    ).fetchone()[0]
    print(f"Rows: {total} total, {pending} unattributed.")

    # 1) Accounts unique to one report, by name.
    for account, report in ACCOUNT_REPORT.items():
        cur = db.execute(
            "UPDATE daily_snapshots SET report = ? WHERE account_name = ? AND report = ''",
            (report, account),
        )
        if cur.rowcount:
            print(f"  {account}: {cur.rowcount} rows -> {report}")

    # 2) TFSA rows, by snapshot fingerprint.
    tfsa_rows = db.execute(
        "SELECT id, snapshot FROM daily_snapshots "
        "WHERE account_name = 'TFSA' AND report = ''"
    ).fetchall()
    attributed = {"report-a": 0, "mum-report": 0}
    unknown = []
    for row_id, snap in tfsa_rows:
        tickers = tickers_of(snap)
        if {"XDIV.TO", "XEF.TO", "XEU.TO"} <= tickers:
            report = "report-a"
        elif tickers <= {"Cash", "CASH", "VDY.TO"} and "VDY.TO" in tickers:
            report = "mum-report"
        else:
            unknown.append((row_id, sorted(tickers)))
            continue
        db.execute(
            "UPDATE daily_snapshots SET report = ? WHERE id = ?", (report, row_id)
        )
        attributed[report] += 1
    print(
        f"  TFSA: {attributed['report-a']} rows -> report-a, "
        f"{attributed['mum-report']} rows -> mum-report, "
        f"{len(unknown)} left unattributed"
    )
    for row_id, tickers in unknown:
        print(f"    ! row {row_id} matches neither TFSA fingerprint: {tickers}")

    # 3) Anything else still unattributed (unknown account names, etc.).
    leftovers = db.execute(
        "SELECT account_name, COUNT(*) FROM daily_snapshots "
        "WHERE report = '' GROUP BY account_name"
    ).fetchall()
    for account, count in leftovers:
        print(f"  ! {account}: {count} rows still unattributed")

    db.commit()

    # Verification: per-report counts, and Report A TFSA's XDIV series should
    # now be a clean share-count progression with no vanish/reappear flips.
    print("\nRows by (account, report):")
    for account, report, count in db.execute(
        "SELECT account_name, report, COUNT(*) FROM daily_snapshots "
        "GROUP BY account_name, report ORDER BY account_name, report"
    ):
        print(f"  {account} / {report or '(none)'}: {count}")

    print("\nReport A TFSA — XDIV share changes (expect small DRIP steps only):")
    prev = None
    for date, snap in db.execute(
        "SELECT date, snapshot FROM daily_snapshots "
        "WHERE account_name = 'TFSA' AND report = 'report-a' ORDER BY date, id"
    ):
        xdiv = next(
            (
                h["shares"]
                for h in json.loads(snap)
                if "XDIV" in str(h.get("displayTicker") or h.get("ticker"))
            ),
            None,
        )
        if xdiv != prev:
            print(f"  {date} -> {xdiv}")
        prev = xdiv

    db.close()
    print("\nDone. Start the server again: pm2 start portfolio-tracker")


if __name__ == "__main__":
    main()
