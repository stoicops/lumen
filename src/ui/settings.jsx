import React, { useEffect, useState } from 'react';

export function Settings({ onClose }) {
  const [ghidraDir, setGhidraDir] = useState(''); const [javaHome, setJavaHome] = useState(''); const [saved, setSaved] = useState(false);
  const [diag, setDiag] = useState(null); const [checking, setChecking] = useState(false);
  useEffect(() => { window.studio.settings().then(s => { setGhidraDir(s.ghidraDir ?? ''); setJavaHome(s.javaHome ?? ''); }).catch(() => {}); }, []);
  const save = async () => { await window.studio.saveSettings({ ghidraDir, javaHome }); setSaved(true); setTimeout(() => setSaved(false), 1500); };
  const pick = async () => { const d = await window.studio.pickFolder(); if (d) setGhidraDir(d); };
  const check = async () => { setChecking(true); setDiag(null); try { await window.studio.saveSettings({ ghidraDir, javaHome }); setDiag(await window.studio.diagnoseEngine()); } catch (e) { setDiag({ ok: false, raw: e.message }); } finally { setChecking(false); } };
  return <div className="sheet-backdrop" onClick={onClose}><div className="sheet wide" role="dialog" aria-modal="true" aria-label="Settings" onClick={e => e.stopPropagation()}>
    <div className="card-head"><h3>Settings</h3><button className="link" onClick={onClose}>Close</button></div>
    <h4>Decompiler engine (for .exe, Mac apps and other native binaries)</h4>
    <p className="hint-text">Lumen reads JavaScript/Electron apps on its own. To decompile native binaries it uses <strong>Ghidra</strong>, a free open-source tool. Install it once, point Lumen here, and native analysis turns on.</p>
    <label>Ghidra install folder
      <div className="row-inline"><input value={ghidraDir} onChange={e => setGhidraDir(e.target.value)} placeholder="/Applications/ghidra_12.1.4_PUBLIC" /><button className="btn" onClick={pick}>Choose…</button></div>
    </label>
    <label>Java 21 home (optional — auto-detected on macOS)
      <div className="row-inline"><input value={javaHome} onChange={e => setJavaHome(e.target.value)} placeholder="Leave blank to auto-detect (/usr/libexec/java_home -v 21)" /><button className="btn" onClick={async () => { const d = await window.studio.pickFolder(); if (d) setJavaHome(d); }}>Choose…</button></div>
    </label>
    <details><summary>How to install Ghidra on this Mac (5 minutes)</summary>
      <ol className="plain">
        <li>Install Java 21: open Terminal and run <code>brew install --cask temurin@21</code> (or download Temurin 21 from adoptium.net).</li>
        <li>Download Ghidra 12.1.4 from <code>github.com/NationalSecurityAgency/ghidra/releases</code> — the file named <code>ghidra_12.1.4_PUBLIC_*.zip</code>.</li>
        <li>Unzip it (double-click). You’ll get a folder like <code>ghidra_12.1.4_PUBLIC</code>. Move it to Applications.</li>
        <li>Click “Choose…” above and select that folder.</li>
        <li>Click Save, then analyse a native app again.</li>
      </ol>
      <p className="hint-text">Lumen never bundles commercial tools. Ghidra is the supported free engine; Hopper/JEB also work if you already have them installed and set the matching folder.</p>
    </details>
    <div className="ask-actions"><button className="btn primary" onClick={save}>{saved ? 'Saved ✓' : 'Save'}</button><button className="btn" onClick={check} disabled={checking}>{checking ? 'Checking…' : 'Check engine'}</button></div>
    {diag && <div className={`diag ${diag.ghidra?.ok ? 'ok' : 'bad'}`}>
      {diag.ghidra?.ok ? <p><strong>Ghidra is ready.</strong> {diag.ghidra.detail || diag.ghidra.providerVersion ? `Version ${diag.ghidra.providerVersion ?? diag.ghidra.detail}.` : ''} Analyse a native file again to get functions and pseudocode.</p>
        : <p><strong>Ghidra not usable yet.</strong> {diag.ghidra?.detail ?? 'Not detected.'}{diag.ghidra?.remediation ? ` — ${diag.ghidra.remediation}` : ''}</p>}
      <p className="meta">Java in use: {diag.javaHome ?? 'none found — install Temurin 21 or set the Java home above'}</p>
      <details><summary>Full diagnostics</summary><pre className="raw">{diag.raw}</pre></details>
    </div>}
  </div></div>;
}
