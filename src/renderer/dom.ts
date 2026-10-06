type Attrs = Record<string, string | number | boolean | undefined | ((event: any) => void)>;
type Child = Node | string | null | undefined | false;

/**
 * Tiny element factory. Text is always inserted as text nodes (never HTML),
 * so user-generated content can't inject markup.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = String(value);
    else if (key === 'value') (node as unknown as HTMLInputElement).value = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
  return node;
}

export function clear(node: Element): void {
  node.replaceChildren();
}

/** Stable pseudo-random colour for an id (used for avatars). */
export function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(hash) % 360} 55% 45%)`;
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase();
}
