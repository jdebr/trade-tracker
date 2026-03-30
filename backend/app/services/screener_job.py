"""
In-memory job registry for async screener runs.

POST /screener/run returns immediately with a job_id.
The caller polls GET /screener/job/{job_id} until status is "done" or "error".

Jobs are stored in a fixed-size dict (MAX_JOBS entries); oldest entries are
evicted when the cap is reached so the registry never grows unbounded.

Public API:
    create_job()                    -> str  (job_id)
    set_running(job_id)
    set_done(job_id, result)
    set_error(job_id, message)
    get_job(job_id)                 -> dict | None
    JOB_STATUS_*                    constants
"""

import uuid
from collections import OrderedDict
from datetime import datetime, timezone

MAX_JOBS = 20

JOB_STATUS_PENDING = "pending"
JOB_STATUS_RUNNING = "running"
JOB_STATUS_DONE    = "done"
JOB_STATUS_ERROR   = "error"

# OrderedDict preserves insertion order so we can evict the oldest entry
_jobs: OrderedDict[str, dict] = OrderedDict()


def create_job() -> str:
    job_id = str(uuid.uuid4())
    if len(_jobs) >= MAX_JOBS:
        _jobs.popitem(last=False)   # evict oldest
    _jobs[job_id] = {
        "job_id":     job_id,
        "status":     JOB_STATUS_PENDING,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "started_at": None,
        "finished_at": None,
        "result":     None,
        "error":      None,
    }
    return job_id


def set_running(job_id: str) -> None:
    if job_id in _jobs:
        _jobs[job_id]["status"]     = JOB_STATUS_RUNNING
        _jobs[job_id]["started_at"] = datetime.now(timezone.utc).isoformat()


def set_done(job_id: str, result: dict) -> None:
    if job_id in _jobs:
        _jobs[job_id]["status"]      = JOB_STATUS_DONE
        _jobs[job_id]["finished_at"] = datetime.now(timezone.utc).isoformat()
        _jobs[job_id]["result"]      = result


def set_error(job_id: str, message: str) -> None:
    if job_id in _jobs:
        _jobs[job_id]["status"]      = JOB_STATUS_ERROR
        _jobs[job_id]["finished_at"] = datetime.now(timezone.utc).isoformat()
        _jobs[job_id]["error"]       = message


def get_job(job_id: str) -> dict | None:
    return _jobs.get(job_id)
