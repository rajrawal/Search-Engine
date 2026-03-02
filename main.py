"""
main.py  –  FastAPI backend for PDF Search
------------------------------------------
Endpoints:
  POST  /api/upload          Upload one or more PDF files
  GET   /api/search          Full-text + semantic search
  GET   /api/documents       List all stored documents
  DELETE /api/documents/{id} Remove a document
"""

from __future__ import annotations

import io
import os
import logging
from contextlib import asynccontextmanager
from typing import List, Optional

import pdfplumber
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

load_dotenv()

# ─── Config ──────────────────────────────────────────────────────────────────
DATABASE_URL    = os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:password@localhost:5432/pdf_search")
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# ─── Database ─────────────────────────────────────────────────────────────────
engine = create_async_engine(DATABASE_URL, echo=False, pool_size=10, max_overflow=20)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session

# ─── Embedding model (loaded once at startup) ─────────────────────────────────
embedder: SentenceTransformer | None = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global embedder
    log.info(f"Loading embedding model: {EMBEDDING_MODEL} …")
    embedder = SentenceTransformer(EMBEDDING_MODEL)
    log.info("Embedding model ready.")
    yield
    await engine.dispose()

# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(title="PDF Search API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Pydantic schemas ─────────────────────────────────────────────────────────
class DocumentOut(BaseModel):
    id: int
    filename: str
    file_size: int
    upload_date: str
    content_preview: str  # first 300 chars

class SearchResult(BaseModel):
    id: int
    filename: str
    upload_date: str
    snippet: str          # highlighted excerpt
    score: float
    search_type: str      # "fts" | "semantic" | "hybrid"

class UploadResponse(BaseModel):
    uploaded: List[DocumentOut]
    errors: List[str]

# ─── Helpers ──────────────────────────────────────────────────────────────────
def extract_text(file_bytes: bytes) -> str:
    """Extract all text from a PDF byte blob using pdfplumber."""
    text_parts = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            t = page.extract_text()
            if t:
                text_parts.append(t)
    return "\n".join(text_parts).strip()

def embed(text: str) -> list[float]:
    """Return a 384-dim embedding for the given text."""
    return embedder.encode(text, normalize_embeddings=True).tolist()

