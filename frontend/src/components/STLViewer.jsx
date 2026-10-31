import { Canvas } from '@react-three/fiber'
import { Bounds, OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import * as THREE from 'three'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, BoxSelect, Cuboid, FileUp, Grid2X2, Move3D, RotateCcw, Rotate3D, Scan, ScanLine, Trash2 } from 'lucide-react'

const MAX_STL_BYTES = 100 * 1024 * 1024

function Mesh({ source, wireframe, onMetadata }) {
  const geometry = source
  const metadata = {
    triangles: geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3,
    dimensions: (() => {
      geometry.computeBoundingBox()
      const bounds = geometry.boundingBox
      return [bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z]
    })(),
  }
  useEffect(() => {
    onMetadata(metadata)
    return () => geometry.dispose()
  }, [geometry, onMetadata])

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color="#b4d2d9" metalness={0.18} roughness={0.38} wireframe={wireframe} />
    </mesh>
  )
}

export default function STLViewer() {
  const fileInput = useRef(null)
  const controls = useRef(null)
  const [geometry, setGeometry] = useState(null)
  const [file, setFile] = useState(null)
  const [metadata, setMetadata] = useState(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [wireframe, setWireframe] = useState(false)
  const [grid, setGrid] = useState(true)
  const [axes, setAxes] = useState(false)
  const [preset, setPreset] = useState('iso')

  const loadFile = useCallback(async (candidate) => {
    if (!candidate) return
    setError('')
    if (!candidate.name.toLowerCase().endsWith('.stl')) {
      setError('Choose a file with the .stl extension.')
      return
    }
    if (candidate.size > MAX_STL_BYTES) {
      setError('The STL file exceeds the 100 MB limit.')
      return
    }
    try {
      const parsed = new STLLoader().parse(await candidate.arrayBuffer())
      if (!parsed.attributes.position || parsed.attributes.position.count < 3) {
        parsed.dispose()
        throw new Error('This STL file does not contain a readable triangle mesh.')
      }
      parsed.computeVertexNormals()
      setGeometry(parsed)
      setFile({ name: candidate.name, size: candidate.size })
      setMetadata(null)
      setPreset('iso')
      controls.current?.reset()
    } catch (exception) {
      setError(exception.message || 'Could not decode this STL file.')
    }
  }, [])

  useEffect(() => () => geometry?.dispose(), [geometry])

  function changeView(view) {
    setPreset(view)
    const directions = {
      front: new THREE.Vector3(0, 0, 1),
      side: new THREE.Vector3(1, 0, 0),
      top: new THREE.Vector3(0, 1, 0),
      iso: new THREE.Vector3(1, 0.8, 1),
    }
    const camera = controls.current?.object
    const target = controls.current?.target
    if (!camera || !target) return
    const distance = camera.position.distanceTo(target) || 4
    camera.position.copy(target).add(directions[view].normalize().multiplyScalar(distance))
    camera.up.set(0, view === 'top' ? 0 : 1, view === 'top' ? -1 : 0)
    camera.lookAt(target)
    controls.current.update()
  }

  function removeMesh() {
    setGeometry(null)
    setFile(null)
    setMetadata(null)
    setError('')
  }

  return (
    <section className="panel stl-panel">
      <div className="panel-title stl-title">
        <div><span className="section-index">03 / 3D GEOMETRY</span><h2>STL viewer</h2></div>
        <div className="stl-header-actions">
          {file && <span className="stl-name" title={file.name}>{file.name}</span>}
          <input ref={fileInput} className="visually-hidden" type="file" accept=".stl,model/stl" onChange={(event) => { loadFile(event.target.files[0]); event.target.value = '' }} />
          <button className="button button-outline button-small" onClick={() => fileInput.current?.click()}><FileUp size={15} />{file ? 'Replace' : 'Upload STL'}</button>
          {file && <button className="icon-button" onClick={removeMesh} title="Remove mesh" aria-label="Remove mesh"><Trash2 size={15} /></button>}
        </div>
      </div>
      <div
        className={`stl-viewport ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false) }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); loadFile(event.dataTransfer.files[0]) }}
      >
        <Canvas shadows dpr={[1, 1.6]} gl={{ antialias: true, alpha: false }}>
          <color attach="background" args={['#0a131a']} />
          <PerspectiveCamera makeDefault position={[3, 2.4, 3]} fov={40} near={0.001} far={100000} />
          <ambientLight intensity={1.15} />
          <directionalLight position={[4, 7, 5]} intensity={2.1} castShadow />
          <directionalLight position={[-4, -2, -3]} intensity={0.7} />
          {grid && <gridHelper args={[10, 20, '#2f505d', '#1b3039']} />}
          {axes && <axesHelper args={[2]} />}
          {geometry && (
            <Bounds fit clip observe margin={1.25}>
              <Mesh source={geometry} wireframe={wireframe} onMetadata={setMetadata} />
            </Bounds>
          )}
          <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} minDistance={0.02} maxDistance={100000} />
        </Canvas>
        {!geometry && (
          <div className="stl-empty">
            <span className="stl-empty-icon"><Cuboid size={27} /></span>
            <strong>Three-dimensional workspace</strong>
            <span>Drop an STL mesh here or select a file</span>
            <button className="button button-outline" onClick={() => fileInput.current?.click()}><FileUp size={15} /> Choose STL file</button>
            <small>Independent viewer · STL format · 100 MB maximum</small>
          </div>
        )}
        {error && <div className="stl-error" role="alert">{error}</div>}
        <div className="stl-tools">
          <button className="icon-button" onClick={() => changeView('front')} disabled={!geometry} title="Front view" aria-label="Front view"><Scan size={15} /></button>
          <button className="icon-button" onClick={() => changeView('side')} disabled={!geometry} title="Side view" aria-label="Side view"><Box size={15} /></button>
          <button className="icon-button" onClick={() => changeView('top')} disabled={!geometry} title="Top view" aria-label="Top view"><BoxSelect size={15} /></button>
          <button className="icon-button" onClick={() => changeView('iso')} disabled={!geometry} title="Isometric view" aria-label="Isometric view"><Rotate3D size={15} /></button>
          <i />
          <button className={`icon-button ${wireframe ? 'control-active' : ''}`} onClick={() => setWireframe((value) => !value)} disabled={!geometry} title="Wireframe" aria-label="Toggle wireframe"><Move3D size={15} /></button>
          <button className={`icon-button ${grid ? 'control-active' : ''}`} onClick={() => setGrid((value) => !value)} title="Grid" aria-label="Toggle grid"><Grid2X2 size={15} /></button>
          <button className={`icon-button ${axes ? 'control-active' : ''}`} onClick={() => setAxes((value) => !value)} title="Axes" aria-label="Toggle axes"><ScanLine size={15} /></button>
          <button className="icon-button" onClick={() => { controls.current?.reset(); changeView('iso') }} disabled={!geometry} title="Reset camera" aria-label="Reset camera"><RotateCcw size={15} /></button>
        </div>
        {file && metadata && (
          <div className="stl-metadata">
            <span title={file.name}>{file.name}</span><i />
            <span>{(file.size / (1024 * 1024)).toFixed(2)} MB</span><i />
            <span>{Math.floor(metadata.triangles).toLocaleString()} triangles</span><i />
            <span>{metadata.dimensions.map((value) => value.toPrecision(3)).join(' × ')}</span>
          </div>
        )}
      </div>
      <div className="stl-help"><span>Drag to rotate</span><i /> <span>Scroll to zoom</span><i /> <span>Right-drag to pan</span></div>
    </section>
  )
}
