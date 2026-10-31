import { useEffect, useRef, useState } from 'react'
import { Maximize2, Minus, Plus, RotateCcw, ScanLine } from 'lucide-react'

const COLORS = ['#ff777d', '#ffad67', '#f7d565', '#b8e778', '#58d6b1', '#69c5f5', '#a3a1ff', '#e78dca']
const CLASS_NAMES = ['Caries', 'Infection', 'Impacted', 'BDC/BDR', 'Fractured', 'Healthy', 'Deep Caries', 'Periapical Lesion']
const SOURCE_COLORS = { '8-class': '#2d96ff', '6-class': '#ffd237' }

export default function XrayViewer({
  imageUrl, dimensions, filename, analysis, selectedId, visibleClasses, onToggleClass, error,
}) {
  const viewport = useRef(null)
  const drag = useRef(null)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [overlay, setOverlay] = useState(true)
  const [annotated, setAnnotated] = useState(false)

  useEffect(() => {
    const element = viewport.current
    if (!element) return undefined
    const observer = new ResizeObserver(([entry]) => {
      setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [imageUrl])

  const ratio = dimensions ? dimensions.width / dimensions.height : 1
  const fitWidth = viewportSize.width && viewportSize.height
    ? Math.min(viewportSize.width - 36, (viewportSize.height - 36) * ratio)
    : 0
  const fitHeight = fitWidth ? fitWidth / ratio : 0
  const displayUrl = annotated && analysis ? analysis.annotated_image : imageUrl

  function adjustZoom(delta) {
    setZoom((value) => Math.max(0.5, Math.min(5, Math.round((value + delta) * 10) / 10)))
  }

  function resetView() {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  return (
    <section className="panel xray-panel">
      <div className="panel-title">
        <div><span className="section-index">01 / RADIOGRAPH</span><h2>X-ray viewer</h2></div>
        <div className="viewer-actions">
          {analysis && (
            <div className="segmented">
              <button className={!annotated ? 'selected' : ''} onClick={() => setAnnotated(false)}>Original</button>
              <button className={annotated ? 'selected' : ''} onClick={() => setAnnotated(true)}>Annotated</button>
            </div>
          )}
          <button className={`icon-button ${overlay ? 'control-active' : ''}`} onClick={() => setOverlay((value) => !value)} disabled={!analysis} title="Toggle detection overlays" aria-label="Toggle detection overlays"><ScanLine size={16} /></button>
          <button className="icon-button" onClick={() => viewport.current?.requestFullscreen?.()} disabled={!imageUrl} title="Full screen" aria-label="Full screen"><Maximize2 size={16} /></button>
        </div>
      </div>
      <div
        className={`xray-viewport ${imageUrl ? 'has-image' : ''}`}
        ref={viewport}
        onPointerDown={(event) => {
          if (zoom <= 1) return
          drag.current = { x: event.clientX - pan.x, y: event.clientY - pan.y }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (drag.current) setPan({ x: event.clientX - drag.current.x, y: event.clientY - drag.current.y })
        }}
        onPointerUp={() => { drag.current = null }}
        onPointerCancel={() => { drag.current = null }}
        style={{ cursor: zoom > 1 ? (drag.current ? 'grabbing' : 'grab') : 'default' }}
      >
        {imageUrl && dimensions ? (
          <div
            className="xray-image-stage"
            style={{
              width: fitWidth || undefined,
              height: fitHeight || undefined,
              aspectRatio: `${dimensions.width} / ${dimensions.height}`,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
          >
            <img src={displayUrl} alt={annotated ? 'Annotated X-ray' : filename || 'Dental X-ray'} draggable="false" />
            {!annotated && overlay && analysis && analysis.detections.map((detection) => {
              if (!visibleClasses.has(detection.class_id)) return null
              const box = detection.bbox
              const fontSize = Math.max(12, Math.min(dimensions.width, dimensions.height) * 0.022)
              const label = `${detection.class_name} ${(detection.confidence * 100).toFixed(1)}% [${detection.source_model}]`
              const labelY = box.y_min - fontSize * 1.6 < 0 ? box.y_min + fontSize * 1.55 : box.y_min - fontSize * 0.25
              const sourceColors = (detection.source_models || ['8-class']).map((source) => SOURCE_COLORS[source])
              return (
                <svg key={detection.index} className="image-overlay" viewBox={`0 0 ${dimensions.width} ${dimensions.height}`} preserveAspectRatio="none">
                  {selectedId === detection.index && <rect x={box.x_min} y={box.y_min} width={box.x_max - box.x_min} height={box.y_max - box.y_min} fill={COLORS[detection.class_id]} fillOpacity=".15" />}
                  {sourceColors.map((color, index) => (
                    <rect
                      key={color}
                      x={box.x_min + index * 3} y={box.y_min + index * 3}
                      width={Math.max(0, box.x_max - box.x_min - index * 6)}
                      height={Math.max(0, box.y_max - box.y_min - index * 6)}
                      fill="none" stroke={color}
                      strokeWidth={selectedId === detection.index ? Math.max(5, fontSize / 5) : Math.max(2, fontSize / 9)}
                    />
                  ))}
                  <rect x={box.x_min} y={labelY - fontSize * 1.2} width={Math.min(dimensions.width * 0.8, label.length * fontSize * 0.58 + 12)} height={fontSize * 1.55} rx="4" fill={sourceColors[0]} />
                  <text x={box.x_min + 6} y={labelY} fill="#08151b" fontSize={fontSize} fontWeight="700">{label}</text>
                </svg>
              )
            })}
          </div>
        ) : (
          <div className="viewer-empty"><div className="crosshair"><i /></div><strong>Radiograph viewport</strong><span>Upload an X-ray image to begin review</span></div>
        )}
        {filename && imageUrl && <span className="image-filename">{filename}</span>}
        {error && <div className="viewer-error" role="alert">{error}</div>}
        <div className="zoom-bar">
          <button className="icon-button" onClick={() => adjustZoom(-0.2)} disabled={!imageUrl || zoom <= 0.5} aria-label="Zoom out"><Minus size={15} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button className="icon-button" onClick={() => adjustZoom(0.2)} disabled={!imageUrl || zoom >= 5} aria-label="Zoom in"><Plus size={15} /></button>
          <i />
          <button className="icon-button" onClick={resetView} disabled={!imageUrl} title="Fit to view" aria-label="Fit to view"><RotateCcw size={15} /></button>
        </div>
      </div>
      {analysis && (
        <>
          <div className="source-legend" aria-label="Source model overlay colors">
            <span>Overlay source:</span>
            <span><i style={{ background: SOURCE_COLORS['8-class'] }} /> 8-class</span>
            <span><i style={{ background: SOURCE_COLORS['6-class'] }} /> 6-class</span>
            <span><i className="source-both"><b style={{ background: SOURCE_COLORS['8-class'] }} /><b style={{ background: SOURCE_COLORS['6-class'] }} /></i> both</span>
          </div>
          <div className="class-legend" aria-label="Toggle each class overlay">
            {CLASS_NAMES.map((name, id) => (
              <button key={id} className={`legend-chip ${visibleClasses.has(id) ? '' : 'is-hidden'}`} onClick={() => onToggleClass(id)} title={`Toggle ${name} overlay`}>
                <i style={{ background: COLORS[id] }} /> {name} <b>{analysis.class_counts[id] ?? analysis.class_counts[String(id)] ?? 0}</b>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
