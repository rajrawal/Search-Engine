import { useState, useRef, useEffect } from "react";

const API = "http://localhost:8000/api";

// ── Icons ────────────────────────────────────────────────────
const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
  </svg>
);
const UploadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
);
const FileIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
  </svg>
);
const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
  </svg>
);
const XIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const ChevronDown = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);

const Spinner = ({ size = 14 }) => (
  <span style={{
    width: size, height: size, border: `2px solid rgba(12,12,15,0.3)`,
    borderTopColor: "#0c0c0f", borderRadius: "50%", display: "inline-block",
    animation: "spin 0.7s linear infinite", flexShrink: 0,
  }} />
);

const formatSize = (b) => b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(1)} MB`;
const formatDate = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const modeLabel  = { fts: "Full-text", semantic: "Semantic", hybrid: "Hybrid" };
const modeBadge  = { fts: "#4e9af1", semantic: "#a78bfa", hybrid: "#f5a623" };

// ── Main App ─────────────────────────────────────────────────
export default function App() {
  const [query, setQuery]           = useState("");
  const [searchMode, setSearchMode] = useState("hybrid");
  const [modeOpen, setModeOpen]     = useState(false);

  const [pendingFiles, setPendingFiles] = useState([]);
  const [isDragging, setIsDragging]     = useState(false);
  const [uploadState, setUploadState]   = useState("idle");

  const [searchState, setSearchState] = useState("idle");
  const [results, setResults]         = useState([]);

  const [dbDocs, setDbDocs]         = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);

  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => { loadDocuments(); }, []);

  const showToast = (msg, type = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadDocuments = async () => {
    setDocsLoading(true);
    try {
      const res = await fetch(`${API}/documents`);
      if (!res.ok) throw new Error();
      setDbDocs(await res.json());
    } catch { /* backend may not be running */ }
    finally { setDocsLoading(false); }
  };

  const stageFiles = (files) => {
    const pdfs = Array.from(files).filter(f => f.type === "application/pdf");
    const bad  = Array.from(files).length - pdfs.length;
    if (bad) showToast(`${bad} non-PDF file(s) skipped`, "warn");
    if (!pdfs.length) return;
    setPendingFiles(prev => [...prev, ...pdfs.map(f => ({ file: f, id: crypto.randomUUID() }))]);
  };

  const handleDrop = (e) => {
    e.preventDefault(); setIsDragging(false);
    stageFiles(e.dataTransfer.files);
  };

  const handleUpload = async () => {
    if (!pendingFiles.length) return;
    setUploadState("uploading");
    const form = new FormData();
    pendingFiles.forEach(({ file }) => form.append("files", file));
    try {
      const res  = await fetch(`${API}/upload`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      if (data.uploaded.length) {
        showToast(`✓ ${data.uploaded.length} file(s) stored in PostgreSQL`, "success");
        setPendingFiles([]);
        await loadDocuments();
      }
      if (data.errors.length) showToast(`⚠ ${data.errors[0]}`, "warn");
      setUploadState("done");
    } catch (err) {
      showToast(`Upload failed: ${err.message}`, "error");
      setUploadState("error");
    }
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearchState("searching"); setResults([]);
    try {
      const res  = await fetch(`${API}/search?q=${encodeURIComponent(query)}&mode=${searchMode}&limit=10`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setResults(data); setSearchState("done");
    } catch (err) {
      showToast(`Search failed: ${err.message}`, "error");
      setSearchState("error");
    }
  };

  const handleDelete = async (id) => {
    try {
      const res = await fetch(`${API}/documents/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setDbDocs(prev  => prev.filter(d => d.id !== id));
      setResults(prev => prev.filter(r => r.id !== id));
      showToast("Document removed", "info");
    } catch { showToast("Failed to delete document", "error"); }
  };

  const toastColors = { success:"#22c55e", warn:"#f5a623", error:"#ef4444", info:"#4e9af1" };

  return (
    <div style={{ minHeight:"100vh",background:"#0c0c0f",display:"flex",flexDirection:"column",alignItems:"center",fontFamily:"'Georgia','Times New Roman',serif",padding:"2rem 1rem",position:"relative",overflow:"hidden" }}>

      {/* Ambient glows */}
      <div style={{ position:"absolute",inset:0,pointerEvents:"none",background:"radial-gradient(ellipse 80% 50% at 50% 0%,rgba(255,180,50,0.07) 0%,transparent 70%)" }}/>
      <div style={{ position:"absolute",top:"10%",left:"8%",width:300,height:300,borderRadius:"50%",background:"rgba(255,150,30,0.04)",filter:"blur(80px)",pointerEvents:"none" }}/>
      <div style={{ position:"absolute",bottom:"15%",right:"10%",width:250,height:250,borderRadius:"50%",background:"rgba(180,100,255,0.04)",filter:"blur(80px)",pointerEvents:"none" }}/>

      {/* Toast */}
      {toast && (
        <div style={{ position:"fixed",top:"1.5rem",right:"1.5rem",zIndex:999,background:"rgba(20,20,24,0.97)",border:`1px solid ${toastColors[toast.type]}40`,borderLeft:`3px solid ${toastColors[toast.type]}`,borderRadius:"10px",padding:"0.75rem 1.1rem",color:"#f0ece4",fontSize:"0.85rem",maxWidth:340,boxShadow:"0 20px 40px rgba(0,0,0,0.5)",animation:"fadeIn 0.2s ease" }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ textAlign:"center",marginBottom:"2.5rem" }}>
        <div style={{ display:"inline-flex",alignItems:"center",gap:"0.5rem",background:"rgba(255,165,50,0.1)",border:"1px solid rgba(255,165,50,0.25)",borderRadius:"100px",padding:"0.3rem 1rem",marginBottom:"1.25rem" }}>
          <span style={{ width:6,height:6,borderRadius:"50%",background:"#f5a623",display:"inline-block" }}/>
          <span style={{ color:"#f5a623",fontSize:"0.72rem",letterSpacing:"0.12em",textTransform:"uppercase" }}>PDF Intelligence · PostgreSQL</span>
        </div>
        <h1 style={{ margin:0,fontSize:"clamp(1.8rem,4vw,3rem)",fontWeight:400,color:"#f0ece4",letterSpacing:"-0.02em",lineHeight:1.1 }}>
          Search your documents
        </h1>
        <p style={{ marginTop:"0.6rem",color:"rgba(240,236,228,0.4)",fontSize:"0.95rem",fontStyle:"italic",fontWeight:300 }}>
          Upload PDFs · Store in PostgreSQL · FTS + pgvector semantic search
        </p>
      </div>

      <div style={{ width:"100%",maxWidth:700,display:"flex",flexDirection:"column",gap:"1.25rem" }}>

        {/* ─── Search panel ─── */}
        <div style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"20px",padding:"1.75rem",backdropFilter:"blur(12px)",boxShadow:"0 40px 80px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.05)" }}>

          {/* Bar */}
          <div style={{ display:"flex",alignItems:"center",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:"12px",overflow:"hidden" }}>
            <div style={{ padding:"0 0.9rem",color:"rgba(240,236,228,0.3)",flexShrink:0 }}><SearchIcon /></div>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              placeholder="Ask anything about your documents…"
              style={{ flex:1,border:"none",outline:"none",background:"transparent",color:"#f0ece4",fontSize:"0.97rem",padding:"0.95rem 0",fontFamily:"inherit" }}
            />

            {/* Mode dropdown */}
            <div style={{ position:"relative",flexShrink:0 }}>
              <button onClick={() => setModeOpen(o => !o)} style={{ display:"flex",alignItems:"center",gap:"0.4rem",background:"rgba(255,255,255,0.05)",border:"none",borderLeft:"1px solid rgba(255,255,255,0.1)",color:"rgba(240,236,228,0.6)",padding:"0.95rem 0.9rem",cursor:"pointer",fontFamily:"inherit",fontSize:"0.78rem",letterSpacing:"0.04em" }}>
                <span style={{ color:modeBadge[searchMode],fontSize:"0.7rem" }}>●</span>
                {modeLabel[searchMode]}
                <ChevronDown />
              </button>
              {modeOpen && (
                <div style={{ position:"absolute",right:0,top:"calc(100% + 4px)",background:"rgba(20,20,24,0.98)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"10px",overflow:"hidden",zIndex:10,minWidth:140,boxShadow:"0 20px 40px rgba(0,0,0,0.5)" }}>
                  {["hybrid","fts","semantic"].map(m => (
                    <button key={m} onClick={() => { setSearchMode(m); setModeOpen(false); }} style={{ display:"flex",alignItems:"center",gap:"0.6rem",width:"100%",background: m === searchMode ? "rgba(255,255,255,0.06)" : "transparent",border:"none",color:"#f0ece4",padding:"0.7rem 1rem",cursor:"pointer",fontFamily:"inherit",fontSize:"0.83rem",textAlign:"left" }}>
                      <span style={{ color:modeBadge[m],fontSize:"0.65rem" }}>●</span>
                      {modeLabel[m]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Search button */}
            <button onClick={handleSearch} disabled={searchState === "searching"} style={{ display:"flex",alignItems:"center",gap:"0.5rem",background: searchState === "searching" ? "rgba(245,166,35,0.6)" : "linear-gradient(135deg,#f5a623 0%,#f07b20 100%)",border:"none",color:"#0c0c0f",padding:"0.95rem 1.3rem",cursor: searchState === "searching" ? "default":"pointer",fontFamily:"inherit",fontWeight:700,fontSize:"0.85rem",letterSpacing:"0.04em",flexShrink:0,minWidth:95,justifyContent:"center",transition:"all 0.2s" }}>
              {searchState === "searching" ? <><Spinner />Searching</> : "Search"}
            </button>
          </div>

          {/* No results */}
          {searchState === "done" && results.length === 0 && (
            <div style={{ marginTop:"1rem",padding:"1rem",background:"rgba(255,255,255,0.03)",borderRadius:"10px",color:"rgba(240,236,228,0.4)",fontSize:"0.875rem",textAlign:"center" }}>
              No results found — try a different query or search mode.
            </div>
          )}

          {/* Results */}
          {results.length > 0 && (
            <div style={{ marginTop:"1rem",display:"flex",flexDirection:"column",gap:"0.6rem" }}>
              {results.map((r, i) => (
                <div key={r.id} style={{ padding:"1rem 1.1rem",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"12px",animation:`fadeIn 0.25s ease ${i*0.05}s both` }}>
                  <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"0.4rem" }}>
                    <div style={{ display:"flex",alignItems:"center",gap:"0.6rem" }}>
                      <span style={{ color:"#f5a623" }}><FileIcon /></span>
                      <span style={{ color:"#f0ece4",fontSize:"0.875rem",fontWeight:600 }}>{r.filename}</span>
                    </div>
                    <div style={{ display:"flex",alignItems:"center",gap:"0.6rem" }}>
                      <span style={{ background:`${modeBadge[r.search_type]}18`,border:`1px solid ${modeBadge[r.search_type]}40`,color:modeBadge[r.search_type],fontSize:"0.65rem",padding:"0.2rem 0.5rem",borderRadius:"100px",letterSpacing:"0.06em",textTransform:"uppercase" }}>
                        {modeLabel[r.search_type]}
                      </span>
                      <span style={{ color:"rgba(240,236,228,0.3)",fontSize:"0.75rem" }}>{(r.score*100).toFixed(1)}%</span>
                    </div>
                  </div>
                  <p style={{ margin:"0 0 0.3rem",color:"rgba(240,236,228,0.55)",fontSize:"0.83rem",lineHeight:1.6,fontStyle:"italic" }}>{r.snippet}</p>
                  <span style={{ color:"rgba(240,236,228,0.25)",fontSize:"0.72rem" }}>{formatDate(r.upload_date)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ─── Upload panel ─── */}
        <div style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"20px",padding:"1.75rem",backdropFilter:"blur(12px)",boxShadow:"0 40px 80px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.05)" }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.25rem" }}>
            <h2 style={{ margin:0,color:"#f0ece4",fontSize:"0.95rem",fontWeight:400,letterSpacing:"0.02em" }}>Upload PDFs</h2>
            {dbDocs.length > 0 && <span style={{ color:"rgba(240,236,228,0.35)",fontSize:"0.78rem" }}>{dbDocs.length} doc{dbDocs.length!==1?"s":""} in database</span>}
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{ border:`2px dashed ${isDragging?"rgba(245,166,35,0.7)":"rgba(255,255,255,0.1)"}`,borderRadius:"12px",padding:"1.5rem",textAlign:"center",cursor:"pointer",background: isDragging?"rgba(245,166,35,0.05)":"transparent",transition:"all 0.2s" }}
          >
            <div style={{ display:"inline-flex",alignItems:"center",justifyContent:"center",width:40,height:40,borderRadius:"10px",background:"rgba(245,166,35,0.1)",marginBottom:"0.6rem",color:"#f5a623" }}><UploadIcon /></div>
            <p style={{ margin:0,color:"#f0ece4",fontSize:"0.875rem" }}>Drop PDFs here or <span style={{ color:"#f5a623",textDecoration:"underline" }}>browse</span></p>
            <input ref={fileInputRef} type="file" accept=".pdf" multiple style={{ display:"none" }} onChange={e => stageFiles(e.target.files)} />
          </div>

          {/* Staged files */}
          {pendingFiles.length > 0 && (
            <div style={{ marginTop:"0.9rem",display:"flex",flexDirection:"column",gap:"0.4rem" }}>
              {pendingFiles.map(({ file, id }) => (
                <div key={id} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0.6rem 0.85rem",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"9px",animation:"fadeIn 0.2s ease" }}>
                  <div style={{ display:"flex",alignItems:"center",gap:"0.6rem" }}>
                    <span style={{ color:"#f5a623" }}><FileIcon /></span>
                    <span style={{ color:"#f0ece4",fontSize:"0.83rem" }}>{file.name}</span>
                  </div>
                  <div style={{ display:"flex",alignItems:"center",gap:"0.7rem" }}>
                    <span style={{ color:"rgba(240,236,228,0.3)",fontSize:"0.75rem" }}>{formatSize(file.size)}</span>
                    <button onClick={() => setPendingFiles(p => p.filter(f => f.id !== id))} style={{ background:"rgba(255,255,255,0.06)",border:"none",borderRadius:"6px",padding:"0.28rem",cursor:"pointer",color:"rgba(240,236,228,0.5)",display:"flex",alignItems:"center" }}><XIcon /></button>
                  </div>
                </div>
              ))}
              <button onClick={handleUpload} disabled={uploadState==="uploading"} style={{ marginTop:"0.25rem",width:"100%",padding:"0.8rem",background: uploadState==="uploading"?"rgba(245,166,35,0.6)":"linear-gradient(135deg,#f5a623 0%,#f07b20 100%)",border:"none",borderRadius:"10px",color:"#0c0c0f",fontFamily:"inherit",fontWeight:700,fontSize:"0.875rem",cursor: uploadState==="uploading"?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:"0.6rem" }}>
                {uploadState==="uploading" ? <><Spinner /> Uploading & indexing…</> : `Upload ${pendingFiles.length} file${pendingFiles.length!==1?"s":""} to PostgreSQL →`}
              </button>
            </div>
          )}

          {/* Stored docs list */}
          {dbDocs.length > 0 && (
            <div style={{ marginTop:"1.25rem" }}>
              <p style={{ margin:"0 0 0.6rem",color:"rgba(240,236,228,0.35)",fontSize:"0.75rem",letterSpacing:"0.08em",textTransform:"uppercase" }}>Stored in database</p>
              <div style={{ display:"flex",flexDirection:"column",gap:"0.4rem",maxHeight:220,overflowY:"auto" }}>
                {docsLoading
                  ? <div style={{ color:"rgba(240,236,228,0.3)",fontSize:"0.83rem",padding:"0.5rem" }}>Loading…</div>
                  : dbDocs.map(doc => (
                    <div key={doc.id} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0.6rem 0.85rem",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:"9px" }}>
                      <div style={{ display:"flex",alignItems:"center",gap:"0.6rem",minWidth:0 }}>
                        <span style={{ color:"rgba(245,166,35,0.6)" }}><FileIcon /></span>
                        <div style={{ minWidth:0 }}>
                          <p style={{ margin:0,color:"rgba(240,236,228,0.8)",fontSize:"0.82rem",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{doc.filename}</p>
                          <p style={{ margin:0,color:"rgba(240,236,228,0.3)",fontSize:"0.72rem" }}>{formatSize(doc.file_size)} · {formatDate(doc.upload_date)}</p>
                        </div>
                      </div>
                      <button onClick={() => handleDelete(doc.id)} style={{ background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:"6px",padding:"0.3rem 0.5rem",cursor:"pointer",color:"rgba(239,68,68,0.7)",display:"flex",alignItems:"center",flexShrink:0 }}>
                        <TrashIcon />
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <p style={{ marginTop:"2rem",color:"rgba(240,236,228,0.2)",fontSize:"0.72rem",letterSpacing:"0.08em",textTransform:"uppercase" }}>
        FastAPI · PostgreSQL · pgvector · sentence-transformers
      </p>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
        input::placeholder { color: rgba(240,236,228,0.25); }
        button:hover:not(:disabled) { opacity: 0.88; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
      `}</style>
    </div>
  );
}
