import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Eye in the Sky",
  description: "Weather mesh control plane",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui", margin: 24 }}>{children}</body>
    </html>
  );
}
