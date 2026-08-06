"use client";

/**
 * Root error boundary. It replaces the root layout when the layout itself throws,
 * so it must render its own <html>/<body> and cannot rely on providers or the
 * global stylesheet — hence inline styles. Its presence also stops `next build`
 * from falling back to the legacy pages-router error page (which imports <Html>
 * and breaks the static export).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en-IN">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.75rem",
          padding: "1.5rem",
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#f7fafa",
          color: "#0b1416",
        }}
      >
        <h1 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Something went wrong</h1>
        <p style={{ maxWidth: "24rem", fontSize: "0.875rem", opacity: 0.7, margin: 0 }}>
          An unexpected error occurred. Please try again.
          {error.digest ? ` (ref ${error.digest})` : ""}
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            marginTop: "0.25rem",
            padding: "0.5rem 1rem",
            borderRadius: "0.5rem",
            border: "none",
            background: "#0f766e",
            color: "#fff",
            fontSize: "0.875rem",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
