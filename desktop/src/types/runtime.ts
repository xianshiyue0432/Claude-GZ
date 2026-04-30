export type RuntimeSelection = {
  providerId: string | null
  modelId: string
  enabledSkills?: string[]
  enabledMcpServers?: string[]
  enabledAgents?: string[]
  enabledPlugins?: string[]
}
