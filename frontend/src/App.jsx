import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, AlertTriangle, CircleHelp, FileImage, LoaderCircle, Plus, RefreshCw, Sparkles, Trash2, Wifi, WifiOff } from 'lucide-react'
import XrayUpload from './components/XrayUpload.jsx'
import XrayViewer from './components/XrayViewer.jsx'
import DetectionResults from './components/DetectionResults.jsx'
import PdfReportButton from './components/PdfReportButton.jsx'
import STLViewer from './components/STLViewer.jsx'
import { analyzeImage, getHealth } from './services/api.js'

function Header({ health, healthError, checking, busy, onNew }) {
  const model = health?.model
  return (
    <header className="topbar">
      <a className="brand" href="#" aria-label="Dental workstation home">
        <span className="brand-mark"><Activity size={19} /></span>
        <span><strong>Dental AI</strong><small>IMAGING WORKSTATION</small></span>
      </a>
      <div className="topbar-center">RADIOGRAPH REVIEW <i /> LOCAL WORKSPACE</div>
      <div className="topbar-actions">
        <span className={`status-pill ${model?.complete ? 'is-ready' : 'is-warning'}`}>
          <i /> {checking ? 'Checking models' : model?.complete ? 'Models ready' : model?.available ? 'Models partial' : 'Models unavailable'}
        </span>
        <span className="api-state" title={health ? 'Backend connected' : healthError || 'Backend disconnected'}>
          {health ? <Wifi size={15} /> : <WifiOff size={15} />}<span>{health ? 'API connected' : checking ? 'Checking API' : 'API offline'}</span>
        </span>
        <button className="button button-accent" onClick={onNew} disabled={busy}><Plus size={15} /> New X-ray</button>
        <a className="icon-button" href="#clinical-notice" aria-label="Clinical notice"><CircleHelp size={17} /></a>
      </div>
    </header>
  )
}

