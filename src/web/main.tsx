import './styles.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { AppShell } from './components/shell.tsx'
import { TooltipHost } from './components/ui/tooltip.tsx'
import { usePathname } from './lib/router.tsx'
import { EgressPage } from './pages/egress.tsx'
import { HistoryPage } from './pages/history.tsx'
import { HostPage } from './pages/host.tsx'
import { OverviewPage } from './pages/overview.tsx'
import { RunPage } from './pages/run.tsx'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 5_000, retry: 1 } },
})

const Routes = () => {
  const pathname = usePathname()
  const run = /^\/runs\/([\w-]+)$/.exec(pathname)
  if (run) return <RunPage id={run[1]!} key={run[1]} />
  if (pathname === '/runs') return <HistoryPage />
  if (pathname === '/host') return <HostPage />
  if (pathname === '/egress') return <EgressPage />
  return <OverviewPage />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipHost>
        <AppShell>
          <Routes />
        </AppShell>
      </TooltipHost>
    </QueryClientProvider>
  </StrictMode>,
)
