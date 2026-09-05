import { View } from 'react-native'
import type { AccountsSnapshot } from '../components/AccountUsage'
import { MobileHomeQuickActions } from '../components/MobileHomeQuickActions'
import type { TaskProvider } from '../tasks/mobile-task-providers'
import type { HostProfile } from '../transport/types'
import { SectionLabel } from '../ui/SectionLabel'
import type { HomeResumeCard } from '../worktree/home-resume-card'
import { MobileHomeAccountUsageCards } from './MobileHomeAccountUsageCards'
import { MobileHomeResumeCard } from './MobileHomeResumeCard'
import { MobileHomeTasksCard } from './MobileHomeTasksCard'

export function MobileHomeListFooter(props: {
  accountsHosts: { host: HostProfile; snapshot: AccountsSnapshot }[]
  connectedHosts: HostProfile[]
  primaryHost: HostProfile | null
  primaryTaskProviders: TaskProvider[]
  resumeCard: HomeResumeCard | null
  onCreateWorkspace: (hostId: string) => void
  onOpenAccounts: (hostId: string) => void
  onOpenResume: (card: HomeResumeCard) => void
  onOpenTasks: (provider?: TaskProvider) => void
  onPairDesktop: () => void
}) {
  return (
    <View>
      {props.resumeCard ? (
        <>
          <SectionLabel>Pick up where you left off</SectionLabel>
          <MobileHomeResumeCard card={props.resumeCard} onOpen={props.onOpenResume} />
        </>
      ) : null}
      <SectionLabel>Tasks</SectionLabel>
      <MobileHomeTasksCard
        enabled={props.primaryHost != null}
        providers={props.primaryTaskProviders}
        onOpen={props.onOpenTasks}
      />
      <MobileHomeQuickActions
        connectedHosts={props.connectedHosts}
        onPairDesktop={props.onPairDesktop}
        onCreateWorkspace={props.onCreateWorkspace}
      />
      <MobileHomeAccountUsageCards items={props.accountsHosts} onOpen={props.onOpenAccounts} />
    </View>
  )
}
