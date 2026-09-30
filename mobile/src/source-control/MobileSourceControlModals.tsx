import { ActionSheetModal, type ActionSheetAction } from '../components/ActionSheetModal'
import { ConfirmModal } from '../components/ConfirmModal'
import { PickerModal } from '../components/PickerModal'
import { openMobilePrUrl } from '../components/mobile-pr-url'
import { MobileBranchDiffPreviewDrawer } from './MobileBranchDiffPreviewDrawer'
import type { MobileSourceControlState } from './use-mobile-source-control-state'

type Props = {
  state: MobileSourceControlState
  actionSheetActions: ActionSheetAction[]
}

export function MobileSourceControlModals({ state, actionSheetActions }: Props) {
  const {
    branchDiffPreview,
    setBranchDiffPreview,
    showActionSheet,
    setShowActionSheet,
    discardTarget,
    setDiscardTarget,
    showBranchPicker,
    setShowBranchPicker,
    localBranches,
    localBranchesFailed,
    retryLocalBranches,
    createdPrUrl,
    setCreatedPrUrl,
    createdPrWarning,
    setCreatedPrWarning,
    branchLabel,
    checkoutBranch,
    runGitAction
  } = state

  return (
    <>
      <MobileBranchDiffPreviewDrawer
        branchDiffPreview={branchDiffPreview}
        onClose={() => setBranchDiffPreview(null)}
      />

      <ActionSheetModal
        visible={showActionSheet}
        title="Source Control"
        message={branchLabel}
        actions={actionSheetActions}
        onClose={() => setShowActionSheet(false)}
      />

      <ConfirmModal
        visible={discardTarget !== null}
        title="Discard Change"
        message={
          discardTarget
            ? `Discard changes to "${discardTarget.path}"? This cannot be undone.`
            : undefined
        }
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          if (discardTarget) {
            void runGitAction(`discard:${discardTarget.path}`, 'git.discard', {
              filePath: discardTarget.path
            })
          }
          // Modal visibility is derived from discardTarget — clear it so it dismisses.
          setDiscardTarget(null)
        }}
        onCancel={() => setDiscardTarget(null)}
      />

      <PickerModal
        visible={showBranchPicker}
        title="Switch Branch"
        options={(localBranches?.branches ?? []).map((b) => ({
          value: b,
          label: b,
          subtitle: b === localBranches?.current ? 'current' : undefined
        }))}
        selected={localBranches?.current ?? ''}
        onSelect={(branch) => {
          if (branch !== localBranches?.current) {
            void checkoutBranch(branch)
          } else {
            setShowBranchPicker(false)
          }
        }}
        onClose={() => setShowBranchPicker(false)}
        // The list is null while it is read and stays null when the read fails; an empty list is
        // the host saying there are none. Three different sheets, never one blank one.
        loadingLabel={
          localBranches === null && !localBranchesFailed ? 'Loading branches…' : undefined
        }
        failure={
          localBranchesFailed
            ? {
                message: "Couldn't load branches",
                onRetry: retryLocalBranches,
                retryLabel: 'Retry loading branches'
              }
            : undefined
        }
        emptyLabel="No local branches"
      />

      <ConfirmModal
        visible={createdPrUrl !== null}
        title="Pull Request Created"
        message={
          createdPrWarning
            ? `Open it in your browser?\n\n${createdPrWarning}`
            : 'Open it in your browser?'
        }
        confirmLabel="Open"
        onConfirm={() => {
          if (createdPrUrl) {
            openMobilePrUrl(createdPrUrl)
          }
          setCreatedPrUrl(null)
          setCreatedPrWarning(null)
        }}
        onCancel={() => {
          setCreatedPrUrl(null)
          setCreatedPrWarning(null)
        }}
      />
    </>
  )
}