function formatBytes(bytes) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export default function App() {
  const [health, setHealth] = useState(null)
  const [checking, setChecking] = useState(true)
  const [healthError, setHealthError] = useState('')
  const healthRequestId = useRef(0)
  const [file, setFile] = useState(null)
  const [imageUrl, setImageUrl] = useState('')
  const [dimensions, setDimensions] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [busy, setBusy] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [analysisError, setAnalysisError] = useState('')
  const [selectedDetection, setSelectedDetection] = useState(null)
  const [visibleClasses, setVisibleClasses] = useState(() => new Set([0, 1, 2, 3, 4, 5, 6, 7]))

  const refreshHealth = useCallback(async (quiet = false) => {
    const requestId = ++healthRequestId.current
    if (!quiet) setChecking(true)
    try {
      const status = await getHealth()
      if (requestId === healthRequestId.current) {
        setHealth(status)
        setHealthError('')
      }
    } catch (error) {
      if (requestId === healthRequestId.current) {
        setHealth(null)
        setHealthError(error.message || 'The backend could not be reached.')
      }
    } finally {
      if (!quiet && requestId === healthRequestId.current) setChecking(false)
    }
  }, [])

  useEffect(() => {
    refreshHealth()
    const timer = window.setInterval(() => refreshHealth(true), 15000)
    return () => window.clearInterval(timer)
  }, [refreshHealth])

  useEffect(() => () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl)
  }, [imageUrl])

  const clearXray = useCallback(() => {
    setFile(null)
    setImageUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return ''
    })
    setDimensions(null)
    setAnalysis(null)
    setSelectedDetection(null)
    setUploadError('')
    setAnalysisError('')
  }, [])

  const chooseXray = useCallback((nextFile, error = '') => {
    setUploadError(error)
    setAnalysisError('')
    if (!nextFile) {
      if (!error) clearXray()
      return
    }
    const url = URL.createObjectURL(nextFile)
    const image = new Image()
    image.onload = () => {
      setImageUrl((current) => {
        if (current) URL.revokeObjectURL(current)
        return url
      })
      setFile(nextFile)
      setDimensions({ width: image.naturalWidth, height: image.naturalHeight })
      setAnalysis(null)
      setSelectedDetection(null)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      setUploadError('This image could not be opened. Choose a valid PNG or JPEG.')
    }
    image.src = url
  }, [clearXray])

  async function runAnalysis() {
    if (!file || busy) return
    setBusy(true)
    setAnalysisError('')
    setSelectedDetection(null)
    try {
      const result = await analyzeImage(file)
      setAnalysis(result)
      setVisibleClasses(new Set([0, 1, 2, 3, 4, 5, 6, 7]))
    } catch (error) {
      setAnalysisError(error.message || 'Analysis failed. Check the backend and retry.')
      refreshHealth(true)
    } finally {
      setBusy(false)
    }
  }

  function toggleClass(id) {
    setVisibleClasses((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const modelAvailable = Boolean(health?.model?.available)
  const unavailableModels = Object.entries(health?.model?.models || {})
    .filter(([, model]) => !model.available)
    .map(([name, model]) => `${name}: ${model.error || 'Unavailable'}`)

  return (
    <div className="app-shell">
      <Header health={health} healthError={healthError} checking={checking} busy={busy} onNew={clearXray} />
      <main className="page">
        <section className="page-heading">
          <div>
            <div className="overline">DENTAL IMAGING <span>/</span> REVIEW STATION</div>
            <h1>Clinical imaging workspace</h1>
            <p>Review AI-assisted findings alongside the original radiograph. A dental professional should interpret all results.</p>
          </div>
          <div className="local-tag"><i /> CLINICAL REVIEW</div>
        </section>

        {!health && !checking && (
          <div className="notice notice-error" role="alert">
            <WifiOff size={18} /><div><strong>Backend is not connected</strong><span>{healthError || 'Image preview and STL viewing work locally. Start the backend to analyze X-rays.'}</span></div>
            <button className="icon-button" onClick={refreshHealth} aria-label="Retry backend connection"><RefreshCw size={16} /></button>
          </div>
        )}
        {health && !modelAvailable && (
          <div className="notice notice-warning" role="status">
            <AlertTriangle size={18} /><div><strong>AI models unavailable</strong><span>{health.model?.error || 'Add compatible trained weights to backend/models/best.pt and backend/models/yolo26n.pt. No predictions will be generated until a compatible model is loaded.'}</span></div>
            <button className="icon-button" onClick={refreshHealth} aria-label="Refresh model status"><RefreshCw size={16} /></button>
          </div>
        )}
        {health && modelAvailable && !health.model?.complete && (
          <div className="notice notice-warning" role="status">
            <AlertTriangle size={18} /><div><strong>Analysis will use available model(s) only</strong><span>{unavailableModels.join(' · ') || health.model?.error || 'Some configured models are unavailable. Results may be incomplete.'}</span></div>
            <button className="icon-button" onClick={refreshHealth} aria-label="Refresh model status"><RefreshCw size={16} /></button>
          </div>
        )}

        <div className="workspace-grid">
          <section className="column xray-column">
            <div className="panel upload-panel">
              {file ? (
                <div className="file-summary">
                  <span className="file-symbol"><FileImage size={18} /></span>
                  <div className="file-copy"><strong title={file.name}>{file.name}</strong><span>{formatBytes(file.size)} <i /> {dimensions?.width} × {dimensions?.height} px</span></div>
                  <button className="icon-button" onClick={clearXray} disabled={busy} aria-label="Remove X-ray" title="Remove X-ray"><Trash2 size={16} /></button>
                  <XrayUpload onFile={chooseXray} error={uploadError} disabled={busy} compact />
                </div>
              ) : (
                <XrayUpload onFile={chooseXray} error={uploadError} disabled={busy} />
              )}
              {file && (
                <div className="analyze-bar">
                  <span className={`ready-indicator ${analysisError ? 'has-error' : ''}`}><i />{busy ? (analysis ? 'Refreshing results · previous findings remain visible' : 'Analyzing radiograph…') : analysisError ? 'Refresh failed · showing previous results' : analysis ? 'Analysis complete · results are linked to this image' : 'Image ready for review'}</span>
                  <button className="button button-accent analyze-button" onClick={runAnalysis} disabled={busy || !modelAvailable}>
                    {busy ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
                    {busy ? 'Analyzing' : analysis ? 'Analyze again' : 'Analyze X-ray'}
                  </button>
                </div>
              )}
            </div>

            <XrayViewer
              imageUrl={imageUrl}
              dimensions={dimensions}
              filename={file?.name}
              analysis={analysis}
              selectedId={selectedDetection}
              visibleClasses={visibleClasses}
              onToggleClass={toggleClass}
              error={analysisError}
            />
            <div className="report-row">
              {analysis && <span className="completed-label">Analysis completed {new Date(analysis.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
              <PdfReportButton analysis={analysis} />
            </div>
            <DetectionResults
              analysis={analysis}
              error={analysisError}
              busy={busy}
              selectedId={selectedDetection}
              onSelect={setSelectedDetection}
            />
          </section>

          <section className="column model-column">
            <STLViewer />
            <p className="independent-label"><span>SEPARATE VIEWER</span><i /> STL mesh is not analyzed or associated with X-ray predictions.</p>
          </section>
        </div>
        <footer className="footer" id="clinical-notice">
          <span><Activity size={14} /> DENTAL AI WORKSTATION</span>
          <p>AI outputs are assistive only. Have a qualified dental professional review the original radiograph and all findings.</p>
          <span className="footer-state">LOCAL · SESSION DATA EXPIRES</span>
        </footer>
      </main>
    </div>
  )
}
