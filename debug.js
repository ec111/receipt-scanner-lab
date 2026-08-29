export function createDebugLogger(preEl) {
  const write = (message, data) => {
    const extra = data === undefined ? "" : " " + safe(data);
    const line = `[${new Date().toLocaleTimeString()}] ${message}${extra}`;
    console.log(line);
    if (preEl) {
      preEl.textContent += line + "\n";
      preEl.scrollTop = preEl.scrollHeight;
    }
  };

  window.addEventListener("error", e => write("JS Error:", e.message));
  window.addEventListener("unhandledrejection", e => write("Promise rejection:", e.reason));

  return {
    log: write,
    clear() {
      if (preEl) preEl.textContent = "=== Receipt Scanner Laboratory ===\n";
      write("Log cleared");
    },
    async copy() {
      await navigator.clipboard.writeText(preEl?.textContent || "");
      write("Debug log copied");
    }
  };
}

function safe(value) {
  try {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
