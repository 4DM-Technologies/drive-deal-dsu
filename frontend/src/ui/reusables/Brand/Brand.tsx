export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <span>{compact ? 'DD' : <>Drive<span>Deal</span></>}</span>
    </span>
  );
}
