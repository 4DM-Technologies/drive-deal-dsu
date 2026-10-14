export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <span className="brand-monogram" aria-hidden="true">D<span>/</span>D</span>
      {!compact && <span className="brand-wordmark">DEAL<span>&amp;DRIVE</span></span>}
    </span>
  );
}
