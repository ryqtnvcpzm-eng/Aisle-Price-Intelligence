import { CaptureReceive } from "@/components/capture/capture-receive";

export const metadata = { title: "Record capture", robots: { index: false } };

/**
 * Fallback for pages whose security policy blocks the bookmarklet's request:
 * the capture arrives in the URL fragment (never sent to a server) and is
 * recorded with your Aisle session once you confirm it.
 */
export default function CaptureReceivePage() {
  return <CaptureReceive />;
}
