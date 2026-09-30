export function PageSkeleton() {
  return (
    <div className="grid grid-3" aria-label="Loading content">
      {[0, 1, 2].map((item) => (
        <div className="card card-pad" key={item}>
          <div className="skeleton" style={{ height: 160 }} />
          <div className="skeleton" style={{ height: 22, width: '70%', marginTop: 18 }} />
          <div className="skeleton" style={{ height: 14, width: '92%', marginTop: 10 }} />
        </div>
      ))}
    </div>
  );
}
