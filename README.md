# PDF Search – Setup Guide

## File structure

```
project/
├── backend/
│   ├── main.py            ← FastAPI app (all endpoints)
│   ├── requirements.txt
│   ├── init.sql           ← Run once to create DB schema
│   └── .env.example       ← Copy to .env and fill in values
└── frontend/
    └── document-search.jsx  ← React component (Vite / CRA)
```

---

## 1 – PostgreSQL prerequisites

Install pgvector (once per PostgreSQL installation):

```bash
# macOS (Homebrew)
brew install pgvector

# Ubuntu / Debian
sudo apt install postgresql-16-pgvector   # adjust version

# Or build from source: https://github.com/pgvector/pgvector
```

Create your database and run the schema:

```bash
createdb pdf_search
psql -U postgres -d pdf_search -f backend/init.sql
```

---

## 2 – Backend setup

```bash
cd backend

# Create & activate virtual environment
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env → set DATABASE_URL, e.g.:
# DATABASE_URL=postgresql+asyncpg://postgres:yourpassword@localhost:5432/pdf_search

# Start the server
uvicorn main:app --reload --port 8000
```

The API will be live at **http://localhost:8000**  
Interactive docs: **http://localhost:8000/docs**

> **Note:** On first startup, `sentence-transformers` will download the
> `all-MiniLM-L6-v2` model (~90 MB) automatically. Subsequent starts are instant.

---

## 3 – Frontend setup

The `document-search.jsx` component is a standalone React file. Drop it into
any React project (Vite recommended):

```bash
npm create vite@latest frontend -- --template react
cd frontend
npm install
# Copy document-search.jsx → src/App.jsx  (or import it)
npm run dev       # → http://localhost:5173
```

The API base URL is set at the top of the file:

```js
const API = "http://localhost:8000/api";
```

Change this if your backend runs on a different host/port.

---

## 4 – API endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/upload` | Upload PDFs (multipart/form-data) |
| GET | `/api/search?q=...&mode=hybrid` | Search documents |
| GET | `/api/documents` | List all stored documents |
| DELETE | `/api/documents/{id}` | Delete a document |
| GET | `/api/health` | Health check |

**Search modes:**
- `fts` — PostgreSQL full-text search (fast keyword matching)
- `semantic` — pgvector cosine similarity (meaning-based)
- `hybrid` — Reciprocal Rank Fusion of both (best results)

---

## 5 – Database schema overview

```sql
documents
├── id            SERIAL PRIMARY KEY
├── filename      VARCHAR(255)
├── file_size     INTEGER              -- bytes
├── upload_date   TIMESTAMPTZ
├── content       TEXT                 -- extracted PDF text
├── content_tsv   TSVECTOR (generated) -- FTS index
└── embedding     VECTOR(384)          -- semantic search
```

---

## Troubleshooting

**`could not open extension control file ... vector.control`**  
pgvector is not installed. See step 1.

**`Connection refused` on upload/search**  
Make sure `uvicorn main:app --reload` is running in the backend folder.

**Scanned PDF returns no text**  
pdfplumber can only extract text from PDFs with a text layer.
For scanned/image PDFs, add OCR with `pytesseract` or `easyocr`.

**Slow first search after restart**  
The embedding model is loaded lazily on the first request. Subsequent
calls are fast.