def make_snippet(content: str, query: str, window: int = 200) -> str:
    """Return a snippet of `content` centred around the first query term."""
    if not content:
        return ""
    lower = content.lower()
    pos = lower.find(query.lower().split()[0]) if query else -1
    if pos == -1:
        return content[:window] + ("…" if len(content) > window else "")
    start = max(0, pos - window // 2)
    end   = min(len(content), pos + window // 2)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(content) else ""
    return prefix + content[start:end] + suffix

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.post("/api/upload", response_model=UploadResponse)
async def upload_pdfs(files: List[UploadFile] = File(...)):
    """
    Accept one or more PDF files, extract text, generate embeddings,
    and persist everything to PostgreSQL.
    """
    uploaded, errors = [], []

    async with AsyncSessionLocal() as db:
        for file in files:
            try:
                if not file.filename.lower().endswith(".pdf"):
                    errors.append(f"{file.filename}: not a PDF")
                    continue

                raw = await file.read()
                content = extract_text(raw)

                if not content:
                    errors.append(f"{file.filename}: could not extract text (scanned/image PDF?)")
                    content = ""  # still store metadata

                embedding_vec = embed(content) if content else None

                row = await db.execute(
                    text("""
                        INSERT INTO documents (filename, file_size, content, embedding)
                        VALUES (:filename, :file_size, :content, :embedding)
                        RETURNING id, filename, file_size, upload_date, content
                    """),
                    {
                        "filename":  file.filename,
                        "file_size": len(raw),
                        "content":   content,
                        "embedding": str(embedding_vec) if embedding_vec else None,
                    }
                )
                await db.commit()
                record = row.fetchone()

                uploaded.append(DocumentOut(
                    id=record.id,
                    filename=record.filename,
                    file_size=record.file_size,
                    upload_date=record.upload_date.isoformat(),
                    content_preview=(record.content or "")[:300],
                ))

            except Exception as e:
                log.exception(f"Error processing {file.filename}")
                errors.append(f"{file.filename}: {str(e)}")
                await db.rollback()

    return UploadResponse(uploaded=uploaded, errors=errors)


@app.get("/api/search", response_model=List[SearchResult])
async def search(
    q: str = Query(..., min_length=1, description="Search query"),
    mode: str = Query("hybrid", description="fts | semantic | hybrid"),
    limit: int = Query(10, ge=1, le=50),
):
    """
    Search documents using full-text search, semantic (vector) search, or both.

    - fts:      PostgreSQL tsvector / plainto_tsquery
    - semantic: pgvector cosine similarity
    - hybrid:   RRF-fused ranking of both
    """
    results: list[SearchResult] = []

    async with AsyncSessionLocal() as db:

        if mode == "fts":
            rows = await db.execute(text("""
                SELECT id, filename, upload_date, content,
                       ts_rank_cd(content_tsv, plainto_tsquery('english', :q)) AS score
                FROM   documents
                WHERE  content_tsv @@ plainto_tsquery('english', :q)
                ORDER  BY score DESC
                LIMIT  :limit
            """), {"q": q, "limit": limit})

            for r in rows.fetchall():
                results.append(SearchResult(
                    id=r.id, filename=r.filename,
                    upload_date=r.upload_date.isoformat(),
                    snippet=make_snippet(r.content, q),
                    score=float(r.score), search_type="fts",
                ))

        elif mode == "semantic":
            q_vec = str(embed(q))
            rows = await db.execute(text("""
                SELECT id, filename, upload_date, content,
                       1 - (embedding <=> :q_vec::vector) AS score
                FROM   documents
                WHERE  embedding IS NOT NULL
                ORDER  BY embedding <=> :q_vec::vector
                LIMIT  :limit
            """), {"q_vec": q_vec, "limit": limit})

            for r in rows.fetchall():
                results.append(SearchResult(
                    id=r.id, filename=r.filename,
                    upload_date=r.upload_date.isoformat(),
                    snippet=make_snippet(r.content, q),
                    score=float(r.score), search_type="semantic",
                ))

        else:  # hybrid – Reciprocal Rank Fusion
            q_vec = str(embed(q))
            rows = await db.execute(text("""
                WITH fts AS (
                    SELECT id,
                           ROW_NUMBER() OVER (ORDER BY ts_rank_cd(content_tsv,
                               plainto_tsquery('english', :q)) DESC) AS rank
                    FROM documents
                    WHERE content_tsv @@ plainto_tsquery('english', :q)
                    LIMIT 50
                ),
                sem AS (
                    SELECT id,
                           ROW_NUMBER() OVER (ORDER BY embedding <=> :q_vec::vector) AS rank
                    FROM documents
                    WHERE embedding IS NOT NULL
                    LIMIT 50
                ),
                rrf AS (
                    SELECT COALESCE(fts.id, sem.id) AS id,
                           COALESCE(1.0/(60 + fts.rank), 0) +
                           COALESCE(1.0/(60 + sem.rank), 0) AS rrf_score
                    FROM fts
                    FULL OUTER JOIN sem ON fts.id = sem.id
                )
                SELECT d.id, d.filename, d.upload_date, d.content, rrf.rrf_score AS score
                FROM rrf
                JOIN documents d ON d.id = rrf.id
                ORDER BY rrf.rrf_score DESC
                LIMIT :limit
            """), {"q": q, "q_vec": q_vec, "limit": limit})

            for r in rows.fetchall():
                results.append(SearchResult(
                    id=r.id, filename=r.filename,
                    upload_date=r.upload_date.isoformat(),
                    snippet=make_snippet(r.content, q),
                    score=float(r.score), search_type="hybrid",
                ))

    return results


@app.get("/api/documents", response_model=List[DocumentOut])
async def list_documents():
    """Return all stored documents (metadata only)."""
    async with AsyncSessionLocal() as db:
        rows = await db.execute(text(
            "SELECT id, filename, file_size, upload_date, content "
            "FROM documents ORDER BY upload_date DESC"
        ))
        return [
            DocumentOut(
                id=r.id, filename=r.filename, file_size=r.file_size,
                upload_date=r.upload_date.isoformat(),
                content_preview=(r.content or "")[:300],
            )
            for r in rows.fetchall()
        ]


@app.delete("/api/documents/{doc_id}")
async def delete_document(doc_id: int):
    """Delete a document and its embedding from the database."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("DELETE FROM documents WHERE id = :id RETURNING id"),
            {"id": doc_id}
        )
        await db.commit()
        if not result.fetchone():
            raise HTTPException(status_code=404, detail="Document not found")
    return {"deleted": doc_id}


@app.get("/api/health")
async def health():
    return {"status": "ok"}
