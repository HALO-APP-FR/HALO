import { AgentShell } from "@/components/halo/agent-shell";

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return <AgentShell>{children}</AgentShell>;
}
