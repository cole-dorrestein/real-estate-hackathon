import { useEffect, useState } from 'react'

export type Route =
  | { name: 'capture'; pinId?: string }
  | { name: 'dashboard' }
  | { name: 'matter'; matterId: string }
  | { name: 'upload' }

export function parseRoute(location: Location = window.location): Route {
  const path = location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/upload') return { name: 'upload' }
  if (path === '/dashboard') return { name: 'dashboard' }
  const match = /^\/dashboard\/matters\/([^/]+)$/.exec(path)
  if (match) return { name: 'matter', matterId: decodeURIComponent(match[1]) }
  const pin = new URLSearchParams(location.search).get('pin')
  return { name: 'capture', pinId: pin || undefined }
}

export function navigate(to: string): void {
  const url = new URL(to, window.location.origin)
  const next = `${url.pathname}${url.search}`
  const current = `${window.location.pathname}${window.location.search}`
  if (current !== next) window.history.pushState({}, '', next)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute())
  useEffect(() => {
    const onChange = () => setRoute(parseRoute())
    window.addEventListener('popstate', onChange)
    return () => window.removeEventListener('popstate', onChange)
  }, [])
  return route
}
