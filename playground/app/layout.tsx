export const metadata = { title: 'Notification Playground' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial', margin: 0, background: '#030712', color: '#e6e9f5' }}>
        <div style={{ position: 'sticky', top: 0, background: '#0b1020', borderBottom: '1px solid #1e293b', padding: '12px 20px', zIndex: 10 }}>
          <div style={{ maxWidth: 1040, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 700 }}>Routed</div>
            <div style={{ opacity: 0.8, fontSize: 14 }}>Playground</div>
          </div>
        </div>
        <main style={{ maxWidth: 1040, margin: '20px auto', padding: '0 20px' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
