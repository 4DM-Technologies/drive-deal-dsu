/** Placeholder shaped like the plan summary and the two plan cards while the plan loads. */
export function PlanSkeleton({ label }: { label: string }) {
  return (
    <div className="account-skeleton" role="status">
      <span className="sr-only">{label}</span>
      <span className="skeleton" />
      <div><span className="skeleton" /><span className="skeleton" /></div>
    </div>
  );
}
