import type { ProviderInteractionMode } from "@t3tools/contracts";

const T3_CODE_ACP_DEFAULT_MODE_INSTRUCTIONS = `## T3 Code interaction mode: Default

Prefer making reasonable assumptions and carrying out the user's request. Ask a concise question only when a missing user decision would materially change the result. Treat this mode as active until T3 Code supplies a different interaction-mode instruction.`;

const T3_CODE_ACP_PLAN_MODE_INSTRUCTIONS = `## T3 Code interaction mode: Plan

Investigate with read-only actions and do not edit files or otherwise execute the implementation. Resolve discoverable facts before asking questions. When the requirements are decision complete, return a concrete implementation plan and do not start implementing it. Treat this mode as active until T3 Code supplies a different interaction-mode instruction.`;

export interface AcpInstructionState {
  readonly interactionMode: ProviderInteractionMode;
}

/** ACP lacks system/developer fields; inject context on first prompt and mode changes. */
export function acpPromptWithInstructions(input: {
  readonly prompt: string;
  readonly state: AcpInstructionState;
  readonly previousState?: AcpInstructionState;
}): string {
  // Native slash commands must remain at the start of the prompt.
  if (input.prompt.trimStart().startsWith("/")) return input.prompt;
  if (input.previousState?.interactionMode === input.state.interactionMode) {
    return input.prompt;
  }
  const instructions =
    input.state.interactionMode === "plan"
      ? T3_CODE_ACP_PLAN_MODE_INSTRUCTIONS
      : T3_CODE_ACP_DEFAULT_MODE_INSTRUCTIONS;
  return `<t3_code_instructions>\n${instructions}\n</t3_code_instructions>\n\n<user_request>\n${input.prompt}\n</user_request>`;
}
