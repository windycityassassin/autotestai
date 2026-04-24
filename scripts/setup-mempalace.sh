#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$PROJECT_ROOT/.venv"

if [ -d "$VENV" ]; then
  echo "[setup-mempalace] .venv already exists — skipping setup."
  exit 0
fi

echo "[setup-mempalace] Creating Python virtual environment at $VENV..."
python3 -m venv "$VENV"

echo "[setup-mempalace] Installing MemPalace and dependencies..."
"$VENV/bin/pip" install --upgrade pip --quiet

"$VENV/bin/pip" install chromadb fastapi uvicorn --quiet

mkdir -p "$PROJECT_ROOT/.chromadb"

cat > "$VENV/bin/mempalace-server.py" << 'PYEOF'
"""Minimal MemPalace-compatible semantic memory HTTP server backed by ChromaDB."""
import argparse
import json
import os
import sys
import chromadb
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import uvicorn

app = FastAPI(title="MemPalace")
_client = None
_collection = None

def get_collection(chroma_path: str):
    global _client, _collection
    if _collection is None:
        _client = chromadb.PersistentClient(path=chroma_path)
        _collection = _client.get_or_create_collection(
            name="mempalace",
            metadata={"hnsw:space": "cosine"},
        )
    return _collection

CHROMA_PATH = os.environ.get("MEMPALACE_CHROMA_PATH", ".chromadb")

@app.post("/store")
async def store(request: Request):
    body = await request.json()
    doc_id = body["id"]
    document = body["document"]
    metadata = body.get("metadata", {})
    col = get_collection(CHROMA_PATH)
    col.upsert(ids=[doc_id], documents=[document], metadatas=[metadata])
    return JSONResponse({"ok": True})

@app.post("/search")
async def search(request: Request):
    body = await request.json()
    query = body["query"]
    n_results = body.get("n_results", 5)
    where = body.get("where")
    col = get_collection(CHROMA_PATH)
    count = col.count()
    if count == 0:
        return JSONResponse({"results": []})
    actual_n = min(n_results, count)
    kwargs = {"query_texts": [query], "n_results": actual_n}
    if where:
        kwargs["where"] = where
    try:
        results = col.query(**kwargs)
    except Exception:
        results = col.query(query_texts=[query], n_results=actual_n)
    out = []
    docs = results.get("documents", [[]])[0]
    metas = results.get("metadatas", [[]])[0]
    distances = results.get("distances", [[]])[0]
    for doc, meta, dist in zip(docs, metas, distances):
        out.append({"document": doc, "metadata": meta, "distance": dist})
    return JSONResponse({"results": out})

@app.get("/health")
async def health():
    return JSONResponse({"status": "ok"})

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7438)
    parser.add_argument("--chroma-path", default=".chromadb")
    args = parser.parse_args()
    CHROMA_PATH = args.chroma_path
    os.makedirs(CHROMA_PATH, exist_ok=True)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
PYEOF

chmod +x "$VENV/bin/mempalace-server.py"

echo "[setup-mempalace] MemPalace setup complete."
echo "  Chroma DB path: $PROJECT_ROOT/.chromadb"
echo "  Start with: $VENV/bin/python $VENV/bin/mempalace-server.py --chroma-path $PROJECT_ROOT/.chromadb"
