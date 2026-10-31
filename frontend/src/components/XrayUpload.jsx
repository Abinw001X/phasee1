import { useRef, useState } from 'react'
import { FileImage, Upload } from 'lucide-react'

const MAX_BYTES = 20 * 1024 * 1024
const EXTENSIONS = new Set(['png', 'jpg', 'jpeg'])

export default function XrayUpload({ onFile, error, disabled, compact = false }) {
  const input = useRef(null)
  const [dragging, setDragging] = useState(false)

  function validate(file) {
    if (!file) return
    const extension = file.name.split('.').pop()?.toLowerCase()
    if (!EXTENSIONS.has(extension) || !['image/png', 'image/jpeg'].includes(file.type)) {
      onFile(null, 'Choose a PNG, JPG, or JPEG image.')
      return
    }
    if (file.size > MAX_BYTES) {
      onFile(null, 'The image is larger than the 20 MB upload limit.')
      return
    }
    onFile(file)
  }

  return (
    <div
      className={`upload-drop ${compact ? 'upload-compact' : ''} ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true) }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false) }}
      onDrop={(event) => { event.preventDefault(); setDragging(false); validate(event.dataTransfer.files[0]) }}
    >
      <input
        ref={input}
        className="visually-hidden"
        type="file"
        accept=".png,.jpg,.jpeg,image/png,image/jpeg"
        onChange={(event) => { validate(event.target.files[0]); event.target.value = '' }}
        disabled={disabled}
      />
      {!compact && <span className="upload-icon"><FileImage size={21} /></span>}
      {!compact && (
        <div className="upload-copy">
          <strong>Drop an X-ray image here</strong>
          <span>PNG, JPG, or JPEG · Maximum 20 MB</span>
        </div>
      )}
      <button className={`button button-outline ${compact ? 'button-small' : ''}`} onClick={() => input.current?.click()} disabled={disabled}>
        <Upload size={15} /> {compact ? 'Replace' : 'Browse files'}
      </button>
      {error && <span className="upload-error" role="alert">{error}</span>}
    </div>
  )
}
