import { useMemo, useState } from 'react'
import { Activity, Crosshair, ScanSearch, Timer } from 'lucide-react'

const CLASSES = ['Caries', 'Infection', 'Impacted', 'BDC/BDR', 'Fractured', 'Healthy', 'Deep Caries', 'Periapical Lesion']

function Metric({ icon: Icon, title, value, suffix = '' }) {
  return (
    <div className="metric">
      <span className="metric-icon"><Icon size={16} /></span>
      <span className="metric-caption">{title}</span>
      <strong>{value}<small>{suffix}</small></strong>
    </div>
  )
}

function sourceLabel(detection) {
  if (detection.source_model === 'both' || detection.source_models?.length === 2) return 'Both models'
  return detection.source_model || detection.source_models?.[0] || 'Model source unavailable'
}

export default function DetectionResults({ analysis, error, busy, selectedId, onSelect }) {
  const [filter, setFilter] = useState('all')
  const detections = useMemo(() => {
    if (!analysis) return []
    return (analysis.detections || [])
      .filter((item) => filter === 'all' || item.class_id === Number(filter))
      .slice()
      .sort((a, b) => {
        const aHealthy = a.class_id === 5
        const bHealthy = b.class_id === 5
        return Number(aHealthy) - Number(bHealthy) || b.confidence - a.confidence
      })
  }, [analysis, filter])

  const counts = analysis?.class_counts || {}
  const countForClass = (id) => counts[id] ?? counts[String(id)] ?? 0
  const flaggedCount = (analysis?.detections || []).filter((item) => item.class_id !== 5).length
  const onlyHealthyDetections = (analysis?.total_detections || 0) > 0 && flaggedCount === 0
  const threshold = Number.isFinite(analysis?.confidence_threshold)
    ? `${(analysis.confidence_threshold * 100).toFixed(0)}%`
    : 'Not reported'
  const isPartial = analysis?.model_status === 'partial'

  return (
    <section className="panel results-panel" aria-labelledby="results-heading">
      <div className="panel-title">
        <div><span className="section-index">02 / AI-ASSISTED REVIEW</span><h2 id="results-heading">Findings &amp; model output</h2></div>
        {analysis
          ? <span className={`results-status ${isPartial ? 'is-partial' : ''}`}><i /> {busy ? 'Refreshing results' : isPartial ? 'Partial model output' : 'Analysis complete'}</span>
          : <span className="waiting-status">{error ? 'Analysis error' : busy ? 'Analyzing image' : 'Awaiting analysis'}</span>}
      </div>
      {analysis && busy && <div className="analysis-refresh-note" role="status">A new analysis is running. The previous result remains available until the new result is ready.</div>}
      {analysis && error && <div className="analysis-refresh-error" role="alert">The latest analysis attempt failed: {error} Showing the previous result for this image.</div>}
      {!analysis ? (
        <div className={`results-placeholder ${error ? 'has-error' : ''}`} role={error ? 'alert' : undefined}>
          <ScanSearch size={22} />
          <span>{error || (busy ? 'The backend is analyzing this radiograph. Results will appear here when complete.' : 'Upload a radiograph and run analysis to review model findings here.')}</span>
        </div>
      ) : (
        <>
          <div className={`finding-summary ${flaggedCount ? 'has-findings' : 'no-findings'}`} role="status">
            <span className="finding-summary-icon"><Activity size={18} /></span>
            <div>
              <strong>{flaggedCount
                ? `${flaggedCount} finding${flaggedCount === 1 ? '' : 's'} flagged for professional review`
                : onlyHealthyDetections
                  ? 'Only Healthy-class detections returned — not a health clearance'
                  : 'No findings returned above the model threshold'}</strong>
              <span>{flaggedCount
                ? 'Review each highlighted area on the original radiograph; model output is not a diagnosis.'
                : 'This result does not rule out disease. Review the original image with a dental professional.'}</span>
            </div>
          </div>

          <div className="metrics-grid">
            <Metric icon={Crosshair} title="Detections returned" value={analysis.total_detections} />
            <Metric icon={ScanSearch} title="Classes represented" value={analysis.distinct_classes} />
            <Metric icon={Activity} title="Minimum score used" value={threshold} />
            <Metric icon={Timer} title="Inference time" value={Number(analysis.inference_ms).toFixed(1)} suffix=" ms" />
          </div>

          <div className="class-summary">
            <div className="subheading"><strong>Class counts</strong><span>MODEL OUTPUT · NOT DIAGNOSIS</span></div>
            <div className="count-grid">
              {CLASSES.map((name, id) => (
                <button
                  className={`count-cell ${filter === String(id) ? 'is-filtered' : ''}`}
                  key={id}
                  type="button"
                  aria-pressed={filter === String(id)}
                  onClick={() => setFilter(filter === String(id) ? 'all' : String(id))}
                  title={`Show ${countForClass(id)} ${name} detections`}
                >
                  <span className="count-id">{String(id).padStart(2, '0')}</span>
                  <span className="count-name">{name}</span>
                  <b>{countForClass(id)}</b>
                </button>
              ))}
            </div>
          </div>

          <div className="table-controls">
            <div><strong>Individual detections</strong><span>{detections.length} shown · {analysis.total_detections} total</span></div>
            <label className="class-filter">Filter
              <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter detections by class">
                <option value="all">All classes</option>
                {CLASSES.map((name, id) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <span className="confidence-order">Findings first · confidence descending</span>
          </div>
          {analysis.total_detections === 0 ? (
            <div className="no-detections">No detections were returned at the configured minimum score of {threshold}. This does not establish that the image is healthy.</div>
          ) : detections.length === 0 ? (
            <div className="no-detections">No detections match this class filter.</div>
          ) : (
            <div className="table-wrap">
              <table className="detection-table">
                <thead><tr><th>Image</th><th>Finding label</th><th>Model confidence</th><th>Source</th><th>Bounding box (px)</th></tr></thead>
                <tbody>{detections.map((item) => (
                  <tr key={item.index} className={selectedId === item.index ? 'is-selected' : ''}>
                    <td>
                      <button
                        type="button"
                        className="detection-select"
                        aria-label={`Show detection ${item.index}, ${item.class_name}, on radiograph`}
                        aria-pressed={selectedId === item.index}
                        onClick={() => onSelect(selectedId === item.index ? null : item.index)}
                      >
                        {String(item.index).padStart(2, '0')}
                      </button>
                    </td>
                    <td><span className={`finding-label ${item.class_id === 5 ? 'is-healthy' : ''}`}>{item.class_name}</span></td>
                    <td className="confidence">{(item.confidence * 100).toFixed(1)}%</td>
                    <td>{sourceLabel(item)}</td>
                    <td className="bbox-values">{item.bbox.x_min.toFixed(1)}, {item.bbox.y_min.toFixed(1)} – {item.bbox.x_max.toFixed(1)}, {item.bbox.y_max.toFixed(1)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <div className="results-footnote">
            <strong>Clinical review required.</strong> Confidence is the model’s score for a predicted object, not the probability that a patient has a condition. Results depend on image quality and model limitations. A qualified dental professional must interpret the original radiograph.
            {isPartial && <span className="model-warning"> Some configured models were unavailable; this analysis may not include all model outputs.{analysis.model_errors && ` ${Object.entries(analysis.model_errors).map(([name, message]) => `${name}: ${message}`).join(' ')}`}</span>}
            {!isPartial && <span> Findings from overlapping detections may be combined; each row identifies its source model.</span>}
            <span className="image-measurement">Image analyzed: {analysis.image_width} × {analysis.image_height} px</span>
          </div>
        </>
      )}
    </section>
  )
}
