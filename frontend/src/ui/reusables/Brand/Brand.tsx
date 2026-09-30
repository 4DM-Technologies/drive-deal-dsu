export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <span>{compact ? 'D&D' : <>Deal<span>&amp;Drive</span></>}</span>
    </span>
  );
}
