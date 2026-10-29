/**
 * Copies text and says whether it worked. The Clipboard API only exists on secure origins
 * (https or localhost), so when someone opens the dev server by its network address, such as
 * http://192.168.1.20:3000, this falls back to the older copy command.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Denied (e.g. the page lost focus): try the fallback below.
    }
  }

  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  field.setSelectionRange(0, text.length);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
    previousFocus?.focus();
  }
}
