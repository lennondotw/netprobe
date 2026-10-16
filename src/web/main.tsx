import './styles.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { AppShell } from './components/shell.tsx'
import { Callout } from './components/ui/callout.tsx'
import { PageHeader } from './components/ui/page-header.tsx'
import { TooltipHost } from './components/ui/tooltip.tsx'
import { useConfig } from './lib/api.ts'
import { usePathname } from './lib/router.tsx'
import { ConnectivityPage } from './pages/connectivity.tsx'
import { EgressPage } from './pages/egress.tsx'
import { HistoryPage } from './pages/history.tsx'
import { HostPage } from './pages/host.tsx'
import { RunPage } from './pages/run.tsx'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 5_000, retry: 1 } },
})

/** Shown for a page whose module is turned off in the config file. */
const Disabled = ({ title, module }: { title: string; module: string }) => (
  <>
    <PageHeader title={title} />
    <Callout title={`The ${title} page is disabled`} tone='warning'>
      Enable it with <code className='font-mono'>modules.{module}: true</code> in the config file.
    </Callout>
  </>
)

const Routes = () => {
  const pathname = usePathname()
  const modules = useConfig().data?.modules
  const run = /^\/runs\/([\w-]+)$/.exec(pathname)
  if (run) return <RunPage id={run[1]!} key={run[1]} />
  if (pathname === '/runs') return <HistoryPage />
  if (pathname === '/host') {
    return modules?.host === false ? <Disabled module='host' title='Host' /> : <HostPage />
  }
  if (pathname === '/egress') {
    return modules?.egress === false ? <Disabled module='egress' title='Egress' /> : <EgressPage />
  }
  return <ConnectivityPage />
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
