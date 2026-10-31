import { useState } from 'react'
import { Download, LoaderCircle } from 'lucide-react'
import { downloadReport } from '../services/api.js'

export default function PdfReportButton({ analysis }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function generate() {
    if (!analysis || busy) return
    setBusy(true)
    setError('')
    try {
      const blob = await downloadReport(analysis.analysis_id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Dental_AI_Report_${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (exception) {
      setError(exception.message || 'Could not generate the report.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="report-action">
      <button className="button button-outline" onClick={generate} disabled={!analysis || busy}>
        {busy ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
        {busy ? 'Creating PDF…' : 'Generate PDF report'}
      </button>
      {error && <span className="report-error" role="alert">{error}</span>}
    </div>
  )
}
