export default function PortalLoading() {
  return (
    <div className="route-loading-shell" aria-live="polite" aria-busy="true">
      <div className="route-loading-header">
        <span className="route-loading-crumb" aria-hidden="true" />
        <span className="route-loading-title" aria-hidden="true" />
        <p>Loading this page…</p>
      </div>
      <div className="route-loading-folio" aria-hidden="true">
        <span className="route-loading-section" />
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
