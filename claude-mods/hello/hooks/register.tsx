import type { Register } from 'claude-code'

const MESSAGE = 'Hello ClaudeCodeMods'

export const register: Register = on => {
  // The prompt footer (the status bar under the prompt). It draws text and
  // Buttons only; keep the engine's mode labels beside our button.
  on('ui.render', { component: 'SessionMode' }, ($, e, next) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const hello = <Button key="hello" plain dimColor label="Hello" onPress={() => $.ui.toast(MESSAGE)} />
    if (e.props.modes.length === 0) return hello
    return (
      <Box flexDirection="row">
        <Text dimColor>{e.props.modes.join(' & ')}</Text>
        {hello}
      </Box>
    )
  })
}
