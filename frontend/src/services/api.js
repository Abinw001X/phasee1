const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

async function request(path, options, timeoutMs = 30000) {
  let response
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, signal: controller.signal })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('The API request timed out. Check that the backend is responsive and retry.')
    }
    throw new Error('The API could not be reached. Confirm the backend is running and accessible.')
  } finally {
    window.clearTimeout(timeout)
  }
  if (!response.ok) {
    let message = `Request failed (${response.status}).`
    try {
      const body = await response.json()
      if (typeof body.detail === 'string') message = body.detail
    } catch {
      message = `Request failed (${response.status}).`
    }
    throw new Error(message)
  }
  return response
}

async function readJson(response, resource) {
  try {
    return await response.json()
  } catch {
    throw new Error(`The backend returned an unreadable ${resource} response. Check the backend logs and retry.`)
  }
}

export async function getHealth() {
  return readJson(await request('/api/health'), 'health')
}

export async function analyzeImage(file) {
  const form = new FormData()
  form.append('file', file)
  const result = await readJson(
    await request('/api/analyze', { method: 'POST', body: form }, 120000),
    'analysis',
  )
  if (!Array.isArray(result?.detections) || !Number.isFinite(result?.total_detections)) {
    throw new Error('The backend response did not contain usable analysis results. Check the backend version and retry.')
  }
  return result
}

export async function downloadReport(analysisId) {
  return (await request('/api/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysis_id: analysisId }),
  })).blob()
}
