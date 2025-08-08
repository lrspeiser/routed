export const metadata = { title: 'Notification Playground' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial', margin: 24 }}>
        {children}
      </body>
    </html>
  );
}
