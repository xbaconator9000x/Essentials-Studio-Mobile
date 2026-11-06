export function installEditorBackHandler(target: Window): () => void {
  const sentinel = { essentialsStudioEditorBack: true };
  const handleBack = () => {
    target.history.pushState(sentinel, "", target.location.href);
    target.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }));
  };

  target.history.pushState(sentinel, "", target.location.href);
  target.addEventListener("popstate", handleBack);
  return () => target.removeEventListener("popstate", handleBack);
}
