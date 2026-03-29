/**
 * Resolve public asset path with Vite base URL
 * Converts "/images/foo.jpg" to "/alex-fitness-site/images/foo.jpg" in production
 */
export function asset(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  if (path.startsWith('/')) {
    return `${base.replace(/\/$/, '')}${path}`;
  }
  return path;
}
