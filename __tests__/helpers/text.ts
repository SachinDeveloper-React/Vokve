import type { ReactTestRenderer } from 'react-test-renderer';

/**
 * Collects the visible strings out of a rendered tree.
 *
 * Walks into nested children rather than serialising `props.children`:
 * a Text containing another Text — the two-tone wordmark, for instance —
 * holds a React element whose props form a circular structure that
 * `JSON.stringify` refuses to touch.
 */
function collect(children: unknown): string[] {
  if (children === null || children === undefined) return [];
  if (typeof children === 'string') return [children];
  if (typeof children === 'number') return [String(children)];
  if (typeof children === 'boolean') return [];
  if (Array.isArray(children)) return children.flatMap(collect);

  const element = children as { props?: { children?: unknown } };
  return element.props ? collect(element.props.children) : [];
}

export function textOf(tree: ReactTestRenderer, TextComponent: unknown): string {
  return tree.root
    .findAllByType(TextComponent as never)
    .flatMap(node => collect(node.props.children))
    .join(' ');
}
