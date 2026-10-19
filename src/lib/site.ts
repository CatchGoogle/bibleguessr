/** Path of this app: '/' in local dev, '/bibleguessr' on GitHub Pages. */
export function sitePath(path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const suffix = path.replace(/^\//, '')
  if (!suffix) return base || '/'
  return `${base}/${suffix}`
}

export function siteUrl(path = ''): string {
  const route = sitePath(path)
  return `${window.location.origin}${route === '/' ? '' : route}`
}
