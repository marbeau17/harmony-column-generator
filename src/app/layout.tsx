import type { Metadata, Viewport } from 'next'
import { Noto_Sans_JP } from 'next/font/google'
import { Toaster } from 'react-hot-toast'
import Analytics from '@/components/common/Analytics'
import './globals.css'

const notoSansJP = Noto_Sans_JP({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-noto-sans-jp',
  display: 'swap',
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'Harmony Column Generator',
  description: 'スピリチュアルコラム自動生成システム',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja" className={notoSansJP.variable}>
      <body className="font-sans overflow-x-hidden">
        <Analytics />
        <Toaster
          position="top-right"
          toastOptions={{
            className: 'dark:bg-stone-800 dark:text-stone-100',
            duration: 4000,
          }}
        />
        {children}
      </body>
    </html>
  )
}
