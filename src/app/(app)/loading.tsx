// Route-group Suspense fallback. Next.js shows this instantly during
// navigations within the (app) group while the target route's client chunk
// downloads and hydrates — so transitions show an on-brand spinner instead of
// a frozen previous page. Matches the gold spinner used inside the dashboard.
export default function Loading() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: "80px 0",
        minHeight: "40vh",
      }}
    >
      <style>{`@keyframes app-loading-spin { to { transform: rotate(360deg); } }`}</style>
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          border: "3px solid rgba(201,162,39,.25)",
          borderTopColor: "#c9a227",
          animation: "app-loading-spin .8s linear infinite",
        }}
      />
      <span style={{ color: "var(--gold)", fontSize: 13 }}>Memuat…</span>
    </div>
  );
}
