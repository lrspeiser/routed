import os, json
import requests

NOTIFY_URL = os.environ.get("NOTIFY_URL", "http://localhost:8080/v1/messages")
NOTIFY_KEY = os.environ.get("NOTIFY_API_KEY")

if NOTIFY_KEY is None:
    raise RuntimeError("Set NOTIFY_API_KEY in your environment")

def notify(topic: str, title: str, body: str, payload: dict | None = None, ttl_sec: int = 86400, dedupe_key: str | None = None):
    data = {
        "topic": topic,
        "title": title,
        "body": body,
        "payload": payload or {},
        "ttl_sec": ttl_sec,
        "dedupe_key": dedupe_key,
    }
    headers = {"Authorization": f"Bearer {NOTIFY_KEY}", "Content-Type": "application/json"}
    print(f"[NOTIFY] POST {NOTIFY_URL} topic={topic} ttl={ttl_sec}s")
    r = requests.post(NOTIFY_URL, headers=headers, data=json.dumps(data), timeout=10)
    r.raise_for_status()
    print(f"[NOTIFY] Accepted: {r.json()}")
