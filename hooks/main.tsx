// dev-cockpit: one mod, a folder per feature. A new feature exports startX($),
// registerX(on) and openX($), and joins below with one line in each place.
import type { Register } from 'claude-code'

import { branchAlarm, openBranchPane, registerBranches, startBranches } from './branches/pane'
import { noteBuild } from './core/build'
import { openDocPane, registerDocLinks, startDocLinks } from './doclinks/pane'
import { openOverview, registerOverview, startOverview } from './overview/pane'

export const register: Register = on => {
  // The mod's one unmatched session.start: each feature resets its own state and
  // registers its command. Nothing here runs git, a model or a file scan.
  on('session.start', async ($, e, next) => {
    await noteBuild($)
    await startBranches($)
    await startDocLinks($)
    await startOverview($)
    void openBranchPane($)
    return next(e)
  })

  registerBranches(on)
  registerDocLinks(on)
  registerOverview(on)

  // The band above the prompt: one button per feature.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    // The band redraws often: it reads one number, never a snapshot or the store.
    const alarms = await branchAlarm($)
    return (
      <Box justifyContent="flex-end">
        <Button key="open-overview" label="📋 任务概要" onPress={() => openOverview($)} />
        <Button key="open-docs" label="📚 关联文档" onPress={() => openDocPane($)} />
        <Button
          key="open-branches"
          label={alarms > 0 ? `🚨 分支记录 · 近5天 AI×${alarms}` : '🌿 分支记录'}
          onPress={() => openBranchPane($)}
        />
      </Box>
    )
  })
}
