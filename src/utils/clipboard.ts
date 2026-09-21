import { writeText } from "@tauri-apps/plugin-clipboard-manager";

/**
 * Copy text to the system clipboard.
 *
 * Goes through the Tauri plugin rather than `navigator.clipboard`, because a macOS
 * release build serves the webview from the custom `tauri://` scheme in WKWebView, where
 * the async clipboard API is not dependably exposed — so a browser-only implementation
 * would work in `tauri dev` and silently fail for real users. `navigator.clipboard` stays
 * as the fallback for the Vite dev server and browser preview, where there is no IPC
 * bridge to talk to.
 */
export const copyText = async (text: string): Promise<void> => {
  try {
    await writeText(text);
  } catch (pluginError) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      throw pluginError;
    }
  }
};
