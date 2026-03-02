-- ============================================================
--  init.sql  –  run once to set up your database
--  psql -U postgres -d your_db_name -f init.sql
-- ============================================================

-- 1. Extensions
CREATE EXTENSION IF NOT EXISTS vector;       -- pgvector (semantic search)
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- trigram similarity (fuzzy match)

-- 2. Documents table
CREATE TABLE IF NOT EXISTS documents (
    id           SERIAL PRIMARY KEY,
    filename     VARCHAR(255)  NOT NULL,
    file_size    INTEGER       NOT NULL,          -- bytes
    upload_date  TIMESTAMPTZ   DEFAULT NOW(),
    content      TEXT,                            -- full extracted PDF text

    -- Full-text search: auto-updated tsvector column (PostgreSQL 12+)
    content_tsv  TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('english', COALESCE(content, ''))
    ) STORED,

    -- Semantic search: 384-dim embeddings (all-MiniLM-L6-v2)
    embedding    VECTOR(384)
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_documents_fts
    ON documents USING GIN (content_tsv);

-- IVFFlat index for approximate nearest-neighbour (cosine distance).
-- Requires at least ~100 rows to be useful; safe to create early.
CREATE INDEX IF NOT EXISTS idx_documents_embedding
    ON documents USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- ============================================================
--  Verification
-- ============================================================
SELECT 'Database initialised successfully.' AS status;
