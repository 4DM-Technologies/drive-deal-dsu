export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <span className="brand-glyph" aria-hidden="true"><i /><i /></span>
      {!compact && <span>Drive<span>Deal</span></span>}
    </span>
  );
}
