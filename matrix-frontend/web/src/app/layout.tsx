export const metadata = {
  title: 'Matrix Console',
  description: 'Private console chat',
};

import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="screen">{children}</body>
    </html>
  );
}
